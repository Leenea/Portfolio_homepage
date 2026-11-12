// 정적 사이트 만들기: content/(발행된 공개본)를 읽어 dist/에 Cloudflare Pages용 파일을 만든다.
// 노션에 접속하지 않고, 공개된 작품과 공개 파일만 내보낸다.
//   node scripts/build-static.js            (content/ → dist/)
//   DATA_DIR=다른폴더 node scripts/build-static.js
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
process.env.DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'content');
const OUT = path.resolve(process.env.OUT_DIR || path.join(ROOT, 'dist'));
const store = require('../lib/store');
const pub = require('../lib/public');

store.load();
pub.configure({ fileUrl: (f) => `/files/${f.id}${pub.extOf(f)}` });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

// 1. 화면 파일 (관리자 화면은 정적 사이트에 넣지 않는다)
const SKIP = new Set(['index.html', 'admin', '.DS_Store']);
function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    if (SKIP.has(name)) continue;
    const s = path.join(src, name);
    const d = path.join(dst, name);
    if (fs.statSync(s).isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}
copyDir(path.join(ROOT, 'public'), OUT);

// 2. 데이터 (/api/site.json, /api/items/<slug>.json)
const write = (rel, data) => {
  const f = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, typeof data === 'string' ? data : JSON.stringify(data));
};
const site = pub.siteData();
write('api/site.json', site);
const visible = store.get().items.filter(pub.itemVisible);
for (const it of visible) write(`api/items/${it.slug}.json`, pub.itemData(it.slug));

// 3. 공개 파일만 복사 (첨부·비공개 작품 파일은 빠진다)
let fileCount = 0;
for (const f of store.get().files) {
  if (!pub.fileIsPublic(f)) continue;
  const src = path.join(store.UPLOAD_DIR, f.id);
  if (!fs.existsSync(src)) { console.warn(`파일이 없어 건너뜀: ${f.id} (${f.name})`); continue; }
  const dst = path.join(OUT, 'files', f.id + pub.extOf(f));
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  fileCount++;
}

// 4. HTML: /, /room, /w/<slug>, 404
const template = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const name = site.settings.siteName || 'Plot Twist';
function page(meta = {}) {
  const title = meta.title ? `${meta.title} · ${name}` : name;
  const desc = meta.description || `Step into ${name}'s treehouse. Open the door and look around the room.`;
  return template
    .replace('<title>__SITE_TITLE__</title>', `<title>${esc(title)}</title>`)
    .replaceAll('__META_DESCRIPTION__', esc(desc))
    .replace('__OG_TITLE__', esc(title))
    .replace('__OG_IMAGE__', meta.image ? `<meta property="og:image" content="${esc(meta.image)}">` : '')
    // 정적 사이트 표시: app.js가 .json 데이터 주소를 쓰게 한다
    .replace('<script src="/app.js"></script>', '<script>window.PT_STATIC = true;</script>\n  <script src="/app.js"></script>');
}
write('index.html', page());
write('room.html', page());
write('404.html', page({ title: 'Not found' }));
for (const it of visible) {
  const d = pub.itemData(it.slug);
  write(`w/${it.slug}.html`, page({ title: it.title, description: it.summary, image: d.item.cover ? d.item.cover.url : '' }));
}

// 5. Cloudflare Pages 설정
write('_headers', [
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  Referrer-Policy: same-origin',
  '  X-Frame-Options: SAMEORIGIN',
  '/api/*',
  '  Cache-Control: no-cache',
  '/files/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '/img/*',
  '  Cache-Control: public, max-age=3600',
  '',
].join('\n'));
// 예전 서버 주소 모양도 받아 준다
write('_redirects', ['/index.html / 301', '/w/:slug/ /w/:slug 301', ''].join('\n'));

console.log(`정적 사이트를 만들었어요: ${path.relative(ROOT, OUT) || OUT}`);
console.log(`- 작품 ${visible.length}개, 공개 파일 ${fileCount}개, 분류 ${Object.keys(site.categories).length}개`);
