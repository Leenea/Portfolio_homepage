// 노션 API 연결. 외부 패키지 없이 fetch만 쓴다.
// 토큰은 서버 환경변수 NOTION_TOKEN으로만 받고, 브라우저로 보내거나 기록에 남기지 않는다.
const NOTION_VERSION = '2025-09-03';

function config() {
  return {
    token: process.env.NOTION_TOKEN || '',
    base: (process.env.NOTION_API_BASE || 'https://api.notion.com').replace(/\/+$/, ''),
    // 사이트는 '전시 게시물'과 '분류 관리'만 읽는다. '작업물'은 읽지 않는다.
    showcaseDs: process.env.NOTION_SHOWCASE_DS || '41612c37-d092-43eb-8894-bc81fdb6d8a5',
    showcaseDb: process.env.NOTION_SHOWCASE_DB || 'c514f551-d393-43dc-87a7-37a9f425b2e5',
    categoryDs: process.env.NOTION_CATEGORY_DS || '2dfaa464-523a-4ca8-adfa-b3e022955846',
    // 선택: 노션 '사이트 설정' DB. 비어 있으면 사이트 설정은 저장된 값을 그대로 쓴다.
    settingsDs: process.env.NOTION_SETTINGS_DS || '',
  };
}
const configured = () => !!config().token;
const normId = (id) => String(id || '').replace(/-/g, '').toLowerCase();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class NotionError extends Error {
  constructor(message, status, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function explain(status, j) {
  const m = j.message ? ` ${j.message}` : '';
  if (status === 401) return '노션 토큰이 맞지 않아요 (401). 서버의 NOTION_TOKEN을 확인해 주세요.';
  if (status === 403) return `노션 권한이 부족해요 (403). 통합 권한에 '콘텐츠 읽기'와 '콘텐츠 업데이트'가 있는지 확인해 주세요.${m}`;
  if (status === 404) return `노션에서 대상을 찾지 못했어요 (404). 통합이 '전시 게시물'과 '분류 관리'에 연결됐는지 확인해 주세요.${m}`;
  return `노션 요청이 실패했어요 (${status}${j.code ? ' ' + j.code : ''}).${m}`;
}

async function api(method, path, body) {
  const c = config();
  if (!c.token) throw new NotionError('서버에 NOTION_TOKEN이 설정되지 않았어요.', 0, 'no_token');
  for (let attempt = 0; ; attempt++) {
    let r;
    try {
      r = await fetch(c.base + path, {
        method,
        headers: { Authorization: `Bearer ${c.token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(20000),
      });
    } catch (e) {
      if (attempt < 2) { await sleep(800 * (attempt + 1)); continue; }
      throw new NotionError(`노션에 연결하지 못했어요 (${e.name === 'TimeoutError' ? '시간 초과' : e.message}).`, 0, 'network');
    }
    if (r.status === 429 && attempt < 3) { await sleep(Math.min(10, Number(r.headers.get('retry-after')) || 1) * 1000); continue; }
    if (r.status >= 500 && attempt < 2) { await sleep(1000 * (attempt + 1)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new NotionError(explain(r.status, j), r.status, j.code);
    return j;
  }
}

async function queryAll(dataSourceId) {
  const out = [];
  let cursor = null;
  do {
    const j = await api('POST', `/v1/data_sources/${dataSourceId}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    out.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out.filter((p) => p.object === 'page' && !p.archived && !p.in_trash);
}
const getPage = (id) => api('GET', `/v1/pages/${id}`);
const updatePage = (id, properties) => api('PATCH', `/v1/pages/${id}`, { properties });
async function blockChildren(id) {
  const out = [];
  let cursor = null;
  do {
    const j = await api('GET', `/v1/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`);
    out.push(...(j.results || []));
    cursor = j.has_more ? j.next_cursor : null;
  } while (cursor);
  return out;
}

/* ---------- 속성 읽기 ---------- */
const prop = (page, name) => (page.properties || {})[name];
const has = (page, name) => !!prop(page, name);
function richText(arr) {
  return (arr || []).map((t) => {
    const s = t.plain_text ?? (t.text && t.text.content) ?? '';
    const href = t.href || (t.text && t.text.link && t.text.link.url);
    return href && !s.includes(href) ? `${s} (${href})` : s;
  }).join('');
}
function text(page, name) {
  const p = prop(page, name);
  if (!p) return '';
  if (p.type === 'title') return richText(p.title).trim();
  if (p.type === 'rich_text') return richText(p.rich_text).trim();
  if (p.type === 'url') return String(p.url || '').trim();
  return '';
}
const select = (page, name) => { const p = prop(page, name); return (p && p.select && p.select.name) || ''; };
const checkbox = (page, name) => { const p = prop(page, name); return !!(p && p.checkbox); };
const number = (page, name) => { const p = prop(page, name); return p && typeof p.number === 'number' ? p.number : null; };
const date = (page, name) => { const p = prop(page, name); return (p && p.date && p.date.start) || null; };
const relation = (page, name) => { const p = prop(page, name); return ((p && p.relation) || []).map((r) => normId(r.id)); };
function files(page, name) {
  const p = prop(page, name);
  return ((p && p.files) || [])
    .map((f) => ({ name: f.name || '', url: f.type === 'external' ? f.external && f.external.url : f.file && f.file.url }))
    .filter((f) => f.url);
}

// 페이지 본문을 문단 텍스트로 바꾼다. 빈 줄이 문단 구분이다.
async function pageBody(id) {
  const blocks = await blockChildren(id);
  const paras = [];
  let list = null;
  let skipped = 0;
  let nested = 0;
  const flush = () => { if (list) { paras.push(list.lines.join('\n')); list = null; } };
  for (const b of blocks) {
    const data = b[b.type] || {};
    const t = richText(data.rich_text);
    if (b.has_children) nested++;
    if (b.type === 'bulleted_list_item' || b.type === 'numbered_list_item' || b.type === 'to_do') {
      if (!list || list.type !== b.type) { flush(); list = { type: b.type, lines: [] }; }
      list.lines.push((b.type === 'numbered_list_item' ? `${list.lines.length + 1}. ` : '• ') + t);
      continue;
    }
    flush();
    if (['paragraph', 'heading_1', 'heading_2', 'heading_3', 'quote', 'callout'].includes(b.type)) {
      if (t.trim()) paras.push(t.trim());
    } else if (b.type !== 'divider') skipped++;
  }
  flush();
  return { body: paras.join('\n\n'), skipped, nested };
}

module.exports = {
  NOTION_VERSION, config, configured, normId, NotionError,
  queryAll, getPage, updatePage, pageBody,
  read: { prop, has, text, select, checkbox, number, date, relation, files },
};
