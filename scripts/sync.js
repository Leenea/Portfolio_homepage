// 노션 → content/ 동기화 (GitHub Actions에서 실행). AI를 부르지 않는다.
//   node scripts/sync.js           노션의 발행·재발행·내림 요청을 content/에 반영 (노션 기록은 미룸)
//   node scripts/sync.js --flush   저장소에 올린 뒤, 미뤄 둔 노션 기록(발행됨·내려감)을 적음
//   node scripts/sync.js --force   실패했던 요청도 다시 시도
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// 로컬에서 실행할 때는 .env의 토큰을 쓴다 (GitHub에서는 Secrets로 받는다)
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
} catch {}
process.env.DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'content');

const store = require('../lib/store');
const notion = require('../lib/notion');
const sync = require('../lib/notion-sync');

(async () => {
  store.load();
  if (!notion.configured()) {
    console.error('NOTION_TOKEN이 없어요. GitHub 저장소 Settings → Secrets and variables → Actions에 NOTION_TOKEN을 넣어 주세요.');
    process.exit(1);
  }
  if (process.argv.includes('--flush')) {
    const r = await sync.flushWritebacks();
    console.log(`노션 기록: ${r.written.length}건${r.failed.length ? `, 실패 ${r.failed.length}건 (다음 실행 때 다시 적어요)` : ''}`);
    r.failed.forEach((f) => console.log(`- ${f.title}: ${f.error}`));
    return;
  }
  const r = await sync.run({ deferWriteback: true, stamp: false, force: process.argv.includes('--force') });
  const line = (label, list, fmt) => list.length && console.log(`${label}: ${list.map(fmt).join(', ')}`);
  console.log(`분류 변경: ${r.categoriesChanged ? '있음' : '없음'} · 사이트 설정 변경: ${r.settingsChanged ? '있음' : '없음'}`);
  line('발행', r.published, (p) => `${p.title} v${p.version} (/w/${p.slug})`);
  line('비공개 전환', r.unpublished, (p) => p.title);
  line('실패 (기존 공개본 유지, 노션 발행 메모 확인)', r.failed, (p) => `${p.title}: ${p.errors.join(' / ')}`);
  line('건너뜀', r.skipped, (p) => `${p.title} (${p.reason})`);
  if (r.errors.length) {
    r.errors.forEach((e) => console.error('오류:', e));
    process.exit(1);
  }
})().catch((e) => {
  console.error('동기화 오류:', e.message);
  process.exit(1);
});
