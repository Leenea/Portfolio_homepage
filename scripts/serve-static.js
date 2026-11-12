// dist/를 Cloudflare Pages처럼 띄워 확인하는 작은 서버 (확인용).
//   npm run build && node scripts/serve-static.js [포트]
// - /room → room.html, /w/x → w/x.html 처럼 .html 없이 연다
// - 없는 주소는 404.html을 404로 준다
// - _headers의 헤더를 붙인다
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.resolve(process.env.OUT_DIR || path.join(__dirname, '..', 'dist'));
const PORT = Number(process.argv[2] || process.env.PORT || 4300);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

// _headers: "/경로*" 다음 줄들의 "  이름: 값"
const rules = [];
try {
  let cur = null;
  for (const line of fs.readFileSync(path.join(DIST, '_headers'), 'utf8').split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { pattern: line.trim(), headers: {} }; rules.push(cur); continue; }
    const i = line.indexOf(':');
    if (cur && i > 0) cur.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
} catch {}
const headersFor = (p) => Object.assign({}, ...rules.filter((r) => (r.pattern.endsWith('*') ? p.startsWith(r.pattern.slice(0, -1)) : p === r.pattern)).map((r) => r.headers));

function resolve(p) {
  const clean = path.normalize(decodeURIComponent(p)).replace(/^(\.\.[/\\])+/, '');
  const base = path.join(DIST, clean);
  if (!base.startsWith(DIST)) return null;
  for (const f of [base, base + '.html', path.join(base, 'index.html')]) {
    try { if (fs.statSync(f).isFile()) return f; } catch {}
  }
  return null;
}
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (p !== '/' && p.endsWith('/') && resolve(p.slice(0, -1))) { res.writeHead(301, { Location: p.slice(0, -1) }); return res.end(); }
  const f = resolve(p === '/' ? '/index.html' : p);
  const file = f || path.join(DIST, '404.html');
  res.writeHead(f ? 200 : 404, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', ...headersFor(p) });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, '127.0.0.1', () => console.log(`정적 사이트 확인: http://localhost:${PORT}`));
