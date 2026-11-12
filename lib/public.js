// 방문자에게 보여줄 데이터만 골라 만든다. 서버(server.js)와 정적 사이트 빌드(scripts/build-static.js)가 함께 쓴다.
// 비공개 메모, 진행 기록, 첨부, 비공개 작품은 여기서 절대 내보내지 않는다.
const store = require('./store');

const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a', 'audio/aac': '.aac', 'audio/ogg': '.ogg', 'audio/wav': '.wav', 'audio/x-wav': '.wav', 'audio/webm': '.webm' };

// 파일 주소 모양. 서버는 /files/<id>, 정적 사이트는 /files/<id>.<확장자>
let fileUrlOf = (f) => `/files/${f.id}`;
function configure({ fileUrl } = {}) {
  if (fileUrl) fileUrlOf = fileUrl;
}
const extOf = (f) => EXT[f.mime] || '';

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
const itemById = (id) => store.get().items.find((i) => i.id === id);
const fileById = (id) => store.get().files.find((f) => f.id === id);
const fileUrl = (id) => { const f = id && fileById(id); return f ? fileUrlOf(f) : null; };

// 방문자에게 보이는 작품: 공개 상태이고, 분류가 사이트에 표시되는 것.
function itemVisible(item) {
  return !!(item && item.isPublic && store.categoryShown(item.category));
}
// 방문자가 열 수 있는 파일: 보이는 작품의 표지·썸네일·갤러리·음원만. 첨부자료는 절대 공개하지 않는다.
function fileIsPublic(f) {
  if (!f) return false;
  const item = itemById(f.itemId);
  if (!itemVisible(item)) return false;
  if (f.kind === 'cover') return item.coverFileId === f.id;
  if (f.kind === 'thumb') return item.thumbFileId === f.id;
  if (f.kind === 'audio') return item.audioFileId === f.id;
  if (f.kind === 'gallery') return item.galleryFileIds.includes(f.id);
  return false;
}
function publicItem(item) {
  return {
    id: item.id,
    slug: item.slug,
    category: item.category,
    sub: item.sub || '',
    title: item.title,
    summary: item.summary,
    context: item.context || '',
    role: item.role,
    result: item.result,
    body: item.body,
    cover: item.coverFileId && fileUrl(item.coverFileId) ? { url: fileUrl(item.coverFileId), alt: item.title } : null,
    thumb: fileUrl(item.thumbFileId) || fileUrl(item.coverFileId),
    audio: fileUrl(item.audioFileId),
    gallery: item.galleryFileIds.filter((id) => fileById(id)).map((id) => ({ url: fileUrl(id), name: fileById(id).name || '' })),
    links: item.links.map((l) => ({ label: l.label, url: safeUrl(l.url) })).filter((l) => l.url),
    isFeatured: !!item.isFeatured,
    updatedAt: item.updatedAt,
  };
}
const publishedAt = (i) => i.firstPublishedAt || i.createdAt || '';
function sortedPublic(category) {
  return store
    .get()
    .items.filter((i) => itemVisible(i) && (!category || i.category === category))
    // 대표작 먼저, 나머지는 최초 발행일 최신순
    .sort((a, b) => (b.isFeatured - a.isFeatured) || publishedAt(b).localeCompare(publishedAt(a)) || (a.sort - b.sort));
}
// 대표곡: 설정한 곡이 공개이고 음원이 있으면 그 곡, 아니면 음원이 있는 첫 공개 자작곡.
function featuredTrack() {
  const s = store.get().settings;
  const key = store.categoryKeys().find((k) => store.kindOf(k) === 'compositions');
  const playable = key ? sortedPublic(key).filter((i) => i.audioFileId && fileById(i.audioFileId)) : [];
  const pick = playable.find((i) => i.id === s.featuredTrackId) || playable[0];
  return pick ? { id: pick.id, slug: pick.slug, title: pick.title, src: fileUrl(pick.audioFileId) } : null;
}
function siteSettings() {
  const s = store.get().settings;
  return {
    naverUrl: safeUrl(s.naverUrl),
    instagramUrl: safeUrl(s.instagramUrl),
    siteName: s.siteName || 'Plot Twist',
    email: s.email || '',
    aboutText: s.aboutText || '',
    aboutHistory: String(s.aboutHistory || '').split('\n').map((l) => l.trim()).filter(Boolean),
    featuredTrack: featuredTrack(),
  };
}
function publicCategories() {
  const d = store.get();
  const out = {};
  for (const k of store.categoryKeys()) {
    if (!store.categoryShown(k)) continue;
    const c = d.categories[k];
    out[k] = { name: c.name, button: c.button, thing: c.thing, kind: store.kindOf(k), subs: c.subs.filter((s) => s.enabled !== false).map((s) => ({ id: s.id, name: s.name })) };
  }
  return out;
}
// /api/site 응답과 같은 모양
function siteData() {
  const items = {};
  store.categoryKeys().filter(store.categoryShown).forEach((c) => (items[c] = sortedPublic(c).map(publicItem)));
  return { settings: siteSettings(), categories: publicCategories(), items };
}
// /api/items/<slug> 응답과 같은 모양. 보이지 않는 작품이면 null
function itemData(slug) {
  const item = store.get().items.find((i) => i.slug === slug && itemVisible(i));
  if (!item) return null;
  return { item: publicItem(item), categoryName: store.get().categories[item.category].name, categoryKind: store.kindOf(item.category) };
}

module.exports = { configure, extOf, safeUrl, itemById, fileById, itemVisible, fileIsPublic, publicItem, sortedPublic, featuredTrack, siteSettings, publicCategories, siteData, itemData };
