// 데이터 저장소: data/db.json 한 파일과 data/uploads 폴더를 쓴다.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
const DB_FILE = path.join(DATA_DIR, 'db.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const ADMIN_FILE = path.join(DATA_DIR, 'admin.json');

// 카테고리 키와 순서는 방 안의 물건에 묶여 있어 고정이다. 이름·버튼·하위 분류는 관리자에서 바꾼다.
const CATEGORY_KEYS = ['competitions', 'coding', 'work', 'ideas', 'study', 'clubs', 'hobbies', 'love', 'compositions'];
const CATEGORIES_KO = {
  competitions: '공모전',
  coding: '코딩',
  work: '일한 기록',
  ideas: '아이디어',
  study: '공부·자격증',
  clubs: '동아리',
  hobbies: '취미',
  love: '사랑',
  compositions: '작곡',
};
// 방 물건 → 그 물건이 원래 맡던 분류 모양(화면 배경, 칸 배치). 새 분류도 물건에 연결되면 이 모양을 빌려 쓴다.
const THING_KIND = { board: 'competitions', crt: 'coding', shirt: 'work', chest: 'ideas', bookshelf: 'study', cork: 'clubs', bed: 'hobbies', diary: 'love', turntable: 'compositions' };
const KIND_THING = Object.fromEntries(Object.entries(THING_KIND).map(([t, k]) => [k, t]));
const sub = (id, name, ko) => ({ id, name, ko });
const DEFAULT_CATEGORIES = {
  competitions: { name: 'Competitions', button: 'View competitions', subs: [sub('hackathons', 'Hackathons', '해커톤'), sub('startup', 'Startup Competitions', '창업 경진대회'), sub('planning-design', 'Planning & Design Contests', '기획·디자인 공모전')] },
  coding: { name: 'Coding', button: 'Explore builds', subs: [sub('apps', 'Apps', '앱'), sub('web-services', 'Web Services', '웹서비스'), sub('websites', 'Websites', '웹사이트'), sub('tools', 'Tools & Automation', '도구·자동화')] },
  work: { name: 'Work Log', button: 'View work history', subs: [sub('part-time', 'Part-time Jobs', '아르바이트'), sub('selling', 'Direct Sales', '직접 판매'), sub('freelance', 'Freelance & Collaboration', '외주·협업')] },
  ideas: { name: 'Ideas', button: 'Open the chest', subs: [sub('service', 'Service Ideas', '서비스 아이디어'), sub('product', 'Product Ideas', '제품 아이디어'), sub('content', 'Content Planning', '콘텐츠 기획')] },
  study: { name: 'Study & Certifications', button: 'Browse the shelf', subs: [sub('notes', 'Study Notes', '학습 기록'), sub('certs', 'Certifications', '자격증'), sub('research', 'Research & Talks', '조사·발표')] },
  clubs: { name: 'Clubs', button: 'View club activities', subs: [sub('projects', 'Projects', '프로젝트'), sub('events', 'Events', '행사'), sub('operations', 'Operations & Planning', '운영·기획')] },
  hobbies: { name: 'Hobbies', button: 'Explore hobbies', subs: [sub('games', 'Games', '게임'), sub('screen', 'Movies & Dramas', '영화·드라마'), sub('music', 'Music', '음악'), sub('drinks', 'Drinks', '술'), sub('crafts', 'Hobby Projects', '취미 작업')] },
  love: { name: 'Love', button: 'Open the journal', subs: [sub('stories', 'Love Stories', '연애 이야기'), sub('letters', 'Letters', '편지'), sub('looking-back', 'Looking Back', '돌아보기')] },
  compositions: { name: 'Compositions', button: 'Browse compositions', subs: [] },
};

const DEFAULT_SETTINGS = {
  siteName: 'Plot Twist', // 임시 이름. 관리자 화면에서 바꾸면 탭 제목·문패·소개 카드에 함께 반영된다.
  email: '',
  aboutText: '',
  aboutHistory: '', // 한 줄에 이력 하나
  naverUrl: '',
  instagramUrl: '',
  featuredTrackId: null, // 턴테이블 대표곡 (작곡 카테고리 항목 id)
};

const GACHITAYONG_EN = {
  title: 'Gachitayong',
  summary: 'A web app prototype that helps HUFS students find classmates heading the same way, so they can share carpools or taxi rides.',
  context: 'Team project · 2026 HUFS × NAVER Cloud Vibe Coding Competition',
  role: 'Team lead, Problem research, Service planning, Screen design, Backend & deployment lead',
  body:
    'Built as a team entry for the 2026 Hankuk University of Foreign Studies × NAVER Cloud Vibe Coding Competition.\n\nAs team lead, I covered problem research, service planning and screen design, and led the backend and deployment.',
  links: [{ label: 'Try the prototype', url: 'https://49-50-141-146.sslip.io' }],
};

function newId() {
  return crypto.randomBytes(12).toString('hex');
}
function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

function blankItem(extra = {}) {
  const now = new Date().toISOString();
  return {
    id: newId(), slug: 'item-' + crypto.randomBytes(3).toString('hex'), category: 'competitions', sub: '',
    title: '', summary: '', context: '', role: '', result: '', body: '',
    coverFileId: null, thumbFileId: null, audioFileId: null, galleryFileIds: [], links: [],
    isPublic: false, isFeatured: false, sort: 0, privateNotes: '', logs: [], attachmentFileIds: [],
    notionPageId: null, firstPublishedAt: null, lastPublishedAt: null, publishedVersion: 0,
    createdAt: now, updatedAt: now, ...extra,
  };
}

function seed() {
  return {
    settings: { ...DEFAULT_SETTINGS },
    categories: clone(DEFAULT_CATEGORIES),
    items: [blankItem({ slug: 'gachitayong', category: 'competitions', sub: 'hackathons', ...GACHITAYONG_EN, isPublic: true, isFeatured: true })],
    files: [],
  };
}

// 예전 버전 데이터를 지금 구조로 고친다. 사용자가 직접 쓴 내용은 건드리지 않는다.
const OLD_CATEGORY = { contest: 'competitions', business: 'work', idea: 'ideas', study: 'study', club: 'clubs', hobby: 'hobbies', love: 'love' };
function migrate(d) {
  let changed = false;
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    if (!(k in d.settings)) { d.settings[k] = v; changed = true; }
  }
  for (const k of ['introText', 'musicUrl', 'musicFileId']) {
    if (k in d.settings) { delete d.settings[k]; changed = true; }
  }
  if (!d.categories) { d.categories = clone(DEFAULT_CATEGORIES); changed = true; }
  for (const k of CATEGORY_KEYS) if (!d.categories[k]) { d.categories[k] = clone(DEFAULT_CATEGORIES[k]); changed = true; }
  // 분류마다 방 물건, 순서, 사용 여부, 한국어 이름을 둔다 (노션 '분류 관리'와 같은 모양).
  Object.entries(d.categories).forEach(([k, c], i) => {
    if (!('thing' in c)) { c.thing = KIND_THING[k] || null; changed = true; }
    if (!('order' in c)) { c.order = CATEGORY_KEYS.includes(k) ? CATEGORY_KEYS.indexOf(k) + 1 : 100 + i; changed = true; }
    if (!('enabled' in c)) { c.enabled = true; changed = true; }
    if (!('ko' in c)) { c.ko = CATEGORIES_KO[k] || ''; changed = true; }
    for (const s of c.subs) if (!('enabled' in s)) { s.enabled = true; changed = true; }
  });
  if (!d.notionSync) { d.notionSync = { lastRunAt: null, lastOkAt: null, log: [], failures: {} }; changed = true; }
  // 예전 배경음악 파일은 더 이상 쓰지 않는다.
  const oldMusic = d.files.filter((f) => f.kind === 'music');
  if (oldMusic.length) {
    d.files = d.files.filter((f) => f.kind !== 'music');
    oldMusic.forEach((f) => fs.rmSync(path.join(UPLOAD_DIR, f.id), { force: true }));
    changed = true;
  }
  for (const item of d.items) {
    if (OLD_CATEGORY[item.category] && item.category !== OLD_CATEGORY[item.category]) { item.category = OLD_CATEGORY[item.category]; changed = true; }
    for (const [k, v] of [['sub', ''], ['thumbFileId', null], ['audioFileId', null], ['notionPageId', null], ['firstPublishedAt', null], ['lastPublishedAt', null], ['publishedVersion', 0]]) if (!(k in item)) { item[k] = v; changed = true; }
    if (item.slug === 'gachitayong' && !item.sub && item.category === 'competitions') { item.sub = 'hackathons'; changed = true; }
  }
  const g = d.items.find((i) => i.slug === 'gachitayong' && i.title === '가치타용');
  if (g) { Object.assign(g, GACHITAYONG_EN, { updatedAt: new Date().toISOString() }); changed = true; }
  return changed;
}

let db = null;

// 분류 키 목록 (순서대로). 숨긴 분류도 포함한다.
function categoryKeys() {
  const c = get().categories;
  return Object.keys(c).sort((a, b) => (c[a].order ?? 999) - (c[b].order ?? 999) || a.localeCompare(b));
}
// 분류 모양: 연결된 방 물건이 원래 맡던 분류 키.
function kindOf(key) {
  const c = get().categories[key];
  return (c && THING_KIND[c.thing]) || null;
}
// 방문자에게 보이는 분류: 사용 중이고 방 물건이 연결된 것.
function categoryShown(key) {
  const c = get().categories[key];
  return !!(c && c.enabled !== false && kindOf(key));
}

function load() {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    db = seed();
    migrate(db);
    save();
  } else {
    db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    if (migrate(db)) save();
  }
  return db;
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

function get() {
  return db || load();
}

module.exports = { DATA_DIR, UPLOAD_DIR, ADMIN_FILE, CATEGORY_KEYS, CATEGORIES_KO, DEFAULT_CATEGORIES, THING_KIND, newId, blankItem, load, save, get, categoryKeys, kindOf, categoryShown };
