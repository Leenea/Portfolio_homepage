// 가짜 노션 API. 실제 노션의 '전시 게시물'·'분류 관리'와 같은 속성 이름과 응답 모양을 쓴다.
// node mock-notion.mjs <port> <project-root> <files-dir>
import http from 'http';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';

const PORT = Number(process.argv[2] || 4191);
const ROOT = process.argv[3];
const FILES = process.argv[4];
const require = createRequire(import.meta.url);
const { DEFAULT_CATEGORIES, CATEGORIES_KO, CATEGORY_KEYS } = require(path.join(ROOT, 'lib/store.js'));

const TOKEN = 'test-token';
const SHOWCASE_DS = '41612c37-d092-43eb-8894-bc81fdb6d8a5';
const SHOWCASE_DB = 'c514f551-d393-43dc-87a7-37a9f425b2e5';
const CATEGORY_DS = '2dfaa464-523a-4ca8-adfa-b3e022955846';
const WORKS_DS = 'b66d878e-43cb-4af0-bcf0-d218e71b027c';
const SETTINGS_DS = '5e7714a9-0000-4000-8000-000000000001'; // 테스트용 '사이트 설정'
const BASE = `http://127.0.0.1:${PORT}`;

const SHOWCASE_SCHEMA = {
  '공개 제목': 'title', '발행 상태': 'select', '작품 주소': 'rich_text', '카테고리': 'relation', '하위 분류': 'relation', '작업물': 'relation',
  '대표작': 'checkbox', '한 줄 요약': 'rich_text', '상세 요약': 'rich_text', '맥락': 'rich_text', '역할': 'rich_text', '결과': 'rich_text',
  '표지': 'files', '썸네일': 'files', '갤러리': 'files', '음원': 'files', '대표 링크': 'url', '대표 링크 문구': 'rich_text', '추가 링크': 'rich_text',
  '사이트 ID': 'rich_text', '최초 발행일': 'date', '최근 발행일': 'date', '발행 버전': 'number', '발행 메모': 'rich_text', '마지막 수정': 'last_edited_time',
};
const SETTINGS_SCHEMA = { '항목': 'title', '값': 'rich_text' };
const CATEGORY_SCHEMA = { '이름': 'title', '영어 이름': 'rich_text', '분류 키': 'rich_text', '구분': 'select', '상위 분류': 'relation', '하위 분류': 'relation', '방 물건': 'select', '버튼 문구': 'rich_text', '순서': 'number', '사용': 'checkbox', '메모': 'rich_text' };
const THING = { competitions: 'board', coding: 'crt', work: 'shirt', ideas: 'chest', study: 'bookshelf', clubs: 'cork', hobbies: 'bed', love: 'diary', compositions: 'turntable' };

const minute = () => { const d = new Date(); d.setSeconds(0, 0); return d.toISOString().replace('.000Z', '.000Z'); };
let seq = 0;
const fakeId = () => { seq++; return `416f55c5-9f3a-81${String(seq).padStart(2, '0')}-0000-${String(seq).padStart(12, '0')}`; };

const pages = new Map(); // id -> { id, ds, values, body, edited, archived }
function addPage(ds, values, body = [], id = fakeId()) {
  pages.set(id, { id, ds, values, body, edited: minute(), archived: false });
  return id;
}
// 분류 관리 36행 (홈페이지 기본값을 노션에 옮긴 것과 같음)
const topIds = {};
CATEGORY_KEYS.forEach((k, i) => {
  const c = DEFAULT_CATEGORIES[k];
  topIds[k] = addPage(CATEGORY_DS, { '이름': CATEGORIES_KO[k], '영어 이름': c.name, '분류 키': k, '구분': '상위 분류', '상위 분류': [], '방 물건': THING[k], '버튼 문구': c.button, '순서': i + 1, '사용': true });
});
const subIds = {};
CATEGORY_KEYS.forEach((k) => DEFAULT_CATEGORIES[k].subs.forEach((s, i) => {
  subIds[s.id] = addPage(CATEGORY_DS, { '이름': s.ko, '영어 이름': s.name, '분류 키': s.id, '구분': '하위 분류', '상위 분류': [topIds[k]], '방 물건': null, '버튼 문구': '', '순서': i + 1, '사용': true });
}));
// 전시 게시물: 노션에 실제로 있는 가치타용 행과 같은 값 (초안)
const GACHI = '416f55c5-9f3a-817e-974f-cc8fdcb493d6';
addPage(SHOWCASE_DS, {
  '공개 제목': 'Gachitayong', '발행 상태': '초안', '작품 주소': 'gachitayong', '카테고리': [topIds.competitions], '하위 분류': [subIds.hackathons], '작업물': ['416f55c5-9f3a-8132-8ff0-d83cfc0fc0d5'],
  '대표작': true, '한 줄 요약': 'A web app prototype that helps HUFS students find classmates heading the same way, so they can share carpools or taxi rides.',
  '상세 요약': '', '맥락': 'Team project · 2026 HUFS × NAVER Cloud Vibe Coding Competition', '역할': 'Team lead, Problem research, Service planning, Screen design, Backend & deployment lead', '결과': '',
  '표지': [], '썸네일': [], '갤러리': [], '음원': [], '대표 링크': 'https://49-50-141-146.sslip.io', '대표 링크 문구': 'Try the prototype', '추가 링크': '',
  '사이트 ID': '', '최초 발행일': null, '최근 발행일': null, '발행 버전': null, '발행 메모': '테스트용으로 초안 상태로 가져옴',
}, [
  'Built as a team entry for the 2026 Hankuk University of Foreign Studies × NAVER Cloud Vibe Coding Competition.',
  'As team lead, I covered problem research, service planning and screen design, and led the backend and deployment.',
], GACHI);
// 사이트 설정 (테스트 값)
const settingIds = {};
for (const [k, v] of [['이메일', 'hello@example.com'], ['네이버 블로그', 'https://blog.naver.com/example'], ['인스타그램', 'not a url'], ['자기소개', 'Test about text.'], ['주요 이력', 'Line one\nLine two']]) settingIds[k] = addPage(SETTINGS_DS, { '항목': k, '값': v });
// 작업물 DB의 페이지 (사이트가 미리보기로 열면 안 됨)
const WORK_PAGE = addPage(WORKS_DS, { '공개 제목': '가치타용 내부 기록' }, ['신청서 원문']);

