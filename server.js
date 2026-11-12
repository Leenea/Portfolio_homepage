// 뀡잉힝 포트폴리오 서버 (외부 패키지 없이 Node 기본 모듈만 사용)
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
// 서버 전용 비밀값(.env, 저장소에 올리지 않음)을 환경변수로 읽는다. 이미 있는 환경변수가 우선이다.
(function loadEnvFile() {
  let text = '';
  try { text = fs.readFileSync(path.join(__dirname, '.env'), 'utf8'); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
})();
const store = require('./lib/store');
const notion = require('./lib/notion');
const notionSync = require('./lib/notion-sync');

const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 40 * 1024 * 1024; // 업로드는 base64 JSON으로 받으므로 넉넉히
const SESSION_TTL = 1000 * 60 * 60 * 12;

const IMAGE_MIME = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const AUDIO_MIME = new Set(['audio/mpeg', 'audio/mp3', 'audio/ogg', 'audio/wav', 'audio/x-wav', 'audio/mp4', 'audio/aac', 'audio/x-m4a', 'audio/webm']);
const STATIC_MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.json': 'application/json',
};

store.load();

/* ---------- 관리자 인증 ---------- */
const sessions = new Map(); // token -> expiresAt
const loginFails = new Map(); // ip -> {count, until}

function readAdmin() {
  try {
    return JSON.parse(fs.readFileSync(store.ADMIN_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function hashPassword(pw, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(pw, salt, 64).toString('hex');
  return { salt, hash };
}
function checkPassword(pw) {
  const admin = readAdmin();
  if (!admin) return false;
  const { hash } = hashPassword(pw, admin.salt);
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(admin.hash, 'hex'));
}
function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function isAdmin(req) {
  const t = parseCookies(req).kk_admin;
  if (!t) return false;
  const exp = sessions.get(t);
  if (!exp || exp < Date.now()) {
    sessions.delete(t);
    return false;
  }
  return true;
}
function isLoopback(req) {
  const a = req.socket.remoteAddress || '';
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1';
}
function sessionCookie(req, token, maxAge) {
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `kk_admin=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure}`;
}

/* ---------- 응답 도우미 ---------- */
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...headers });
  res.end(body);
}
function json(res, status, data) {
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(Object.assign(new Error('bad json'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function safeUrl(u) {
  u = String(u || '').trim();
  if (!u) return '';
  try {
    const p = new URL(u);
    return p.protocol === 'http:' || p.protocol === 'https:' ? p.toString() : '';
  } catch {
    return '';
  }
}

/* ---------- 공개 규칙 (lib/public.js) ---------- */
const pub = require('./lib/public');
const { itemById, fileById, itemVisible, fileIsPublic } = pub;

/* ---------- 정적 파일 ---------- */
function serveStatic(req, res, rel, extraHeaders = {}) {
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return send(res, 404, 'Not found');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'Not found');
    send(res, 200, data, {
      'Content-Type': STATIC_MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': rel.startsWith('img/') ? 'public, max-age=3600' : 'no-cache',
      ...extraHeaders,
    });
  });
}
function serveIndex(res, meta = {}, extraHeaders = {}) {
  const html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  const name = store.get().settings.siteName || 'Plot Twist';
  const title = meta.title ? `${meta.title} · ${name}` : name;
  const desc = meta.description || `Step into ${name}'s treehouse. Open the door and look around the room.`;
  const out = html
    .replace('<title>__SITE_TITLE__</title>', `<title>${escapeHtml(title)}</title>`)
    .replaceAll('__META_DESCRIPTION__', escapeHtml(desc))
    .replace('__OG_TITLE__', escapeHtml(title))
    .replace('__OG_IMAGE__', meta.image ? `<meta property="og:image" content="${escapeHtml(meta.image)}">` : '');
  send(res, meta.status || 200, out, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...extraHeaders });
}
function serveFile(req, res, id) {
  const f = fileById(id);
  const admin = isAdmin(req);
  if (!f || !(admin || fileIsPublic(f))) return send(res, 404, 'Not found');
  const p = path.join(store.UPLOAD_DIR, f.id);
  fs.stat(p, (err, st) => {
    if (err) return send(res, 404, 'Not found');
    const headers = {
      'Content-Type': f.mime,
      'Cache-Control': admin && !fileIsPublic(f) ? 'private, no-store' : 'public, max-age=60',
      'Accept-Ranges': 'bytes',
    };
    if (f.kind === 'attachment') headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`;
    // 오디오 탐색을 위한 Range 지원
    const range = req.headers.range && /bytes=(\d*)-(\d*)/.exec(req.headers.range);
    if (range) {
      const start = range[1] ? Number(range[1]) : 0;
      const end = range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) return send(res, 416, '', { 'Content-Range': `bytes */${st.size}` });
      res.writeHead(206, { ...headers, 'X-Content-Type-Options': 'nosniff', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(p, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'X-Content-Type-Options': 'nosniff', 'Content-Length': st.size });
    fs.createReadStream(p).pipe(res);
  });
}

/* ---------- 관리자 API ---------- */
// 노션에서 발행한 작품은 공개 내용을 노션에서만 바꾼다. 여기서는 비공개 메모와 진행 기록만 받는다.
const NOTION_EDITABLE = ['privateNotes', 'logs'];
function cleanItemInput(body, item) {
  const d = store.get();
  const str = (v, max = 20000) => String(v ?? '').slice(0, max);
  if (item.notionPageId) body = Object.fromEntries(Object.entries(body).filter(([k]) => NOTION_EDITABLE.includes(k)));
  if ('category' in body) {
    if (!store.categoryKeys().includes(body.category)) throw Object.assign(new Error('알 수 없는 카테고리예요.'), { status: 400 });
    item.category = body.category;
  }
  if ('sub' in body || 'category' in body) {
    const subId = String(('sub' in body ? body.sub : item.sub) || '');
    item.sub = d.categories[item.category].subs.some((s) => s.id === subId) ? subId : '';
  }
  for (const k of ['title', 'summary', 'context', 'role', 'result']) if (k in body) item[k] = str(body[k], 500).trim();
  if ('body' in body) item.body = str(body.body);
  if ('privateNotes' in body) item.privateNotes = str(body.privateNotes, 100000);
  if ('slug' in body) {
    const slug = str(body.slug, 80).trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
    if (!slug) throw Object.assign(new Error('공유 주소는 영문 소문자, 숫자, -만 쓸 수 있어요.'), { status: 400 });
    if (d.items.some((i) => i.slug === slug && i.id !== item.id)) throw Object.assign(new Error('이미 쓰고 있는 공유 주소예요.'), { status: 400 });
    item.slug = slug;
  }
  if ('links' in body && Array.isArray(body.links)) {
    item.links = body.links
      .map((l) => ({ label: str(l.label, 60).trim() || '링크', url: str(l.url, 2000).trim() }))
      .filter((l) => l.url);
    const bad = item.links.find((l) => !safeUrl(l.url));
    if (bad) throw Object.assign(new Error(`링크 주소가 올바르지 않아요: ${bad.url}`), { status: 400 });
  }
  if ('logs' in body && Array.isArray(body.logs)) {
    item.logs = body.logs.map((l) => ({ id: l.id || store.newId(), date: str(l.date, 20), text: str(l.text, 20000) })).filter((l) => l.text.trim());
  }
  if ('galleryFileIds' in body && Array.isArray(body.galleryFileIds)) {
    item.galleryFileIds = body.galleryFileIds.filter((id) => item.galleryFileIds.includes(id));
  }
  if ('sort' in body) item.sort = Number(body.sort) || 0;
  if ('isPublic' in body) item.isPublic = !!body.isPublic;
  if ('isFeatured' in body) item.isFeatured = !!body.isFeatured;
  if (item.isFeatured) d.items.forEach((o) => { if (o !== item && o.category === item.category) o.isFeatured = false; });
  item.updatedAt = new Date().toISOString();
}

function removeFile(id) {
  const d = store.get();
  d.files = d.files.filter((f) => f.id !== id);
  fs.rm(path.join(store.UPLOAD_DIR, id), { force: true }, () => {});
}

async function adminApi(req, res, url) {
  const d = store.get();
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/admin/me' && m === 'GET') {
    return json(res, 200, { loggedIn: isAdmin(req), needsSetup: !readAdmin(), canSetup: !readAdmin() && isLoopback(req) });
  }
  if (p === '/api/admin/setup' && m === 'POST') {
    if (readAdmin() || !isLoopback(req)) return json(res, 403, { error: '처음 설정은 서버가 켜진 컴퓨터에서만 할 수 있어요.' });
    const body = await readBody(req);
    if (String(body.password || '').length < 8) return json(res, 400, { error: '비밀번호는 8자 이상이어야 해요.' });
    fs.writeFileSync(store.ADMIN_FILE, JSON.stringify(hashPassword(String(body.password))), { mode: 0o600 });
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(req, token, SESSION_TTL / 1000) });
  }
  if (p === '/api/admin/login' && m === 'POST') {
    const ip = req.socket.remoteAddress;
    const f = loginFails.get(ip);
    if (f && f.until > Date.now()) return json(res, 429, { error: '잠시 후 다시 시도해 주세요.' });
    const body = await readBody(req);
    if (!checkPassword(String(body.password || ''))) {
      const count = (f?.count || 0) + 1;
      loginFails.set(ip, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
      return json(res, 401, { error: '비밀번호가 맞지 않아요.' });
    }
    loginFails.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, Date.now() + SESSION_TTL);
    return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(req, token, SESSION_TTL / 1000) });
  }
  if (p === '/api/admin/logout' && m === 'POST') {
    sessions.delete(parseCookies(req).kk_admin);
    return send(res, 200, '{"ok":true}', { 'Content-Type': 'application/json', 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  // 이 아래는 로그인 필요. 변경 요청에는 사용자 정의 헤더를 요구해 CSRF를 막는다.
  if (!isAdmin(req)) return json(res, 401, { error: '로그인이 필요해요.' });
  if (m !== 'GET' && req.headers['x-kk-admin'] !== '1') return json(res, 403, { error: 'forbidden' });

  if (p === '/api/admin/data' && m === 'GET') {
    const categoriesKo = Object.fromEntries(store.categoryKeys().map((k) => [k, d.categories[k].ko || store.CATEGORIES_KO[k] || k]));
    return json(res, 200, { categoryKeys: store.categoryKeys(), categoriesKo, categories: d.categories, settings: d.settings, items: d.items, files: d.files, notion: { configured: notion.configured() } });
  }
  if (p === '/api/admin/settings' && m === 'PUT') {
    const body = await readBody(req);
    for (const k of ['naverUrl', 'instagramUrl']) {
      if (k in body) {
        const v = String(body[k] || '').trim();
        if (v && !safeUrl(v)) return json(res, 400, { error: `주소가 올바르지 않아요: ${v}` });
        d.settings[k] = v;
      }
    }
    if ('siteName' in body) {
      const v = String(body.siteName || '').trim().slice(0, 40);
      if (!v) return json(res, 400, { error: '사이트 이름을 비울 수는 없어요.' });
      d.settings.siteName = v;
    }
    if ('email' in body) {
      const v = String(body.email || '').trim();
      if (v && !/^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(v)) return json(res, 400, { error: `이메일 주소 형식이 올바르지 않아요: ${v}` });
      d.settings.email = v.slice(0, 200);
    }
    if ('aboutText' in body) d.settings.aboutText = String(body.aboutText || '').slice(0, 2000);
    if ('aboutHistory' in body) d.settings.aboutHistory = String(body.aboutHistory || '').slice(0, 3000);
    if ('featuredTrackId' in body) {
      const t = body.featuredTrackId ? itemById(String(body.featuredTrackId)) : null;
      if (body.featuredTrackId && (!t || t.category !== 'compositions')) return json(res, 400, { error: '대표곡은 작곡 카테고리의 항목만 고를 수 있어요.' });
      d.settings.featuredTrackId = t ? t.id : null;
    }
    store.save();
    return json(res, 200, { settings: d.settings });
  }
  if (p === '/api/admin/categories' && m === 'PUT') {
    if (notion.configured()) return json(res, 409, { error: '분류는 노션 \'분류 관리\'에서 바꿔 주세요. 다음 동기화 때 사이트에 반영돼요.' });
    const body = await readBody(req);
    const next = {};
    for (const k of store.categoryKeys()) {
      const c = body[k] || d.categories[k];
      const name = String(c.name || '').trim().slice(0, 60);
      const button = String(c.button || '').trim().slice(0, 60);
      if (!name || !button) return json(res, 400, { error: `${store.CATEGORIES_KO[k]}: 이름과 버튼 문구를 비울 수 없어요.` });
      const seen = new Set();
      const subs = [];
      for (const s of Array.isArray(c.subs) ? c.subs : []) {
        const sname = String(s.name || '').trim().slice(0, 60);
        if (!sname) continue;
        let id = String(s.id || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        if (!id) id = 'sub-' + crypto.randomBytes(3).toString('hex');
        if (seen.has(id)) continue;
        seen.add(id);
        subs.push({ id, name: sname, ko: String(s.ko || '').trim().slice(0, 60) });
      }
      const prev = d.categories[k];
      next[k] = { ...prev, name, button, subs: subs.map((x) => ({ ...x, enabled: true })) };
    }
    d.categories = next;
    // 지워진 하위 분류에 있던 항목은 '분류 없음'으로 돌린다.
    for (const item of d.items) if (item.sub && !next[item.category].subs.some((s) => s.id === item.sub)) item.sub = '';
    store.save();
    return json(res, 200, { categories: d.categories });
  }
  if (p === '/api/admin/items' && m === 'POST') {
    const body = await readBody(req);
    const now = new Date().toISOString();
    const item = store.blankItem({ title: '새 항목', createdAt: now, updatedAt: now });
    cleanItemInput({ ...body, isPublic: false }, item);
    d.items.push(item);
    store.save();
    return json(res, 200, { item });
  }
  let mm;
  if ((mm = /^\/api\/admin\/items\/([a-f0-9]+)$/.exec(p))) {
    const item = itemById(mm[1]);
    if (!item) return json(res, 404, { error: '항목이 없어요.' });
    if (m === 'PUT') {
      const body = await readBody(req);
      cleanItemInput(body, item);
      store.save();
      return json(res, 200, { item });
    }
    if (m === 'DELETE') {
      if (item.notionPageId) return json(res, 409, { error: '노션에서 발행한 작품이에요. 노션 \'전시 게시물\'에서 \'내림 요청\'으로 비공개로 돌려 주세요.' });
      [item.coverFileId, item.thumbFileId, item.audioFileId, ...item.galleryFileIds, ...item.attachmentFileIds].filter(Boolean).forEach(removeFile);
      d.items = d.items.filter((i) => i !== item);
      if (d.settings.featuredTrackId === item.id) d.settings.featuredTrackId = null;
      store.save();
      return json(res, 200, { ok: true });
    }
  }
  if ((mm = /^\/api\/admin\/items\/([a-f0-9]+)\/files$/.exec(p)) && m === 'POST') {
    const item = itemById(mm[1]);
    if (!item) return json(res, 404, { error: '항목이 없어요.' });
    const body = await readBody(req);
    const kind = body.kind;
    const mime = String(body.mime || 'application/octet-stream').toLowerCase();
    if (!['cover', 'thumb', 'gallery', 'attachment', 'audio'].includes(kind)) return json(res, 400, { error: 'bad kind' });
    if (item.notionPageId && kind !== 'attachment') return json(res, 409, { error: '이 작품의 공개 이미지·음원은 노션 \'전시 게시물\'에서 바꾼 뒤 재발행해 주세요.' });
    if (kind === 'audio' && !AUDIO_MIME.has(mime)) return json(res, 400, { error: 'mp3, m4a, ogg, wav 같은 음원 파일만 올릴 수 있어요.' });
    if (['cover', 'thumb', 'gallery'].includes(kind) && !IMAGE_MIME.has(mime)) return json(res, 400, { error: '이미지는 png, jpg, webp, gif만 올릴 수 있어요.' });
    const buf = Buffer.from(String(body.data || ''), 'base64');
    if (!buf.length) return json(res, 400, { error: '빈 파일이에요.' });
    const f = { id: store.newId(), itemId: item.id, kind, name: String(body.name || 'file').slice(0, 200), mime: kind === 'attachment' ? mime.replace(/[^\w/.+-]/g, '') || 'application/octet-stream' : mime, size: buf.length, createdAt: new Date().toISOString() };
    fs.writeFileSync(path.join(store.UPLOAD_DIR, f.id), buf);
    d.files.push(f);
    if (kind === 'cover') {
      if (item.coverFileId) removeFile(item.coverFileId);
      item.coverFileId = f.id;
    } else if (kind === 'thumb') {
      if (item.thumbFileId) removeFile(item.thumbFileId);
      item.thumbFileId = f.id;
    } else if (kind === 'audio') {
      if (item.audioFileId) removeFile(item.audioFileId);
      item.audioFileId = f.id;
    } else if (kind === 'gallery') item.galleryFileIds.push(f.id);
    else item.attachmentFileIds.push(f.id);
    item.updatedAt = new Date().toISOString();
    store.save();
    return json(res, 200, { item, file: f });
  }
  if ((mm = /^\/api\/admin\/files\/([a-f0-9]+)$/.exec(p)) && m === 'DELETE') {
    const f = fileById(mm[1]);
    if (!f) return json(res, 404, { error: '파일이 없어요.' });
    const item = itemById(f.itemId);
    if (item && item.notionPageId && f.kind !== 'attachment') return json(res, 409, { error: '이 작품의 공개 파일은 노션에서 바꾼 뒤 재발행해 주세요.' });
    if (item) {
      if (item.coverFileId === f.id) item.coverFileId = null;
      if (item.thumbFileId === f.id) item.thumbFileId = null;
      if (item.audioFileId === f.id) item.audioFileId = null;
      item.galleryFileIds = item.galleryFileIds.filter((x) => x !== f.id);
      item.attachmentFileIds = item.attachmentFileIds.filter((x) => x !== f.id);
    }
    removeFile(f.id);
    store.save();
    return json(res, 200, { item: item || null });
  }
  /* 노션 연동 */
  if (p === '/api/admin/notion' && m === 'GET') {
    const s = notionSync.state();
    const out = { configured: notion.configured(), localPublish: LOCAL_PUBLISH, lastRunAt: s.lastRunAt, lastOkAt: s.lastOkAt, log: s.log.slice(0, 40), intervalMinutes: SYNC_MINUTES, rows: null, rowsError: '' };
    if (out.configured && url.searchParams.get('rows') === '1') {
      try { out.rows = await notionSync.listRows(); } catch (e) { out.rowsError = e.message; }
    }
    return json(res, 200, out);
  }
  if (p === '/api/admin/notion/sync' && m === 'POST') {
    if (!notion.configured()) return json(res, 400, { error: '서버에 NOTION_TOKEN이 설정되지 않았어요.' });
    if (!LOCAL_PUBLISH) return json(res, 409, { error: '발행은 GitHub에서 처리해요. GitHub 저장소의 Actions → Notion sync → Run workflow로 바로 실행할 수 있어요.' });
    const body = await readBody(req);
    const result = await notionSync.run({ force: !!body.force });
    return json(res, 200, { result });
  }
  if ((mm = /^\/api\/admin\/notion\/preview\/([a-f0-9-]{32,36})$/.exec(p)) && m === 'GET') {
    if (!notion.configured()) return json(res, 400, { error: '서버에 NOTION_TOKEN이 설정되지 않았어요.' });
    try {
      return json(res, 200, await notionSync.preview(mm[1]));
    } catch (e) {
      return json(res, e.status === 404 ? 404 : 502, { error: e.message });
    }
  }
  return json(res, 404, { error: 'not found' });
}

/* ---------- 라우터 ---------- */
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);

    if (p.startsWith('/api/admin/')) return await adminApi(req, res, url);

    if (p === '/api/site' && req.method === 'GET') {
      return json(res, 200, pub.siteData());
    }
    let mm;
    if ((mm = /^\/api\/items\/([a-z0-9-]+)$/.exec(p)) && req.method === 'GET') {
      const data = pub.itemData(mm[1]);
      if (!data) return json(res, 404, { error: 'Not found' });
      return json(res, 200, data);
    }
    if ((mm = /^\/files\/([a-f0-9]+)$/.exec(p))) return serveFile(req, res, mm[1]);

    if ((mm = /^\/w\/([a-z0-9-]+)\/?$/.exec(p))) {
      const item = store.get().items.find((i) => i.slug === mm[1] && itemVisible(i));
      if (!item) return serveIndex(res, { status: 404, title: 'Not found' });
      return serveIndex(res, { title: item.title, description: item.summary, image: item.coverFileId ? `/files/${item.coverFileId}` : '' });
    }
    if (p === '/' || p === '/index.html' || p === '/room') return serveIndex(res);
    // 관리자용 비공개 미리보기. 화면 틀만 주고, 내용은 로그인한 관리자에게만 API로 준다.
    if (/^\/preview\/[a-f0-9-]{32,36}$/.test(p)) return serveIndex(res, { title: 'Preview' }, { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' });
    if (p === '/admin' || p === '/admin/') return serveStatic(req, res, 'admin/index.html', { 'X-Frame-Options': 'DENY', 'Cache-Control': 'no-store' });
    return serveStatic(req, res, p.slice(1));
  } catch (e) {
    if (!res.headersSent) json(res, e.status || 500, { error: e.status ? e.message : '서버 오류가 났어요.' });
    if (!e.status) console.error(e);
  }
});

/* ---------- 노션 자동 확인 ---------- */
// 노션에서 '발행 요청'·'재발행 요청'·'내림 요청'으로 바꾼 작품만 처리한다. 0이면 관리자 화면의 버튼으로만 실행한다.
// 실제 사이트는 정적 사이트(GitHub Actions + Cloudflare Pages)에서 발행한다.
// 이 서버가 노션 발행까지 처리하는 건 NOTION_LOCAL_PUBLISH=1일 때만이다 (두 곳이 동시에 발행하지 않게).
const LOCAL_PUBLISH = process.env.NOTION_LOCAL_PUBLISH === '1';
const SYNC_MINUTES = LOCAL_PUBLISH ? Math.max(0, Number(process.env.NOTION_SYNC_MINUTES ?? 5) || 0) : 0;
if (notion.configured() && SYNC_MINUTES > 0) {
  const tick = () => notionSync.run().catch((e) => console.error('[노션] 동기화 오류:', e.message));
  setTimeout(tick, 3000);
  setInterval(tick, SYNC_MINUTES * 60 * 1000).unref();
}

server.listen(PORT, HOST, () => {
  console.log(`뀡잉힝 서버: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`관리자 화면: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/admin`);
  if (!readAdmin()) console.log('아직 관리자 비밀번호가 없어요. 이 컴퓨터에서 /admin에 들어가 처음 설정을 해 주세요.');
  console.log(!notion.configured() ? '노션 연동: 꺼짐 (NOTION_TOKEN 없음)' : LOCAL_PUBLISH ? `노션 연동: 이 서버에서 발행 (${SYNC_MINUTES ? SYNC_MINUTES + '분마다 확인' : '관리자 화면에서 수동 실행'})` : '노션 연동: 미리보기만 (발행은 GitHub에서)');
});
