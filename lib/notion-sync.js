// 노션 → 사이트 동기화. AI를 부르지 않고, 노션의 '전시 게시물'과 '분류 관리'만 읽는다.
//
// 규칙
// - 분류 이름, 순서, 방 물건 연결은 노션 '분류 관리'를 그대로 따른다.
// - 작품은 '발행 요청'·'재발행 요청'일 때만 그 순간의 내용을 복사해 공개본으로 바꾼다.
//   그 밖의 상태(초안, 검토 중, 발행됨, 수정 중)에서는 노션을 고쳐도 공개본이 그대로다.
// - 글과 이미지를 모두 받아 확인한 뒤 한 번에 교체한다. 하나라도 실패하면 기존 공개본을 건드리지 않는다.
// - 같은 요청을 다시 실행해도 노션 페이지 ID로 같은 작품을 찾으므로 카드가 늘지 않는다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const store = require('./store');
const notion = require('./notion');

const { text, select, checkbox, number, date, relation, files, has } = notion.read;
const { normId } = notion;

const STATUS = {
  draft: '초안', review: '검토 중', publishReq: '발행 요청', published: '발행됨',
  editing: '수정 중', republishReq: '재발행 요청', unpublishReq: '내림 요청', unpublished: '내려감',
};
// 전시 게시물 속성 이름
const F = {
  title: '공개 제목', status: '발행 상태', slug: '작품 주소', category: '카테고리', sub: '하위 분류', featured: '대표작',
  summary: '한 줄 요약', context: '맥락', role: '역할', result: '결과',
  cover: '표지', thumb: '썸네일', gallery: '갤러리', audio: '음원',
  link: '대표 링크', linkLabel: '대표 링크 문구', moreLinks: '추가 링크',
  siteId: '사이트 ID', firstPub: '최초 발행일', lastPub: '최근 발행일', version: '발행 버전', memo: '발행 메모',
};
// 사이트가 노션에 적는 속성. 내용 비교(지문)에서 뺀다.
const SITE_WRITTEN = new Set([F.siteId, F.firstPub, F.lastPub, F.version, F.memo]);
// 분류 관리 속성 이름
const C = { name: '이름', en: '영어 이름', key: '분류 키', type: '구분', parent: '상위 분류', thing: '방 물건', button: '버튼 문구', order: '순서', enabled: '사용' };
const TOP = '상위 분류';
const SUBTYPE = '하위 분류';
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const IMAGE_MAX = 25 * 1024 * 1024;
const AUDIO_MAX = 40 * 1024 * 1024;
const AUDIO_EXT = { mp3: 'audio/mpeg', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', ogg: 'audio/ogg', oga: 'audio/ogg', wav: 'audio/wav', webm: 'audio/webm' };
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/webm']);

const nowIso = () => new Date().toISOString();
const kst = (iso) => new Date(iso).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', hour12: false });
const rich = (s) => ({ rich_text: s ? [{ type: 'text', text: { content: String(s).slice(0, 1900) } }] : [] });
const byOrder = (a, b) => (a.order ?? 999) - (b.order ?? 999) || String(a.name).localeCompare(String(b.name));

function state() {
  const d = store.get();
  if (!d.notionSync) d.notionSync = { lastRunAt: null, lastOkAt: null, log: [], failures: {} };
  return d.notionSync;
}
function log(level, title, msg) {
  const s = state();
  s.log.unshift({ at: nowIso(), level, title: title || '', msg });
  s.log = s.log.slice(0, 80);
  const line = `[노션] ${title ? title + ': ' : ''}${msg}`;
  if (level === 'error') console.error(line);
  else console.log(line);
}

/* ---------- 분류 관리 ---------- */
function parseCategoryRows(rows) {
  if (rows.length && !has(rows[0], C.key)) throw new Error(`'분류 관리'에서 '${C.key}' 속성을 찾지 못했어요.`);
  return rows.map((p) => ({
    id: normId(p.id), name: text(p, C.name), en: text(p, C.en), key: text(p, C.key), type: select(p, C.type),
    parent: relation(p, C.parent)[0] || null, thing: select(p, C.thing), button: text(p, C.button),
    order: number(p, C.order), enabled: checkbox(p, C.enabled),
  }));
}
// 노션 페이지 ID → 분류 정보 (전시 게시물의 관계를 읽을 때 쓴다)
function categoryIndex(parsed) {
  const byId = new Map(parsed.map((r) => [r.id, r]));
  const idx = new Map();
  for (const r of parsed) {
    const parent = r.parent ? byId.get(r.parent) : null;
    idx.set(r.id, { key: r.key, name: r.name, type: r.type, parentKey: parent ? parent.key : null });
  }
  return idx;
}
function buildCategories(parsed) {
  const problems = [];
  const prev = store.get().categories;
  const out = {};
  const thingOwner = new Map();
  const tops = parsed.filter((r) => r.type === TOP).sort(byOrder);
  const okTop = new Map();
  for (const r of tops) {
    if (!KEY_RE.test(r.key)) { problems.push(`상위 분류 '${r.name}': 분류 키 '${r.key}'가 올바르지 않아 건너뛰었어요.`); continue; }
    if (out[r.key]) { problems.push(`상위 분류 '${r.name}': 분류 키 '${r.key}'가 겹쳐서 건너뛰었어요.`); continue; }
    let thing = store.THING_KIND[r.thing] ? r.thing : null;
    if (thing && thingOwner.has(thing)) {
      problems.push(`상위 분류 '${r.name}': 방 물건 ${thing}은 이미 '${thingOwner.get(thing)}'에 연결돼 있어 미연결로 처리했어요.`);
      thing = null;
    }
    if (thing) thingOwner.set(thing, r.name);
    const old = prev[r.key] || {};
    out[r.key] = {
      name: r.en || r.name, ko: r.name, button: r.button || old.button || 'Take a look',
      thing, order: r.order ?? 999, enabled: r.enabled, notionId: r.id, subs: [],
    };
    okTop.set(r.id, r.key);
  }
  for (const s of parsed.filter((r) => r.type === SUBTYPE).sort(byOrder)) {
    const key = s.parent && okTop.get(s.parent);
    if (!key) { problems.push(`하위 분류 '${s.name}': 상위 분류가 연결되지 않아 건너뛰었어요.`); continue; }
    if (!KEY_RE.test(s.key)) { problems.push(`하위 분류 '${s.name}': 분류 키 '${s.key}'가 올바르지 않아 건너뛰었어요.`); continue; }
    if (out[key].subs.some((x) => x.id === s.key)) { problems.push(`하위 분류 '${s.name}': 같은 상위 안에서 분류 키 '${s.key}'가 겹쳐서 건너뛰었어요.`); continue; }
    out[key].subs.push({ id: s.key, name: s.en || s.name, ko: s.name, enabled: s.enabled, notionId: s.id });
  }
  return { categories: out, problems };
}
function applyCategories(next) {
  const d = store.get();
  if (!Object.keys(next).length) throw new Error("'분류 관리'에서 상위 분류를 하나도 읽지 못해 기존 분류를 그대로 뒀어요.");
  // 노션에서 사라진 분류는 지우지 않고 숨긴다 (작품 연결이 끊기지 않게).
  for (const [k, c] of Object.entries(d.categories)) if (!next[k]) next[k] = { ...c, enabled: false, missingInNotion: true };
  const changed = JSON.stringify(d.categories) !== JSON.stringify(next);
  d.categories = next;
  return changed;
}

/* ---------- 사이트 설정 (선택) ---------- */
// 노션 '사이트 설정' DB: 한 행에 항목 하나. '항목'(제목)과 '값'(텍스트).
const SETTING_KEYS = { '사이트 이름': 'siteName', '이메일': 'email', '자기소개': 'aboutText', '주요 이력': 'aboutHistory', '네이버 블로그': 'naverUrl', '인스타그램': 'instagramUrl', '대표곡': 'featuredTrackId' };
function applySettings(rows) {
  const d = store.get();
  const problems = [];
  const next = { ...d.settings };
  for (const p of rows) {
    const name = text(p, '항목');
    const key = SETTING_KEYS[name];
    if (!key) { if (name) problems.push(`'${name}'은 사이트가 쓰는 항목이 아니라 건너뛰었어요.`); continue; }
    const p2 = notion.read.prop(p, '값');
    const value = p2 && p2.type === 'rich_text' ? p2.rich_text.map((t) => t.plain_text || '').join('').trim() : '';
    if (key === 'naverUrl' || key === 'instagramUrl') {
      if (value && !safeUrl(value)) { problems.push(`${name} 주소가 올바르지 않아 기존 값을 뒀어요: ${value}`); continue; }
      next[key] = value;
    } else if (key === 'email') {
      if (value && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(value)) { problems.push(`이메일 형식이 올바르지 않아 기존 값을 뒀어요: ${value}`); continue; }
      next[key] = value;
    } else if (key === 'siteName') {
      next[key] = value.slice(0, 40) || 'Plot Twist';
    } else if (key === 'featuredTrackId') {
      // 값은 대표곡의 작품 주소. 비우면 자동(음원이 있는 첫 공개 곡).
      const t = value ? d.items.find((i) => i.slug === value) : null;
      if (value && !t) { problems.push(`대표곡 '${value}' 작품 주소를 찾지 못했어요. 비워 두면 자동으로 골라요.`); continue; }
      next[key] = t ? t.id : null;
    } else {
      next[key] = value.slice(0, key === 'aboutHistory' ? 3000 : 2000);
    }
  }
  const changed = JSON.stringify(next) !== JSON.stringify(d.settings);
  d.settings = next;
  return { changed, problems };
}

/* ---------- 전시 게시물 ---------- */
function fingerprint(page) {
  const props = {};
  for (const [k, v] of Object.entries(page.properties || {})) {
    if (SITE_WRITTEN.has(k) || v.type === 'last_edited_time') continue;
    if (v.type === 'files') props[k] = (v.files || []).map((f) => f.name + '|' + String((f.type === 'external' ? f.external && f.external.url : f.file && f.file.url) || '').split('?')[0]);
    else props[k] = v;
  }
  return crypto.createHash('sha1').update(JSON.stringify([props, page.last_edited_time])).digest('hex');
}
function parseLinks(page, errors) {
  const links = [];
  const main = text(page, F.link);
  if (main) {
    if (!safeUrl(main)) errors.push(`대표 링크 주소가 올바르지 않아요: ${main}`);
    else links.push({ label: text(page, F.linkLabel) || 'Open', url: main });
  }
  for (const line of text(page, F.moreLinks).split('\n').map((l) => l.trim()).filter(Boolean)) {
    const i = line.lastIndexOf('|');
    const label = i >= 0 ? line.slice(0, i).trim() : '';
    const url = (i >= 0 ? line.slice(i + 1) : line).trim();
    if (!safeUrl(url)) errors.push(`추가 링크 '${line}'의 주소가 올바르지 않아요. '문구 | 주소' 모양으로 써 주세요.`);
    else links.push({ label: label || 'Link', url });
  }
  return links;
}
function readShowcase(page, catIdx) {
  const missing = [F.title, F.status, F.slug, F.category].filter((n) => !has(page, n));
  const linkErrors = [];
  const cat = catIdx.get(relation(page, F.category)[0]) || null;
  const sub = catIdx.get(relation(page, F.sub)[0]) || null;
  return {
    pageId: normId(page.id), url: page.url || '', edited: page.last_edited_time, fp: fingerprint(page),
    schemaError: missing.length ? `'전시 게시물'에서 속성을 찾지 못했어요: ${missing.join(', ')}` : '',
    status: select(page, F.status), title: text(page, F.title), slug: text(page, F.slug),
    cat, sub, featured: checkbox(page, F.featured),
    summary: text(page, F.summary), context: text(page, F.context), role: text(page, F.role), result: text(page, F.result),
    files: { cover: files(page, F.cover), thumb: files(page, F.thumb), gallery: files(page, F.gallery), audio: files(page, F.audio) },
    links: parseLinks(page, linkErrors), linkErrors,
    firstPub: date(page, F.firstPub), siteId: text(page, F.siteId), version: number(page, F.version), memo: text(page, F.memo),
  };
}
function findItem(r) {
  const d = store.get();
  return d.items.find((i) => i.notionPageId === r.pageId)
    || (r.siteId && d.items.find((i) => i.id === r.siteId && !i.notionPageId))
    || d.items.find((i) => i.slug === r.slug && !i.notionPageId)
    || null;
}
const LIVE = new Set([STATUS.publishReq, STATUS.published, STATUS.editing, STATUS.republishReq]);
function validate(r, rows) {
  const d = store.get();
  const errors = [...r.linkErrors];
  const warnings = [];
  if (!r.title) errors.push('공개 제목이 비어 있어요.');
  if (!KEY_RE.test(r.slug) || r.slug.length > 80) errors.push(`작품 주소 '${r.slug}'는 영문 소문자, 숫자, - 만 쓸 수 있어요.`);
  const key = r.cat && r.cat.key;
  if (!r.cat) errors.push('카테고리가 비어 있어요.');
  else if (r.cat.type !== TOP) errors.push(`카테고리 '${r.cat.name}'는 상위 분류가 아니에요.`);
  else if (!d.categories[key]) errors.push(`카테고리 '${r.cat.name}'(${key})가 사이트 분류에 없어요.`);
  else if (!store.categoryShown(key)) warnings.push(`카테고리 '${r.cat.name}'는 지금 사이트에 표시되지 않아요 (사용 해제 또는 방 물건 미연결).`);
  if (r.sub && (r.sub.type !== SUBTYPE || r.sub.parentKey !== key)) errors.push(`하위 분류 '${r.sub.name}'는 카테고리 '${r.cat ? r.cat.name : ''}'의 하위가 아니에요.`);
  const item = findItem(r);
  const other = d.items.find((i) => i.slug === r.slug && i !== item);
  if (other) errors.push(`작품 주소 '${r.slug}'를 다른 작품('${other.title}')이 쓰고 있어요.`);
  if (item && item.notionPageId && item.slug !== r.slug) errors.push(`첫 발행 뒤에는 작품 주소를 바꿀 수 없어요. '${item.slug}'로 되돌려 주세요.`);
  if (r.featured && key) {
    const clash = rows.filter((o) => o.pageId !== r.pageId && o.featured && o.cat && o.cat.key === key && LIVE.has(o.status));
    if (clash.length) errors.push(`같은 카테고리에 대표작이 이미 있어요: ${clash.map((c) => c.title).join(', ')}. 한 곳만 체크해 주세요.`);
  }
  for (const [k, label] of [['cover', '표지'], ['thumb', '썸네일'], ['audio', '음원']]) {
    if (r.files[k].length > 1) warnings.push(`${label}이 ${r.files[k].length}개라 첫 번째만 써요.`);
  }
  if (r.files.audio.length && key && store.kindOf(key) !== 'compositions') warnings.push('음원은 작곡 카테고리에서만 써서 이번에는 넣지 않았어요.');
  return { errors, warnings, item };
}

/* ---------- 파일 복사 ---------- */
function safeUrl(u) {
  try {
    const p = new URL(String(u || '').trim());
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : '';
  } catch { return ''; }
}
function privateHost(h) {
  h = h.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h.endsWith('.localhost') || h === '::1' || /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || /^f[cd]/.test(h);
}
function sniffImage(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b.slice(0, 4).toString('latin1') === 'GIF8') return 'image/gif';
  if (b.length > 12 && b.slice(0, 4).toString('latin1') === 'RIFF' && b.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return '';
}
async function download(f, kind) {
  const label = f.name || kind;
  const u = safeUrl(f.url);
  if (!u) throw new Error(`'${label}' 파일 주소가 올바르지 않아요.`);
  if (privateHost(new URL(u).hostname) && process.env.NOTION_ALLOW_LOCAL_FILES !== '1') throw new Error(`'${label}': 내부 주소의 파일은 가져오지 않아요.`);
  let r;
  try { r = await fetch(u, { signal: AbortSignal.timeout(60000) }); } catch (e) { throw new Error(`'${label}' 파일을 내려받지 못했어요 (${e.name === 'TimeoutError' ? '시간 초과' : e.message}).`); }
  if (!r.ok) throw new Error(`'${label}' 파일을 내려받지 못했어요 (${r.status}). 노션에서 파일이 지워졌거나 링크가 만료됐을 수 있어요.`);
  const max = kind === 'audio' ? AUDIO_MAX : IMAGE_MAX;
  if (Number(r.headers.get('content-length') || 0) > max) throw new Error(`'${label}' 파일이 너무 커요 (${Math.round(max / 1048576)}MB까지).`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (!buf.length) throw new Error(`'${label}' 파일이 비어 있어요.`);
  if (buf.length > max) throw new Error(`'${label}' 파일이 너무 커요 (${Math.round(max / 1048576)}MB까지).`);
  let mime = '';
  if (kind === 'audio') {
    const ct = String(r.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    const ext = (label.match(/\.(\w+)$/) || [])[1];
    mime = AUDIO_MIME.has(ct) ? ct : AUDIO_EXT[String(ext || '').toLowerCase()] || '';
    if (!mime) throw new Error(`'${label}': 음원은 mp3, m4a, ogg, wav만 쓸 수 있어요.`);
  } else {
    mime = sniffImage(buf);
    if (!mime) throw new Error(`'${label}': 이미지는 png, jpg, webp, gif만 쓸 수 있어요.`);
  }
  return { kind, buf, mime, name: label.slice(0, 200) };
}

/* ---------- 발행 ---------- */
// 글과 파일을 모두 준비한 다음, 마지막에 한 번에 바꾼다.
async function publish(r, warnings) {
  const d = store.get();
  const { body, skipped, nested } = await notion.pageBody(r.pageId);
  if (skipped) warnings.push(`본문에서 글이 아닌 블록 ${skipped}개는 넣지 않았어요 (이미지는 갤러리 속성에 넣어 주세요).`);
  if (nested) warnings.push(`본문의 하위 블록(들여쓴 내용) ${nested}곳은 넣지 않았어요.`);
  const key = r.cat.key;
  const wanted = [];
  if (r.files.cover[0]) wanted.push(['cover', r.files.cover[0]]);
  if (r.files.thumb[0]) wanted.push(['thumb', r.files.thumb[0]]);
  r.files.gallery.forEach((f) => wanted.push(['gallery', f]));
  if (r.files.audio[0] && store.kindOf(key) === 'compositions') wanted.push(['audio', r.files.audio[0]]);
  const staged = [];
  for (const [kind, f] of wanted) staged.push(await download(f, kind)); // 하나라도 실패하면 여기서 멈춘다

  // 파일을 먼저 디스크에 쓴다. 실패하면 쓴 것을 지우고 멈춘다.
  const written = [];
  try {
    for (const s of staged) {
      const id = store.newId();
      fs.writeFileSync(path.join(store.UPLOAD_DIR, id), s.buf);
      written.push({ ...s, id });
    }
  } catch (e) {
    written.forEach((w) => fs.rmSync(path.join(store.UPLOAD_DIR, w.id), { force: true }));
    throw new Error(`이미지를 저장하지 못했어요: ${e.message}`);
  }

  // 여기부터는 실패할 일이 없는 동기 작업이라 공개본이 반쯤 바뀌는 일이 없다.
  const now = nowIso();
  let item = findItem(r);
  if (!item) { item = store.blankItem({ createdAt: now, updatedAt: now }); d.items.push(item); }
  const old = [item.coverFileId, item.thumbFileId, item.audioFileId, ...item.galleryFileIds].filter(Boolean);
  const rec = (w) => ({ id: w.id, itemId: item.id, kind: w.kind, name: w.name, mime: w.mime, size: w.buf.length, createdAt: now });
  d.files.push(...written.map(rec));
  const pick = (k) => (written.find((w) => w.kind === k) || {}).id || null;
  const firstPub = item.firstPublishedAt || (r.firstPub && !isNaN(Date.parse(r.firstPub)) ? new Date(r.firstPub).toISOString() : null) || now;
  Object.assign(item, {
    slug: r.slug, category: key, sub: r.sub ? r.sub.key : '',
    title: r.title.slice(0, 500), summary: r.summary.slice(0, 500), context: r.context.slice(0, 500), role: r.role.slice(0, 500), result: r.result.slice(0, 500),
    body: body.slice(0, 20000), links: r.links,
    coverFileId: pick('cover'), thumbFileId: pick('thumb'), audioFileId: pick('audio'),
    galleryFileIds: written.filter((w) => w.kind === 'gallery').map((w) => w.id),
    isFeatured: r.featured, isPublic: true,
    notionPageId: r.pageId, firstPublishedAt: firstPub, lastPublishedAt: now,
    publishedVersion: (item.publishedVersion || r.version || 0) + 1, publishedFp: r.fp, pendingWriteback: true,
    updatedAt: now,
  });
  if (item.isFeatured) d.items.forEach((o) => { if (o !== item && o.category === item.category) o.isFeatured = false; });
  store.save();
  // 예전 공개 파일은 교체가 끝난 뒤에 지운다.
  d.files = d.files.filter((f) => !old.includes(f.id));
  old.forEach((id) => fs.rmSync(path.join(store.UPLOAD_DIR, id), { force: true }));
  store.save();
  return item;
}
async function writePublished(item, r, warnings) {
  warnings = warnings && warnings.length ? warnings : item.publishWarnings || [];
  const memo = `v${item.publishedVersion} 발행 완료 · ${kst(item.lastPublishedAt)}` + (warnings.length ? `\n참고: ${warnings.join(' / ')}` : '');
  await notion.updatePage(r.pageId, {
    [F.siteId]: rich(item.id),
    [F.firstPub]: { date: { start: item.firstPublishedAt } },
    [F.lastPub]: { date: { start: item.lastPublishedAt } },
    [F.version]: { number: item.publishedVersion },
    [F.status]: { select: { name: STATUS.published } },
    [F.memo]: rich(memo),
  });
  item.pendingWriteback = false;
  delete item.publishWarnings;
  store.save();
}
const unpublishMemo = (now) => `비공개로 전환 · ${kst(now)}. 작품 주소와 최초 발행일은 남겨 둬요. 다시 올리려면 '재발행 요청'.`;
async function unpublish(r, defer) {
  const d = store.get();
  const item = d.items.find((i) => i.notionPageId === r.pageId) || null;
  const now = nowIso();
  if (item && item.isPublic) {
    item.isPublic = false;
    item.unpublishedAt = now;
    item.updatedAt = now;
    store.save();
  }
  if (item && defer) {
    // 사이트 반영(저장소에 올리기)이 끝난 뒤 flushWritebacks()가 노션에 적는다.
    item.pendingWriteback = 'unpublished';
    store.save();
    return item;
  }
  await notion.updatePage(r.pageId, {
    [F.status]: { select: { name: STATUS.unpublished } },
    [F.memo]: rich(item ? unpublishMemo(item.unpublishedAt || now) : `사이트에 공개본이 없었어요 · ${kst(now)}`),
  });
  if (item) { item.pendingWriteback = false; store.save(); }
  return item;
}
// 사이트에 반영된 뒤 미뤄 둔 노션 기록을 적는다. 실패한 것은 다음 실행 때 다시 시도된다.
async function flushWritebacks() {
  const out = { written: [], failed: [] };
  for (const item of store.get().items.filter((i) => i.pendingWriteback && i.notionPageId)) {
    try {
      if (item.pendingWriteback === 'unpublished') {
        await notion.updatePage(item.notionPageId, {
          [F.status]: { select: { name: STATUS.unpublished } },
          [F.memo]: rich(unpublishMemo(item.unpublishedAt || nowIso())),
        });
        item.pendingWriteback = false;
        store.save();
      } else {
        await writePublished(item, { pageId: item.notionPageId }, []);
      }
      out.written.push(item.title);
      log('ok', item.title, '노션에 발행 결과를 적었어요.');
    } catch (e) {
      out.failed.push({ title: item.title, error: e.message });
      log('warn', item.title, `사이트 반영은 끝났지만 노션에 기록하지 못했어요. 다음 실행 때 다시 적어요. (${e.message})`);
    }
  }
  store.save();
  return out;
}
async function recordFailure(r, errors) {
  const s = state();
  const memo = `발행하지 못했어요 · ${kst(nowIso())}\n${errors.map((e) => '- ' + e).join('\n')}\n기존 공개본은 그대로예요. 고친 뒤 다시 요청해 주세요.`;
  let fp = r.fp;
  try {
    const page = await notion.updatePage(r.pageId, { [F.memo]: rich(memo) });
    fp = fingerprint(page); // 방금 쓴 메모 때문에 바뀐 지문. 사용자가 고치기 전까지는 다시 시도하지 않는다.
  } catch (e) {
    log('error', r.title, `노션에 실패 메모를 적지 못했어요: ${e.message}`);
  }
  s.failures[r.pageId] = { fp, at: nowIso(), errors, title: r.title };
  store.save();
}

/* ---------- 한 번 실행 ---------- */
let running = null;
function run(opts = {}) {
  if (!running) running = runOnce(opts).finally(() => { running = null; });
  return running;
}
async function loadAll() {
  const cfg = notion.config();
  const catRows = parseCategoryRows(await notion.queryAll(cfg.categoryDs));
  const pages = await notion.queryAll(cfg.showcaseDs);
  return { catRows, pages };
}
// deferWriteback: 정적 사이트용. 발행·비공개 전환의 노션 기록을 사이트 반영 뒤로 미룬다 (flushWritebacks).
// stamp: false면 실행 시각을 저장하지 않는다 (저장소에 불필요한 변경이 생기지 않게).
async function runOnce({ force = false, deferWriteback = false, stamp = true } = {}) {
  const s = state();
  const result = { at: nowIso(), categoriesChanged: false, settingsChanged: false, published: [], unpublished: [], failed: [], skipped: [], errors: [] };
  if (stamp) s.lastRunAt = result.at;
  if (!notion.configured()) {
    result.errors.push('서버에 NOTION_TOKEN이 설정되지 않았어요.');
    return result;
  }
  let catRows, pages;
  try {
    ({ catRows, pages } = await loadAll());
    const { categories, problems } = buildCategories(catRows);
    result.categoriesChanged = applyCategories(categories);
    problems.forEach((p) => log('warn', '분류 관리', p));
    if (result.categoriesChanged) log('ok', '분류 관리', '분류 이름·순서·방 물건 연결을 노션 기준으로 맞췄어요.');
    if (notion.config().settingsDs) {
      const { changed, problems: sp } = applySettings(await notion.queryAll(notion.config().settingsDs));
      result.settingsChanged = changed;
      sp.forEach((p) => log('warn', '사이트 설정', p));
      if (changed) log('ok', '사이트 설정', '이메일·소개·링크 등을 노션 기준으로 맞췄어요.');
    }
    store.save();
  } catch (e) {
    result.errors.push(e.message);
    log('error', '동기화', `${e.message} 기존 전시와 분류는 그대로 뒀어요.`);
    store.save();
    return result;
  }
  const catIdx = categoryIndex(catRows);
  const rows = pages.map((p) => readShowcase(p, catIdx));
  const schema = rows.find((r) => r.schemaError);
  if (schema) {
    result.errors.push(schema.schemaError);
    log('error', '전시 게시물', schema.schemaError);
    store.save();
    return result;
  }
  for (const r of rows) {
    const isPub = r.status === STATUS.publishReq || r.status === STATUS.republishReq;
    if (!isPub && r.status !== STATUS.unpublishReq) continue;
    const fail = s.failures[r.pageId];
    if (!force && fail && fail.fp === r.fp) { result.skipped.push({ title: r.title, reason: '지난번과 같은 내용이라 다시 시도하지 않았어요.' }); continue; }
    try {
      if (!isPub) {
        const item = await unpublish(r, deferWriteback);
        result.unpublished.push({ title: r.title, slug: item ? item.slug : r.slug });
        log('ok', r.title, '비공개로 전환했어요.');
      } else {
        const existing = findItem(r);
        if (existing && existing.pendingWriteback === true && existing.publishedFp === r.fp) {
          // 사이트 공개는 끝났고 노션 기록만 못 한 경우: 다시 받지 않고 기록만 한다.
          await writePublished(existing, r, []);
          result.published.push({ title: r.title, slug: existing.slug, version: existing.publishedVersion, writebackOnly: true });
          log('ok', r.title, `노션에 v${existing.publishedVersion} 발행 기록을 남겼어요.`);
        } else {
          const { errors, warnings } = validate(r, rows);
          if (errors.length) throw Object.assign(new Error(errors.join(' / ')), { list: errors });
          const item = await publish(r, warnings);
          result.published.push({ title: r.title, slug: item.slug, version: item.publishedVersion });
          log('ok', r.title, `v${item.publishedVersion} 공개 (/w/${item.slug})${warnings.length ? ' · ' + warnings.join(' / ') : ''}`);
          if (deferWriteback) item.publishWarnings = warnings;
          else try {
            await writePublished(item, r, warnings);
          } catch (e) {
            log('warn', r.title, `사이트 공개는 끝났지만 노션에 기록하지 못했어요. 다음 동기화 때 다시 기록해요. (${e.message})`);
          }
        }
      }
      delete s.failures[r.pageId];
    } catch (e) {
      const list = e.list || [e.message];
      result.failed.push({ title: r.title, errors: list });
      log('error', r.title, `발행하지 못했어요. 기존 공개본은 그대로예요. ${list.join(' / ')}`);
      await recordFailure(r, list);
    }
  }
  if (!result.errors.length && stamp) s.lastOkAt = result.at;
  store.save();
  return result;
}

/* ---------- 관리자용 ---------- */
async function listRows() {
  const { catRows, pages } = await loadAll();
  const catIdx = categoryIndex(catRows);
  const s = state();
  return pages.map((p) => readShowcase(p, catIdx)).map((r) => {
    const item = findItem(r);
    return {
      pageId: r.pageId, url: r.url, title: r.title, slug: r.slug, status: r.status, edited: r.edited, featured: r.featured,
      category: r.cat ? r.cat.name : '', memo: r.memo,
      site: item ? { adopt: !item.notionPageId, isPublic: item.isPublic && store.categoryShown(item.category), version: item.publishedVersion, lastPublishedAt: item.lastPublishedAt, firstPublishedAt: item.firstPublishedAt, slug: item.slug, pendingWriteback: !!item.pendingWriteback } : null,
      failure: s.failures[r.pageId] || null,
    };
  });
}
// 아직 공개하지 않은 노션 버전을 그대로 보여준다. 파일은 노션의 임시 주소를 쓰고 사이트에 복사하지 않는다.
async function preview(pageId) {
  const cfg = notion.config();
  const page = await notion.getPage(pageId);
  const parent = page.parent || {};
  if (normId(parent.data_source_id) !== normId(cfg.showcaseDs) && normId(parent.database_id) !== normId(cfg.showcaseDb)) {
    throw Object.assign(new Error("'전시 게시물'의 페이지만 미리 볼 수 있어요."), { status: 404 });
  }
  const { catRows, pages } = await loadAll();
  const catIdx = categoryIndex(catRows);
  const rows = pages.map((p) => readShowcase(p, catIdx));
  const r = readShowcase(page, catIdx);
  const { errors, warnings, item } = validate(r, rows);
  const { body, skipped, nested } = await notion.pageBody(r.pageId);
  if (skipped) warnings.push(`본문에서 글이 아닌 블록 ${skipped}개는 사이트에 넣지 않아요.`);
  if (nested) warnings.push(`본문의 하위 블록 ${nested}곳은 사이트에 넣지 않아요.`);
  const key = r.cat ? r.cat.key : '';
  const kind = store.kindOf(key) || key;
  const cover = r.files.cover[0];
  const thumb = r.files.thumb[0] || cover;
  return {
    item: {
      id: 'preview-' + r.pageId, slug: r.slug, category: key, sub: r.sub ? r.sub.key : '',
      title: r.title, summary: r.summary, context: r.context, role: r.role, result: r.result, body,
      cover: cover ? { url: cover.url, alt: r.title } : null, thumb: thumb ? thumb.url : null,
      audio: kind === 'compositions' && r.files.audio[0] ? r.files.audio[0].url : null,
      gallery: r.files.gallery.map((f) => ({ url: f.url, name: f.name })), links: r.links, isFeatured: r.featured,
    },
    categoryName: key && store.get().categories[key] ? store.get().categories[key].name : (r.cat ? r.cat.name : ''),
    kind, status: r.status, notionUrl: r.url, errors, warnings,
    current: item && item.notionPageId === r.pageId ? { isPublic: item.isPublic, version: item.publishedVersion, title: item.title, slug: item.slug }
      : item ? { isPublic: item.isPublic, version: 0, title: item.title, slug: item.slug, adopt: true } : null,
  };
}

module.exports = { STATUS, run, flushWritebacks, listRows, preview, state };