const rt = (s) => (s ? [{ type: 'text', text: { content: s, link: null }, plain_text: s, href: null }] : []);
function render(p) {
  const schema = p.ds === CATEGORY_DS ? CATEGORY_SCHEMA : p.ds === SETTINGS_DS ? SETTINGS_SCHEMA : SHOWCASE_SCHEMA;
  const props = {};
  for (const [name, type] of Object.entries(schema)) {
    const v = p.values[name];
    const id = Buffer.from(name).toString('base64').slice(0, 4);
    if (type === 'title') props[name] = { id, type, title: rt(v) };
    else if (type === 'rich_text') props[name] = { id, type, rich_text: rt(v) };
    else if (type === 'select') props[name] = { id, type, select: v ? { id: 'opt', name: v, color: 'default' } : null };
    else if (type === 'checkbox') props[name] = { id, type, checkbox: !!v };
    else if (type === 'number') props[name] = { id, type, number: v ?? null };
    else if (type === 'url') props[name] = { id, type, url: v || null };
    else if (type === 'date') props[name] = { id, type, date: v ? { start: v, end: null, time_zone: null } : null };
    else if (type === 'relation') props[name] = { id, type, relation: (v || []).map((x) => ({ id: x })), has_more: false };
    else if (type === 'files') props[name] = { id, type, files: (v || []).map((f) => ({ name: f, type: 'file', file: { url: `${BASE}/files/${encodeURIComponent(f)}?X-Amz-Signature=${Math.random().toString(16).slice(2)}`, expiry_time: new Date(Date.now() + 3600e3).toISOString() } })) };
    else if (type === 'last_edited_time') props[name] = { id, type, last_edited_time: p.edited };
  }
  return {
    object: 'page', id: p.id, created_time: p.edited, last_edited_time: p.edited, archived: p.archived, in_trash: false,
    parent: p.ds === SHOWCASE_DS ? { type: 'data_source_id', data_source_id: SHOWCASE_DS, database_id: SHOWCASE_DB } : { type: 'data_source_id', data_source_id: p.ds, database_id: 'x' },
    url: `https://www.notion.so/${p.id.replace(/-/g, '')}`, properties: props,
  };
}
function readWrite(name, v) {
  if (v.rich_text) return v.rich_text.map((t) => t.text.content).join('');
  if (v.title) return v.title.map((t) => t.text.content).join('');
  if ('select' in v) return v.select ? v.select.name : null;
  if ('number' in v) return v.number;
  if ('date' in v) return v.date ? v.date.start : null;
  if ('checkbox' in v) return v.checkbox;
  if ('url' in v) return v.url;
  throw new Error('unsupported write ' + name);
}

const control = { failPatch: 0, calls: [] };
const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const body = (req) => new Promise((r) => { const c = []; req.on('data', (x) => c.push(x)); req.on('end', () => r(c.length ? JSON.parse(Buffer.concat(c)) : {})); });

