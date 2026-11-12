// 가치타용 한 점으로 노션 발행 흐름 전체를 검증한다. 실제 데이터는 복사본만 쓴다.
// npm run test:notion  (또는 node tests/notion/flow.mjs <프로젝트 폴더>)
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const ROOT = path.resolve(process.argv[2] || '.');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const DATA = path.join(HERE, 'data');
const FILES = path.join(HERE, 'files');
const S = 'http://127.0.0.1:4181';
const N = 'http://127.0.0.1:4191';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 준비: 빈 테스트 데이터 폴더 (서버가 기본값으로 '노션 연동 전' 가치타용 공개본을 만든다) + 테스트 이미지
// 실제 data/ 폴더는 읽지도 쓰지도 않는다.
fs.rmSync(DATA, { recursive: true, force: true });
fs.mkdirSync(path.join(DATA, 'uploads'), { recursive: true });
fs.mkdirSync(FILES, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public/img/tabs/competitions.jpg'), path.join(FILES, 'cover-v1.jpg'));
fs.copyFileSync(path.join(ROOT, 'public/img/tabs/coding.jpg'), path.join(FILES, 'cover-v2.jpg'));
fs.copyFileSync(path.join(ROOT, 'public/img/plank.png'), path.join(FILES, 'screen-1.png'));
fs.writeFileSync(path.join(FILES, 'notes.txt'), 'not an image');

const procs = [];
function start(cmd, args, env) {
  const p = spawn(cmd, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', (d) => fs.appendFileSync(path.join(HERE, 'server.log'), d));
  p.stderr.on('data', (d) => fs.appendFileSync(path.join(HERE, 'server.log'), d));
  procs.push(p);
  return p;
}
const cleanup = () => procs.forEach((p) => p.kill());
process.on('exit', cleanup);
fs.writeFileSync(path.join(HERE, 'server.log'), '');
start('node', [path.join(HERE, 'mock-notion.mjs'), '4191', ROOT, FILES], {});
start('node', [path.join(ROOT, 'server.js')], {
  PORT: '4181', DATA_DIR: DATA, NOTION_TOKEN: 'test-token', NOTION_API_BASE: N, NOTION_SYNC_MINUTES: '0', NOTION_ALLOW_LOCAL_FILES: '1', NOTION_LOCAL_PUBLISH: '1',
});
for (let i = 0; i < 50; i++) { try { await fetch(S + '/api/site'); await fetch(N + '/__ids'); break; } catch { await sleep(150); } }

let cookie = '';
let pass = 0, fail = 0;
function check(name, ok, detail = '') {
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
}
async function admin(method, url, body) {
  const r = await fetch(S + url, { method, headers: { 'Content-Type': 'application/json', 'X-KK-Admin': '1', Cookie: cookie }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const sync = async (force = false) => (await admin('POST', '/api/admin/notion/sync', { force })).json.result;
const ids = await (await fetch(N + '/__ids')).json();
const G = ids.gachi;
const edit = async (values, extra = {}) => (await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: G, values, ...extra }) })).json();
const npage = async () => (await (await fetch(`${N}/__page?id=${G}`)).json()).values;
const site = async () => (await fetch(S + '/api/site')).json();
const cards = async () => ((await site()).items.competitions || []).length;
const share = async () => (await fetch(S + '/w/gachitayong')).status;
const apiItem = async () => fetch(S + '/api/items/gachitayong').then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const db = () => JSON.parse(fs.readFileSync(path.join(DATA, 'db.json'), 'utf8'));
const gItem = () => db().items.find((i) => i.slug === 'gachitayong');
const uploads = () => fs.readdirSync(path.join(DATA, 'uploads')).sort();
const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const fileStatus = async (id, withCookie) => (await fetch(`${S}/files/${id}`, { headers: withCookie ? { Cookie: cookie } : {} })).status;

// 관리자 (테스트 비밀번호, 이 테스트 폴더에만 저장)
const pw = crypto.randomBytes(9).toString('base64url');
const r0 = await fetch(S + '/api/admin/setup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) });
cookie = (r0.headers.get('set-cookie') || '').split(';')[0];
fs.writeFileSync(path.join(HERE, 'test-admin.txt'), pw + '\n', { mode: 0o600 });

const legacyId = gItem().id;
console.log('\n[0] 시작: 사이트에는 기존 공개본, 노션에는 초안');
check('기존 공개본이 보인다', (await share()) === 200 && (await cards()) === 1);

console.log('\n[1] 초안: 동기화해도 아무것도 바뀌지 않는다');
await edit({ '표지': ['cover-v1.jpg'], '갤러리': ['screen-1.png'] });
let res = await sync();
check('초안은 발행하지 않는다', res.published.length === 0 && res.failed.length === 0, JSON.stringify(res));
check('카드 1개 그대로', (await cards()) === 1);
check('노션 상태도 초안 그대로', (await npage())['발행 상태'] === '초안');
check('분류 이름이 노션과 같다', (await site()).categories.competitions.name === 'Competitions');

console.log('\n[2] 비공개 미리보기');
let pv = await fetch(`${S}/api/admin/notion/preview/${G}`);
check('로그인 없이 미리보기 데이터는 401', pv.status === 401);
pv = await fetch(`${S}/preview/${G}`);
check('미리보기 화면 틀은 캐시·색인 금지', pv.headers.get('cache-control') === 'no-store' && /noindex/.test(pv.headers.get('x-robots-tag') || ''));
pv = await admin('GET', `/api/admin/notion/preview/${G}`);
check('관리자는 노션 초안을 본다', pv.status === 200 && pv.json.item.title === 'Gachitayong' && pv.json.status === '초안' && pv.json.item.cover && pv.json.item.cover.url.startsWith(N), pv.json && pv.json.item && pv.json.item.cover && pv.json.item.cover.url);
check('미리보기는 기존 공개본을 이어받는다고 알려준다', pv.json.current && pv.json.current.adopt === true);
check('미리보기 본문은 노션 본문', pv.json.item.body.startsWith('Built as a team entry') && pv.json.item.body.includes('\n\nAs team lead'));
check('미리보기는 파일을 사이트에 복사하지 않는다', uploads().length === 0);
const wp = await admin('GET', `/api/admin/notion/preview/${ids.workPage.replace(/-/g, '')}`);
check('작업물 페이지는 미리보기로 열 수 없다', wp.status === 404 || wp.status === 502, `status ${wp.status}`);

console.log('\n[3] 발행 요청 → 발행');
await edit({ '발행 상태': '발행 요청' });
res = await sync();
let it = gItem();
let np = await npage();
check('v1 발행됨', res.published.length === 1 && it.publishedVersion === 1, JSON.stringify(res.published));
check('기존 작품을 이어받아 ID와 주소가 그대로', it.id === legacyId && it.slug === 'gachitayong' && it.notionPageId === G.replace(/-/g, ''));
check('카드 1개 (중복 없음)', (await cards()) === 1);
check('노션에 발행 기록', np['발행 상태'] === '발행됨' && np['사이트 ID'] === legacyId && np['발행 버전'] === 1 && !!np['최초 발행일'] && /v1 발행 완료/.test(np['발행 메모']), JSON.stringify({ s: np['발행 상태'], v: np['발행 버전'], m: np['발행 메모'] }));
const cover1 = it.coverFileId;
const cover1Body = Buffer.from(await (await fetch(`${S}/files/${cover1}`)).arrayBuffer());
check('표지를 사이트 저장소로 복사해 공개', (await fileStatus(cover1)) === 200 && md5(cover1Body) === md5(fs.readFileSync(path.join(FILES, 'cover-v1.jpg'))));
check('공개 표지 주소가 사이트 주소', (await apiItem()).json.item.cover.url === `/files/${cover1}`);
check('갤러리 1장 복사', it.galleryFileIds.length === 1 && (await fileStatus(it.galleryFileIds[0])) === 200);
const firstPub = it.firstPublishedAt;
const files1 = uploads();

console.log('\n[3b] 같은 요청을 다시 실행');
res = await sync();
check('다시 실행해도 아무 일 없음', res.published.length === 0 && gItem().publishedVersion === 1);
check('카드 여전히 1개, 파일 그대로', (await cards()) === 1 && JSON.stringify(uploads()) === JSON.stringify(files1));

console.log('\n[4] 노션에서 수정 중: 기존 공개본 유지');
await edit({ '발행 상태': '수정 중', '공개 제목': 'Gachitayong 2.0', '한 줄 요약': 'Edited summary (not yet public).', '표지': ['cover-v2.jpg'] }, { body: ['New body paragraph.', 'Second new paragraph.'] });
res = await sync();
let pub = (await apiItem()).json.item;
check('공개 제목·요약·본문 그대로', pub.title === 'Gachitayong' && pub.summary.startsWith('A web app') && pub.body.startsWith('Built as'));
check('공개 표지 그대로', pub.cover.url === `/files/${cover1}` && (await fileStatus(cover1)) === 200);
pv = await admin('GET', `/api/admin/notion/preview/${G}`);
check('미리보기는 수정본, 현재 공개본 v1이라고 알려준다', pv.json.item.title === 'Gachitayong 2.0' && pv.json.current.version === 1 && pv.json.current.isPublic === true);

console.log('\n[5] 재발행 실패: 기존 공개본을 덮어쓰지 않는다');
await edit({ '발행 상태': '재발행 요청', '갤러리': ['screen-1.png', 'missing.png'] });
res = await sync();
pub = (await apiItem()).json.item;
np = await npage();
check('실패로 기록', res.failed.length === 1 && /missing\.png/.test(res.failed[0].errors.join(' ')), JSON.stringify(res.failed));
check('공개본 그대로 (제목, 표지, 버전)', pub.title === 'Gachitayong' && pub.cover.url === `/files/${cover1}` && gItem().publishedVersion === 1);
check('받다 만 파일이 남지 않는다', JSON.stringify(uploads()) === JSON.stringify(files1));
check('노션 메모에 원인, 상태는 그대로', /발행하지 못했어요/.test(np['발행 메모']) && /missing\.png/.test(np['발행 메모']) && np['발행 상태'] === '재발행 요청', np['발행 메모']);
const st5 = await admin('GET', '/api/admin/notion?rows=1');
check('관리자 화면 기록과 표에 원인이 보인다', st5.json.log.some((l) => l.level === 'error' && /missing\.png/.test(l.msg)) && st5.json.rows[0].failure && /missing/.test(st5.json.rows[0].failure.errors[0]));
res = await sync();
check('고치기 전에는 같은 실패를 반복하지 않는다', res.failed.length === 0 && res.skipped.length === 1);

await edit({ '갤러리': ['screen-1.png', 'notes.txt'] });
res = await sync();
check('이미지가 아닌 파일도 막는다', res.failed.length === 1 && /notes\.txt/.test(res.failed[0].errors[0]) && gItem().publishedVersion === 1);

console.log('\n[6] 고친 뒤 재발행: 글과 이미지를 한 번에 교체');
await edit({ '갤러리': ['screen-1.png'] });
res = await sync();
it = gItem();
pub = (await apiItem()).json.item;
np = await npage();
check('v2 발행', res.published.length === 1 && it.publishedVersion === 2);
check('제목·요약·본문 교체', pub.title === 'Gachitayong 2.0' && pub.summary === 'Edited summary (not yet public).' && pub.body === 'New body paragraph.\n\nSecond new paragraph.');
check('새 표지로 교체, 예전 표지는 지워짐', pub.cover.url !== `/files/${cover1}` && (await fileStatus(cover1, true)) === 404 && !uploads().includes(cover1));
const cover2Body = Buffer.from(await (await fetch(S + pub.cover.url)).arrayBuffer());
check('새 표지 내용 확인', md5(cover2Body) === md5(fs.readFileSync(path.join(FILES, 'cover-v2.jpg'))));
check('같은 주소, 같은 ID, 최초 발행일 유지', it.slug === 'gachitayong' && it.id === legacyId && it.firstPublishedAt === firstPub && np['최초 발행일'] === firstPub);
check('카드 1개', (await cards()) === 1);
check('노션 기록 v2', np['발행 버전'] === 2 && np['발행 상태'] === '발행됨');

console.log('\n[6b] 노션 기록이 실패해도 다시 실행하면 카드·버전이 늘지 않는다');
await edit({ '발행 상태': '재발행 요청', '결과': 'Finalist' });
await fetch(N + '/__control', { method: 'POST', body: JSON.stringify({ failPatch: 1 }) });
res = await sync();
it = gItem();
check('사이트는 v3 공개, 노션 기록 대기', it.publishedVersion === 3 && it.pendingWriteback === true && (await apiItem()).json.item.result === 'Finalist');
const files3 = uploads();
res = await sync();
it = gItem();
np = await npage();
check('다시 실행하면 기록만 남기고 다시 받지 않는다', res.published[0] && res.published[0].writebackOnly === true && it.publishedVersion === 3 && !it.pendingWriteback && JSON.stringify(uploads()) === JSON.stringify(files3));
check('노션 v3, 카드 1개', np['발행 버전'] === 3 && np['발행 상태'] === '발행됨' && (await cards()) === 1);

console.log('\n[6c] 발행 뒤 주소 변경은 막는다');
await edit({ '발행 상태': '재발행 요청', '작품 주소': 'gachitayong-new' });
res = await sync();
check('주소 변경 거절, 공개본 유지', res.failed.length === 1 && /작품 주소/.test(res.failed[0].errors[0]) && (await share()) === 200 && gItem().publishedVersion === 3);
await edit({ '작품 주소': 'gachitayong', '발행 상태': '발행됨' });

console.log('\n[7] 내림 요청 → 비공개 전환');
const coverNow = gItem().coverFileId;
await edit({ '발행 상태': '내림 요청' });
res = await sync();
np = await npage();
check('비공개 전환', res.unpublished.length === 1 && gItem().isPublic === false);
check('공유 주소 404', (await share()) === 404);
check('작품 API 404', (await apiItem()).status === 404);
check('표지 파일 직접 주소 404', (await fileStatus(coverNow)) === 404);
check('목록에서 사라짐', (await cards()) === 0);
check('노션 상태 내려감', np['발행 상태'] === '내려감');
check('최초 발행일·주소는 사이트에 남아 있다', gItem().firstPublishedAt === firstPub && gItem().slug === 'gachitayong');

console.log('\n[8] 분류 관리 동기화');
await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: ids.topIds.clubs, values: { '사용': false } }) });
await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: ids.topIds.coding, values: { '영어 이름': 'Builds', '순서': 0.5 } }) });
await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: ids.subIds.startup, values: { '사용': false } }) });
res = await sync();
let s8 = await site();
check('사용 해제한 분류는 숨김', !s8.categories.clubs);
check('이름과 순서는 노션 기준', s8.categories.coding.name === 'Builds' && Object.keys(s8.categories)[0] === 'coding');
check('사용 해제한 하위 분류는 숨김', !s8.categories.competitions.subs.some((x) => x.id === 'startup'));
await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: ids.topIds.clubs, values: { '사용': true } }) });
await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: ids.topIds.coding, values: { '영어 이름': 'Coding', '순서': 2 } }) });
await fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: ids.subIds.startup, values: { '사용': true } }) });
await sync();

console.log('\n[9] 보안');
const anyLeak = [JSON.stringify(await site()), JSON.stringify((await admin('GET', '/api/admin/notion?rows=1')).json), JSON.stringify((await admin('GET', '/api/admin/data')).json)].some((t) => t.includes('test-token'));
check('토큰이 어떤 응답에도 없다', !anyLeak);
const put = await admin('PUT', `/api/admin/items/${legacyId}`, { title: 'hacked', isPublic: true, privateNotes: 'memo ok' });
check('노션 작품의 공개 내용은 관리자 화면에서 못 바꾼다', put.json.item.title === 'Gachitayong 2.0' && put.json.item.isPublic === false && put.json.item.privateNotes === 'memo ok');
const calls = await (await fetch(N + '/__calls')).json();
check('작업물 DB는 조회하지 않는다', !calls.some((c) => c.includes('b66d878e')), calls.filter((c) => c.includes('query')).slice(0, 3).join(', '));

console.log(`\n${pass} PASS, ${fail} FAIL`);
cleanup();
process.exit(fail ? 1 : 0);
