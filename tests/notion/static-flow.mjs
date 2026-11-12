// 정적 사이트(GitHub Actions + Cloudflare Pages) 발행 흐름 점검. 가짜 노션과 빈 테스트 폴더만 쓴다.
//   npm run test:static
// GitHub Actions가 하는 일을 그대로 흉내 낸다: sync.js → (저장소에 올리기) → build → sync.js --flush
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(process.argv[2] || '.');
const HERE = path.dirname(new URL(import.meta.url).pathname);
const CONTENT = path.join(HERE, 'data', 'static-content');
const SAVED = path.join(HERE, 'data', 'static-content-pushed');
const DIST = path.join(HERE, 'data', 'static-dist');
const FILES = path.join(HERE, 'files');
const N = 'http://127.0.0.1:4192';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

fs.rmSync(path.join(HERE, 'data'), { recursive: true, force: true });
fs.mkdirSync(path.join(CONTENT, 'uploads'), { recursive: true });
fs.mkdirSync(FILES, { recursive: true });
fs.copyFileSync(path.join(ROOT, 'public/img/tabs/competitions.jpg'), path.join(FILES, 'cover-v1.jpg'));
fs.copyFileSync(path.join(ROOT, 'public/img/tabs/coding.jpg'), path.join(FILES, 'cover-v2.jpg'));

const mock = spawn('node', [path.join(HERE, 'mock-notion.mjs'), '4192', ROOT, FILES], { stdio: 'ignore' });
process.on('exit', () => mock.kill());
for (let i = 0; i < 50; i++) { try { await fetch(N + '/__ids'); break; } catch { await sleep(100); } }
const ids = await (await fetch(N + '/__ids')).json();
const G = ids.gachi;

const env = { ...process.env, DATA_DIR: CONTENT, OUT_DIR: DIST, NOTION_TOKEN: 'test-token', NOTION_API_BASE: N, NOTION_ALLOW_LOCAL_FILES: '1', NOTION_SETTINGS_DS: ids.settingsDs };
const run = (script, ...args) => { try { return execFileSync('node', [path.join(ROOT, script), ...args], { env, encoding: 'utf8' }); } catch (e) { return 'EXIT ' + e.status + '\n' + e.stdout + e.stderr; } };
const sync = () => run('scripts/sync.js');
const flush = () => run('scripts/sync.js', '--flush');
const build = () => run('scripts/build-static.js');
const push = () => { fs.rmSync(SAVED, { recursive: true, force: true }); fs.cpSync(CONTENT, SAVED, { recursive: true }); }; // 저장소에 올린 상태
const pushFailed = () => { fs.rmSync(CONTENT, { recursive: true, force: true }); fs.cpSync(SAVED, CONTENT, { recursive: true }); }; // 올리기 실패 → 다음 실행은 올라간 상태에서 시작
const edit = (values) => fetch(N + '/__edit', { method: 'POST', body: JSON.stringify({ id: G, values }) });
const npage = async () => (await (await fetch(`${N}/__page?id=${G}`)).json()).values;
const dist = (rel) => { try { return fs.readFileSync(path.join(DIST, rel), 'utf8'); } catch { return null; } };
const site = () => JSON.parse(dist('api/site.json'));

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => { ok ? pass++ : fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? '  — ' + detail : ''}`); };

console.log('[0] 처음: 기본 데이터로 빌드');
run('scripts/build-static.js'); // 빈 폴더면 기본값(노션 연동 전 가치타용 공개본)이 만들어진다
push();
check('기존 공개본이 정적 사이트에 있다', !!dist('w/gachitayong.html') && site().items.competitions.length === 1);

console.log('[1] 사이트 설정 DB');
let out = sync();
build();
check('이메일·네이버·소개·이력이 노션 값으로', site().settings.email === 'hello@example.com' && site().settings.naverUrl === 'https://blog.naver.com/example' && site().settings.aboutHistory.length === 2, JSON.stringify(site().settings));
check('잘못된 인스타 주소는 넣지 않는다', site().settings.instagramUrl === '');
push();

console.log('[2] 발행 요청 → 반영 → 빌드 → 노션 기록');
await edit({ '발행 상태': '발행 요청', '표지': ['cover-v1.jpg'], '공개 제목': 'Gachitayong' });
out = sync();
check('sync가 발행을 반영', /발행: Gachitayong v1/.test(out), out);
check('노션 기록은 아직 하지 않는다 (요청 그대로)', (await npage())['발행 상태'] === '발행 요청');
build();
const item = JSON.parse(dist('api/items/gachitayong.json')).item;
check('정적 사이트에 표지 파일이 확장자와 함께', !!item.cover && /^\/files\/[a-f0-9]+\.jpg$/.test(item.cover.url) && fs.existsSync(path.join(DIST, item.cover.url)));
check('공유 주소 페이지에 제목과 미리보기 이미지', /<title>Gachitayong · Plot Twist<\/title>/.test(dist('w/gachitayong.html')) && dist('w/gachitayong.html').includes(item.cover.url));
check('정적 사이트 표시가 들어감', dist('index.html').includes('window.PT_STATIC = true'));
check('관리자 화면은 정적 사이트에 없다', !fs.existsSync(path.join(DIST, 'admin')));

console.log('[2b] 저장소 올리기 실패 → 다음 실행이 다시 처리');
pushFailed();
out = sync();
check('올리기 실패 뒤 다시 발행', /발행: Gachitayong v1/.test(out), out);
push();
out = flush();
const np = await npage();
check('올린 뒤에 노션 기록', np['발행 상태'] === '발행됨' && np['발행 버전'] === 1 && /v1 발행 완료/.test(np['발행 메모']), JSON.stringify(np['발행 메모']));
out = sync();
check('같은 요청을 다시 실행해도 그대로', !/발행:/.test(out));
build();
check('카드 1개', site().items.competitions.length === 1);

console.log('[3] 수정 중에는 공개본 유지 → 재발행');
await edit({ '발행 상태': '수정 중', '공개 제목': 'Gachitayong 2.0', '표지': ['cover-v2.jpg'] });
sync(); build();
check('수정 중: 정적 사이트 제목 그대로', JSON.parse(dist('api/items/gachitayong.json')).item.title === 'Gachitayong');
await edit({ '발행 상태': '재발행 요청' });
out = sync(); build(); push(); flush();
const it2 = JSON.parse(dist('api/items/gachitayong.json')).item;
check('재발행: 제목·표지 교체', it2.title === 'Gachitayong 2.0' && it2.cover.url !== item.cover.url && !fs.existsSync(path.join(DIST, item.cover.url)), out);
check('노션 v2', (await npage())['발행 버전'] === 2);

console.log('[4] 내림 요청');
await edit({ '발행 상태': '내림 요청' });
out = sync();
check('노션 기록은 올린 뒤에', (await npage())['발행 상태'] === '내림 요청');
build();
check('정적 사이트에서 사라짐 (페이지·데이터·파일)', !dist('w/gachitayong.html') && !dist('api/items/gachitayong.json') && !fs.existsSync(path.join(DIST, it2.cover.url)) && !(site().items.competitions || []).length);
push(); flush();
check('노션 내려감', (await npage())['발행 상태'] === '내려감');

console.log('[5] 토큰이 빌드 결과에 없다');
let all = '';
try { all = execFileSync('grep', ['-rl', 'test-token', DIST], { encoding: 'utf8' }).trim(); } catch { all = ''; } // 못 찾으면 grep이 1로 끝난다
check('dist에 토큰 문자열 없음', !all);

console.log(`\n${pass} PASS, ${fail} FAIL`);
mock.kill();
process.exit(fail ? 1 : 0);