http.createServer(async (req, res) => {
  const u = new URL(req.url, BASE);
  const p = u.pathname;
  // 테스트 조작용
  if (p.startsWith('/__')) {
    if (p === '/__edit' && req.method === 'POST') {
      const b = await body(req);
      const pg = pages.get(b.id);
      Object.assign(pg.values, b.values || {});
      if (b.body) pg.body = b.body;
      if (b.archived !== undefined) pg.archived = b.archived;
      pg.edited = b.edited || minute();
      return send(res, 200, { ok: true, page: render(pg) });
    }
    if (p === '/__page') return send(res, 200, { values: pages.get(u.searchParams.get('id')).values, edited: pages.get(u.searchParams.get('id')).edited });
    if (p === '/__control' && req.method === 'POST') { Object.assign(control, await body(req)); return send(res, 200, control); }
    if (p === '/__calls') return send(res, 200, control.calls);
    if (p === '/__ids') return send(res, 200, { topIds, subIds, gachi: GACHI, workPage: WORK_PAGE, settingsDs: SETTINGS_DS, settingIds });
  }
  if (p.startsWith('/files/')) {
    const f = path.join(FILES, path.basename(decodeURIComponent(p.slice(7))));
    if (!fs.existsSync(f)) { res.writeHead(403, { 'Content-Type': 'application/xml' }); return res.end('<Error><Code>AccessDenied</Code></Error>'); }
    res.writeHead(200, { 'Content-Type': 'binary/octet-stream' });
    return res.end(fs.readFileSync(f));
  }
  control.calls.push(`${req.method} ${p}`);
  if (req.headers.authorization !== `Bearer ${TOKEN}`) return send(res, 401, { object: 'error', status: 401, code: 'unauthorized', message: 'API token is invalid.' });
  if (req.headers['notion-version'] !== '2025-09-03') return send(res, 400, { object: 'error', status: 400, code: 'missing_version', message: 'bad version' });
  let m;
  if ((m = /^\/v1\/data_sources\/([^/]+)\/query$/.exec(p)) && req.method === 'POST') {
    const ds = m[1];
    if (ds !== SHOWCASE_DS && ds !== CATEGORY_DS && ds !== SETTINGS_DS) return send(res, 404, { object: 'error', status: 404, code: 'object_not_found', message: 'Could not find data_source. Make sure the relevant pages and databases are shared with your integration.' });
    const b = await body(req);
    const all = [...pages.values()].filter((x) => x.ds === ds).map(render);
    const start = b.start_cursor ? Number(b.start_cursor) : 0;
    const size = Math.min(b.page_size || 100, 20); // 일부러 작게 나눠 페이지 넘김도 확인
    const slice = all.slice(start, start + size);
    return send(res, 200, { object: 'list', results: slice, has_more: start + size < all.length, next_cursor: start + size < all.length ? String(start + size) : null });
  }
  if ((m = /^\/v1\/pages\/([^/]+)$/.exec(p))) {
    const id = [...pages.keys()].find((k) => k.replace(/-/g, '') === m[1].replace(/-/g, ''));
    const pg = id && pages.get(id);
    if (!pg || pg.ds === WORKS_DS) return send(res, 404, { object: 'error', status: 404, code: 'object_not_found', message: 'Could not find page.' });
    if (req.method === 'GET') return send(res, 200, render(pg));
    if (req.method === 'PATCH') {
      if (control.failPatch > 0) { control.failPatch--; return send(res, 409, { object: 'error', status: 409, code: 'conflict_error', message: 'Conflict occurred while saving. Please try again.' }); }
      const b = await body(req);
      for (const [k, v] of Object.entries(b.properties || {})) {
        if (!SHOWCASE_SCHEMA[k]) return send(res, 400, { object: 'error', status: 400, code: 'validation_error', message: `${k} is not a property that exists.` });
        pg.values[k] = readWrite(k, v);
      }
      pg.edited = minute();
      return send(res, 200, render(pg));
    }
  }
  if ((m = /^\/v1\/blocks\/([^/]+)\/children$/.exec(p)) && req.method === 'GET') {
    const id = [...pages.keys()].find((k) => k.replace(/-/g, '') === m[1].replace(/-/g, ''));
    const pg = id && pages.get(id);
    if (!pg || pg.ds === WORKS_DS) return send(res, 404, { object: 'error', status: 404, code: 'object_not_found', message: 'Could not find block.' });
    const results = pg.body.map((t, i) => (typeof t === 'string'
      ? { object: 'block', id: `${id}-b${i}`, type: 'paragraph', has_children: false, paragraph: { rich_text: rt(t) } }
      : { object: 'block', id: `${id}-b${i}`, type: t.type, has_children: false, [t.type]: t.type === 'image' ? { type: 'external', external: { url: 'https://example.com/x.png' } } : { rich_text: rt(t.text) } }));
    return send(res, 200, { object: 'list', results, has_more: false, next_cursor: null });
  }
  send(res, 404, { object: 'error', status: 404, code: 'invalid_request_url', message: 'Invalid request URL.' });
}).listen(PORT, '127.0.0.1', () => console.log('mock notion on', PORT));
