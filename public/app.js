// Visitor side: porch → room → corner of the room → category → item, and back one step at a time.
// The porch, the room and every category screen are the provided PNGs. Hotspots, slots and
// camera moves are written in each picture's own pixels, so they stay on the furniture at any size.
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const el = (html) => {
    const t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  };
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const wait = (ms) => new Promise((r) => setTimeout(r, reduced() ? 0 : ms));
  const touchFirst = () => window.matchMedia('(hover: none)').matches;
  const isDebug = new URLSearchParams(location.search).has('debug');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // quick start, soft stop
  const EASE = 'cubic-bezier(.2,.8,.2,1)';
  const EASE_IN = 'cubic-bezier(.55,0,.8,.25)';
  const EASE_INOUT = 'cubic-bezier(.6,0,.3,1)';
  const T_ZOOM = 360;
  const T_BACK = 320;

  // Shift every x,y pair of an SVG path written with absolute commands.
  const shiftPath = (d, dx, dy) => {
    let i = 0;
    return d.replace(/-?\d+(\.\d+)?/g, (n) => String(+n - (i++ % 2 ? dy : dx)));
  };

  /* ------------------------------------------------------------ */
  /* Scene data (source-image pixels)                              */
  /* ------------------------------------------------------------ */
  const DOOR_PATH = 'M414 708 L411 680 L408 650 L404 620 L400 590 L396 570 L392 550 L387 530 L384 510 L380 490 L378 470 L376 450 L378 430 L382 400 L386 372 L389 350 L397 330 L406 310 L419 290 L436 270 L463 250 L488 240 L519 231 L542 231 L562 237 L581 247 L597 263 L611 287 L620 307 L633 330 L645 352 L654 377 L661 397 L668 417 L672 437 L674 467 L672 487 L668 507 L670 527 L666 547 L660 567 L652 582 L647 600 L645 630 L645 670 L646 708 Z';
  const PLATE_PAD = 22; // keep the name clear of the plate's screws
  const PORCH = {
    key: 'porch', img: '/img/porch.png', w: 1586, h: 992,
    door: { x: 370, y: 224, w: 310, h: 488, hinge: 384 },
    doorway: { img: '/img/doorway.png', x: 360, y: 220, w: 330, h: 495 },
    plate: { x: 466, y: 404, w: 146, h: 56 },
    plateText: 19, // largest name size on the plate, in picture pixels
    mailboxFocus: { x: 740, y: 404, w: 180, h: 150 },
    addrLabel: { x: 786, y: 462, w: 80, h: 46 },
    spots: [
      { id: 'handle', name: 'Enter', act: 'enter', place: 'below',
        d: 'M550 466 C580 466 594 492 592 524 C590 558 574 572 550 572 C524 572 508 556 508 524 C508 490 522 466 550 466 Z' },
      { id: 'nameplate', name: 'Who am I?', act: 'about', place: 'above',
        d: 'M466 410 L606 404 L612 452 L470 460 Z' },
      { id: 'mailbox', name: 'How to reach me', act: 'mail', place: 'below',
        d: 'M758 474 C758 448 772 438 792 437 L862 436 L866 424 L898 420 L901 446 L879 452 L879 530 L772 536 L760 522 Z' },
    ],
  };

  const ROOM = {
    key: 'room', img: '/img/room.png', w: 1586, h: 992,
    zones: {
      desk: { name: 'Desk', box: { x: 62, y: 186, width: 540, height: 500 }, d: 'M60 190 L596 190 L596 690 L60 690 Z' },
      // narrowBox: on phones the wall is framed on the bookshelf, club board and the two frames (with room for their titles)
      wall: { name: 'Wall', box: { x: 590, y: 140, width: 680, height: 430 }, narrowBox: { x: 556, y: 190, width: 384, height: 392 }, d: 'M598 140 L1272 140 L1272 462 L960 462 L944 560 L598 560 Z' },
      rest: { name: 'Rest corner', box: { x: 940, y: 280, width: 646, height: 480 }, d: 'M944 462 L1272 462 L1272 290 L1586 290 L1586 770 L944 770 Z' },
    },
    things: [
      { id: 'board', zone: 'desk', cat: 'competitions', tag: [200, 292, 'up'], popAlign: 'end', popWidth: 250, d: 'M112 298 L288 290 L296 440 L218 448 L216 492 L124 498 Z' },
      { id: 'crt', zone: 'desk', cat: 'coding', tag: [330, 668, 'down'], popBox: { x: 216, y: 444, width: 176, height: 150 }, popAlign: 'end', d: 'M216 470 L232 450 L345 444 L390 460 L392 598 L446 600 L498 610 L494 640 L440 652 L300 668 L284 640 L240 632 L232 596 L218 584 Z' },
      { id: 'shirt', zone: 'desk', cat: 'work', tag: [393, 200, 'up'], d: 'M372 202 L414 202 L414 240 L462 262 L470 334 L432 344 L430 424 L330 424 L330 346 L318 334 L322 266 L370 242 Z' },
      { id: 'chest', zone: 'desk', cat: 'ideas', tag: [488, 590, 'down'], d: 'M392 500 L420 488 L466 494 L520 497 L560 490 L584 505 L582 572 L560 586 L410 588 L392 570 Z' },
      { id: 'bookshelf', zone: 'wall', cat: 'study', tag: [664, 552, 'down'], d: 'M598 222 L622 208 L718 212 L730 226 L730 548 L604 552 L598 532 Z' },
      { id: 'cork', zone: 'wall', cat: 'clubs', tag: [826, 202, 'up'], d: 'M746 226 L790 204 L862 206 L906 224 L906 300 L862 318 L790 314 L746 300 Z' },
      { id: 'naver', zone: 'wall', link: 'naverUrl', name: 'Naver Blog', tag: [793, 450, 'down'], d: 'M748 344 L838 344 L838 444 L748 444 Z' },
      { id: 'insta', zone: 'wall', link: 'instagramUrl', name: 'Instagram', tag: [883, 444, 'down'], d: 'M845 356 L922 356 L922 438 L845 438 Z' },
      { id: 'bed', zone: 'rest', cat: 'hobbies', tag: [1215, 560, 'mid'], d: 'M1004 642 L1030 590 L1080 540 L1140 514 L1250 498 L1262 340 L1290 312 L1345 300 L1420 318 L1470 370 L1472 500 L1440 520 L1440 556 L1378 600 L1370 690 L1290 734 L1200 708 L1100 660 L1040 668 Z' },
      { id: 'diary', zone: 'rest', cat: 'love', tag: [1004, 470, 'up'], d: 'M966 490 L1030 474 L1054 486 L1052 508 L986 518 L966 505 Z' },
      { id: 'turntable', zone: 'rest', cat: 'compositions', music: true, tag: [1512, 462, 'up'], d: 'M1382 592 L1396 570 L1470 560 L1460 476 L1556 470 L1582 520 L1578 626 L1462 656 L1390 640 Z' },
    ],
    props: {
      // cup and plant: the whole object (handle / trailing leaves included); a clean plate goes under it while it moves
      cup: { d: 'M1052 470 L1056 465 L1084 465 L1088 470 L1087 476 L1094 475 L1100 481 L1100 494 L1094 501 L1087 502 L1084 509 L1055 509 L1051 503 L1051 478 Z', origin: [1084, 508], plate: [1044, 460], name: 'Blue cup' },
      candle: { d: 'M634 320 L664 320 L668 386 L632 386 Z', name: 'Candle' },
      plant: { d: 'M462 384 L484 380 L500 388 L520 394 L540 398 L548 412 L556 428 L562 448 L566 466 L566 486 L560 496 L562 512 L556 528 L540 528 L530 512 L524 498 L500 500 L470 500 L460 488 L452 468 L440 462 L436 448 L438 430 L442 414 L450 400 Z', origin: [500, 494], plate: [436, 382], name: 'Potted plant' },
      window: { d: 'M952 305 A140 140 0 1 0 1232 305 A140 140 0 1 0 952 305 Z', name: 'Round window' },
    },
    record: { x: 1413, y: 561, w: 124, h: 36 },
    tonearm: 'M1473 595 L1492 594 L1536 582 L1535 574 L1551 573 L1552 606 L1536 603 L1540 591 L1494 603 L1492 608 L1474 608 Z',
  };
  const thing = (id) => ROOM.things.find((t) => t.id === id);
  const thingOfCat = (cat) => ROOM.things.find((t) => t.cat === cat);

  /* ------------------------------------------------------------ */
  /* Category screens: background + slots (tab-image pixels)       */
  /* ------------------------------------------------------------ */
  const grid = (xs, ys, w, h) => ys.flatMap((y) => xs.map((x) => ({ x, y, w, h })));
  const LAYOUTS = {
    competitions: { style: 'pinned', slots: [
      { x: 190, y: 150, w: 340, h: 320, r: -2 }, { x: 623, y: 138, w: 340, h: 320, r: 1.5 }, { x: 1056, y: 150, w: 340, h: 320, r: -1 },
      { x: 200, y: 500, w: 340, h: 320, r: 1.8 }, { x: 633, y: 512, w: 340, h: 320, r: -1.4 }, { x: 1060, y: 500, w: 340, h: 320, r: 1 }] },
    clubs: { style: 'polaroid', slots: [
      { x: 255, y: 172, w: 320, h: 285, r: -2.5 }, { x: 633, y: 186, w: 320, h: 285, r: 2 }, { x: 1010, y: 172, w: 320, h: 285, r: -1.5 },
      { x: 268, y: 495, w: 320, h: 285, r: 1.6 }, { x: 645, y: 505, w: 320, h: 285, r: -2.2 }, { x: 1018, y: 492, w: 320, h: 285, r: 2.4 }] },
    coding: { style: 'icon', slots: grid([322, 562, 802, 1042], [205, 405, 605], 200, 190) },
    work: { style: 'pocket', slots: [
      { x: 532, y: 128, w: 194, h: 250, pocket: 'M512 255 Q630 292 746 255 L748 445 L630 487 L512 445 Z' },
      { x: 860, y: 128, w: 194, h: 250, pocket: 'M840 255 Q958 292 1076 255 L1078 445 L958 487 L840 445 Z' },
      { x: 528, y: 440, w: 194, h: 250, pocket: 'M508 567 Q627 604 746 567 L748 757 L627 800 L508 757 Z' },
      { x: 861, y: 440, w: 194, h: 250, pocket: 'M840 567 Q959 604 1078 567 L1080 757 L959 800 L840 757 Z' }] },
    ideas: { style: 'memo', slots: [
      { x: 378, y: 402, w: 368, h: 118, r: -1.5 }, { x: 838, y: 402, w: 372, h: 118, r: 1.2 },
      { x: 368, y: 598, w: 382, h: 128, r: 1 }, { x: 842, y: 598, w: 396, h: 128, r: -1.2 }] },
    study: { style: 'file', slots: [
      ...[262, 456, 650, 844, 1038].map((x) => ({ x, y: 190, w: 182, h: 116 })),
      ...[268, 480, 692, 904, 1116].map((x) => ({ x, y: 360, w: 196, h: 120 })),
      ...[268, 480, 692, 904, 1116].map((x) => ({ x, y: 526, w: 196, h: 118 })),
      ...[268, 480, 692, 904, 1116].map((x) => ({ x, y: 694, w: 196, h: 116 }))] },
    hobbies: { style: 'object', slots: [
      { x: 250, y: 410, w: 230, h: 210, r: -6 }, { x: 545, y: 395, w: 230, h: 210, r: 4 }, { x: 835, y: 420, w: 230, h: 210, r: -3 }, { x: 1110, y: 402, w: 230, h: 210, r: 5 },
      { x: 280, y: 655, w: 230, h: 210, r: 3 }, { x: 570, y: 672, w: 230, h: 210, r: -4 }, { x: 858, y: 648, w: 230, h: 210, r: 6 }, { x: 1128, y: 664, w: 230, h: 210, r: -5 }] },
    love: { style: 'line', slots: [
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 196, y: 170 + i * 88, w: 540, h: 70 })),
      ...[0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 858, y: 170 + i * 88, w: 540, h: 70 }))] },
    compositions: { style: 'jacket', slots: [
      ...[205, 405, 605, 805, 1005].map((x) => ({ x, y: 278, w: 160, h: 156 })),
      ...[195, 400, 605, 810, 1015].map((x) => ({ x, y: 494, w: 170, h: 166 }))] },
  };
  const PAGE_WORD = { work: 'Shirt', love: 'Spread', study: 'Shelf' };

  /* ------------------------------------------------------------ */
  /* State                                                         */
  /* ------------------------------------------------------------ */
  const state = { site: null, busy: false, cur: { v: 'porch' }, view: null, porch: null, preRoom: null, room: null, cat: null, item: null, pendingPop: null, shareItem: null };
  const app = $('#app');
  const site = () => state.site.settings;
  const siteName = () => (state.site && site().siteName) || 'Plot Twist';
  const cats = () => state.site.categories;
  const catItems = (k) => (state.site && state.site.items[k]) || [];
  const catActive = (k) => catItems(k).length > 0;
  const subsWithItems = (k) => cats()[k].subs.filter((s) => catItems(k).some((i) => i.sub === s.id));
  // A category borrows the look (layout, tab picture) of the room thing it is linked to.
  const kindOf = (k) => (state.site && state.site.categories[k] && state.site.categories[k].kind) || k;
  // Which category each room thing opens comes from the site data (managed in Notion).
  function linkThings() {
    ROOM.things.forEach((t) => {
      if (t.link) return;
      t.cat = Object.keys(cats()).find((k) => cats()[k].thing === t.id) || null;
    });
  }

  // On the static site (Cloudflare Pages) the data lives in .json files.
  const STATIC = !!window.PT_STATIC;
  const API = {
    site: STATIC ? '/api/site.json' : '/api/site',
    item: (slug) => `/api/items/${encodeURIComponent(slug)}${STATIC ? '.json' : ''}`,
  };
  async function getJSON(url) {
    const r = await fetch(url, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!r.ok) throw Object.assign(new Error('fetch failed'), { status: r.status, body: await r.json().catch(() => null) });
    return r.json();
  }
  let toastTimer;
  function toast(msg) {
    const t = $('.toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }
  // Run a Web Animation and leave the element at its end state. Reduced motion jumps straight to the end.
  function play(node, frames, opts) {
    const last = frames[frames.length - 1];
    const commit = () => { for (const [k, v] of Object.entries(last)) if (k !== 'offset' && k !== 'easing') node.style[k] = v; };
    if (reduced() || !node.isConnected) { commit(); return Promise.resolve(); }
    const a = node.animate(frames, { fill: 'forwards', ...opts });
    // A hidden tab can pause animations; never let a transition hang because of that.
    const limit = (opts.duration || 0) + (opts.delay || 0) + 400;
    return new Promise((resolve) => {
      let done = false;
      const end = () => { if (done) return; done = true; commit(); a.cancel(); resolve(); };
      a.finished.then(end, end);
      setTimeout(end, limit);
    });
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; } catch {
      const ta = el('<textarea style="position:fixed;opacity:0"></textarea>');
      ta.value = text;
      document.body.append(ta);
      ta.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch {}
      ta.remove();
      return ok;
    }
  }

  /* ------------------------------------------------------------ */
  /* Navigation: every step is a history entry, Back goes one step */
  /* ------------------------------------------------------------ */
  function pushState(s, url) {
    history.pushState(s, '', url || location.pathname + location.search);
    state.cur = s;
  }
  function replaceState(s, url) {
    history.replaceState(s, '', url || location.pathname + location.search);
    state.cur = s;
  }
  // One transition at a time. Clicks during a move are ignored; browser Back during a move waits its turn.
  async function run(fn) {
    if (state.busy) return false;
    state.busy = true;
    document.documentElement.classList.add('moving');
    try { await fn(); } catch (e) { console.error(e); }
    state.busy = false;
    document.documentElement.classList.remove('moving');
    if (state.pendingPop) {
      const s = state.pendingPop;
      state.pendingPop = null;
      restore(s);
    }
    return true;
  }
  function goBack() {
    if (state.busy) return;
    history.back();
  }
  window.addEventListener('popstate', (e) => {
    const s = e.state || stateFromURL();
    if (state.busy) { state.pendingPop = s; return; }
    restore(s);
  });
  function stateFromURL() {
    const m = /^\/w\/([a-z0-9-]+)\/?$/.exec(location.pathname);
    if (m) return { v: 'share', slug: m[1] };
    const pv = /^\/preview\/([a-f0-9-]{32,36})$/.exec(location.pathname);
    if (pv) return { v: 'preview', id: pv[1] };
    if (location.pathname === '/room') return { v: 'room' };
    return { v: 'porch' };
  }
  const inRoom = () => state.room && state.view === 'room';
  // Bring the screen to state s from wherever it is.
  function restore(s) {
    const cur = state.cur;
    run(async () => {
      if (s.v === 'porch') {
        if (cur.v === 'porch' && state.porch) {
          if (cur.focus && !s.focus) await porchUnfocus();
          else if (!cur.focus && s.focus) await porchFocus(s.focus);
        } else renderPorch();
      } else if (s.v === 'room') {
        if (state.item && inRoom()) await closeItem();
        if (state.cat && inRoom()) await closeCat();
        if (inRoom()) { if ((state.room.zone || null) !== (s.zone || null)) await setZone(s.zone || null); }
        else renderRoom(s.zone || null);
      } else if (s.v === 'cat') {
        if (state.item && state.cat && state.cat.key === s.key) await closeItem();
        else {
          if (state.cat) { state.cat.view.remove(); state.cat = null; state.item = null; }
          if (!inRoom()) renderRoom(s.zone || null);
          else if ((state.room.zone || null) !== (s.zone || null)) await setZone(s.zone || null);
          await openCat(s.key, { filter: s.filter, page: s.page, scroll: s.scroll });
        }
      } else if (s.v === 'item') {
        if (state.cat && state.cat.key === s.key && inRoom()) await openItem(s.slug);
        else await renderShare(s.slug);
      } else if (s.v === 'share') {
        await renderShare(s.slug);
      } else if (s.v === 'preview') {
        await renderShare(null, s.id);
      }
      state.cur = s;
    });
  }

  /* ------------------------------------------------------------ */
  /* Stage: picture + hotspots in source pixels, scaled to screen  */
  /* ------------------------------------------------------------ */
  function buildStage(scene, inside = '', over = '') {
    const root = el(`
      <div class="stage stage-${scene.key}">
        <div class="scroller">
          <div class="sizer">
            <div class="camera">
              <div class="scene" style="width:${scene.w}px;height:${scene.h}px">
                <img class="scene-img" src="${scene.img}" width="${scene.w}" height="${scene.h}" alt="" draggable="false">
                ${inside}
                <svg class="spots ${isDebug ? 'debug' : ''}" viewBox="0 0 ${scene.w} ${scene.h}" width="${scene.w}" height="${scene.h}">
                  <defs>
                    <filter id="sunlit-${scene.key}" color-interpolation-filters="sRGB">
                      <feComponentTransfer>
                        <feFuncR type="linear" slope="1.17" intercept="0.035"/>
                        <feFuncG type="linear" slope="1.13" intercept="0.03"/>
                        <feFuncB type="linear" slope="1.03" intercept="0.0"/>
                      </feComponentTransfer>
                    </filter>
                    <filter id="feather-${scene.key}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="6"/></filter>
                    <mask id="glowmask-${scene.key}" maskUnits="userSpaceOnUse" x="0" y="0" width="${scene.w}" height="${scene.h}">
                      <path class="glow-shape" d="M0 0" fill="#fff" stroke="#fff" stroke-width="12" stroke-linejoin="round" filter="url(#feather-${scene.key})"/>
                    </mask>
                  </defs>
                  <image class="glow" href="${scene.img}" width="${scene.w}" height="${scene.h}" filter="url(#sunlit-${scene.key})" mask="url(#glowmask-${scene.key})"/>
                </svg>
                ${over}
              </div>
            </div>
          </div>
        </div>
        <div class="hud"></div>
      </div>`);
    const st = {
      scene, root,
      scroller: $('.scroller', root), sizer: $('.sizer', root), camera: $('.camera', root),
      sceneEl: $('.scene', root), svg: $('svg.spots', root), hud: $('.hud', root),
      glow: $('.glow', root), glowShape: $('.glow-shape', root),
      s: 1, offY: 0, spots: {}, cam: { t: { x: 0, y: 0 }, z: 1 }, label: null,
    };
    st.layout = () => {
      const vw = window.innerWidth, vh = window.innerHeight;
      const s = Math.max(vw / scene.w, vh / scene.h);
      st.s = s;
      st.offY = (vh - scene.h * s) / 2;
      st.sizer.style.width = scene.w * s + 'px';
      st.camera.style.width = scene.w * s + 'px';
      st.camera.style.height = scene.h * s + 'px';
      st.camera.style.top = st.offY + 'px';
      st.sceneEl.style.transform = `scale(${s})`;
    };
    // scene box → screen rect for a camera
    st.toScreen = (box, cam = st.cam) => {
      const s = st.s, sl = st.scroller.scrollLeft;
      return {
        left: -sl + cam.t.x + box.x * s * cam.z,
        top: st.offY + cam.t.y + box.y * s * cam.z,
        width: box.width * s * cam.z,
        height: box.height * s * cam.z,
      };
    };
    // camera that brings a scene box to the screen centre without showing past the picture's edges
    st.cameraFor = (box, z) => {
      const s = st.s, sl = st.scroller.scrollLeft;
      const vw = window.innerWidth, vh = window.innerHeight;
      const cx = (box.x + box.width / 2) * s * z, cy = (box.y + box.height / 2) * s * z;
      let tx = sl + vw / 2 - cx, ty = -st.offY + vh / 2 - cy;
      const W = scene.w * s * z, H = scene.h * s * z;
      tx = Math.min(sl, Math.max(sl + vw - W, tx));
      ty = Math.min(-st.offY, Math.max(-st.offY + vh - H, ty));
      return { t: { x: tx, y: ty }, z };
    };
    st.camCSS = (cam) => `translate(${cam.t.x}px, ${cam.t.y}px) scale(${cam.z})`;
    st.setCam = (cam) => { st.cam = cam; st.camera.style.transform = st.camCSS(cam); };
    st.moveCam = async (cam, dur, easing = EASE) => {
      const from = st.camCSS(st.cam);
      st.cam = cam;
      await play(st.camera, [{ transform: from }, { transform: st.camCSS(cam) }], { duration: dur, easing });
    };
    return st;
  }
  function addSpot(st, sp, active, h) {
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', sp.d);
    p.setAttribute('class', 'spot' + (active ? ' active' : '') + (h.cls ? ' ' + h.cls : ''));
    p.dataset.id = sp.id;
    if (sp.zoneAttr) p.dataset.zone = sp.zoneAttr;
    st.svg.append(p);
    st.spots[sp.id] = { sp, p, active };
    if (!active) return p; // no public content: part of the picture, no reaction at all
    p.setAttribute('tabindex', '0');
    p.setAttribute('role', h.role || 'button');
    p.setAttribute('aria-label', h.aria);
    if (h.enter) { p.addEventListener('mouseenter', () => h.enter('hover')); p.addEventListener('focus', () => h.enter('focus')); }
    if (h.leave) { p.addEventListener('mouseleave', (e) => h.leave('hover', e)); p.addEventListener('blur', () => h.leave('focus')); }
    p.addEventListener('click', (e) => { e.stopPropagation(); if (!state.busy) h.act('click'); });
    p.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (!state.busy) h.act('key'); }
    });
    return p;
  }
  function glowOn(st, d) {
    st.glowShape.setAttribute('d', d);
    st.glow.classList.add('on');
  }
  function glowOff(st) {
    st.glow.classList.remove('on');
  }
  function bboxOf(st, id) {
    const b = st.spots[id].p.getBBox();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  }
  // One speech bubble at a time per stage. Its tail always points at the thing it belongs to,
  // even when the body has to slide to stay on screen.
  const SIDES = { above: ['above', 'below'], below: ['below', 'above'], right: ['right', 'left', 'below', 'above'], left: ['left', 'right', 'below', 'above'] };
  function setBubble(st, node, box, prefer, owner, align) {
    closeBubble(st);
    st.hud.append(node);
    st.bubble = { node, owner, box, prefer };
    placeBubble(st, node, box, prefer, align);
    return node;
  }
  function closeBubble(st, owner) {
    if (!st.bubble || (owner && st.bubble.owner !== owner)) return;
    st.bubble.node.remove();
    st.bubble = null;
  }
  // align 'end' keeps the tail near the bubble's right end, so the body opens to the left
  function placeBubble(st, node, box, prefer = 'above', align = 'center') {
    const r = st.toScreen(box);
    const vw = window.innerWidth, vh = window.innerHeight, TOP = 58, M = 8, G = 14;
    const w = node.offsetWidth, h = node.offsetHeight;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const order = Array.isArray(prefer) ? prefer : SIDES[prefer] || SIDES.above;
    const fits = {
      above: r.top - G - h >= TOP,
      below: r.top + r.height + G + h <= vh - M,
      right: r.left + r.width + G + w <= vw - M,
      left: r.left - G - w >= M,
    };
    const side = order.length === 1 ? order[0] : order.find((sd) => fits[sd]) || order[0];
    let left, top;
    if (side === 'above' || side === 'below') {
      left = clamp(align === 'end' ? cx - w + 30 : cx - w / 2, M, vw - w - M);
      top = clamp(side === 'above' ? r.top - G - h : r.top + r.height + G, TOP, vh - h - M);
      node.style.setProperty('--tail', clamp(cx - left, 18, w - 18) + 'px');
    } else {
      top = clamp(cy - h / 2, TOP, vh - h - M);
      left = clamp(side === 'right' ? r.left + r.width + G : r.left - G - w, M, vw - w - M);
      node.style.setProperty('--tail', clamp(cy - top, 16, h - 16) + 'px');
    }
    node.dataset.side = side;
    node.style.left = left + 'px';
    node.style.top = top + 'px';
  }
  // A small name label (not clickable) next to a scene box.
  function showLabel(st, box, html, prefer = 'above', owner = null) {
    return setBubble(st, el(`<div class="bubble label anim">${html}</div>`), box, prefer, owner);
  }
  function hideLabel(st, owner) {
    if (st.bubble && st.bubble.node.classList.contains('label')) closeBubble(st, owner);
  }
  function centerScroll(st, x) {
    const sc = st.scroller;
    sc.scrollLeft = Math.max(0, x * st.s - sc.clientWidth / 2);
  }
  function fitText(box, max, min = 8, step = 1) {
    if (!box) return;
    const span = box.querySelector('span') || box;
    let size = max;
    span.style.fontSize = size + 'px';
    while ((span.scrollWidth > box.clientWidth - 12 || span.scrollHeight > box.clientHeight + 1) && size > min) {
      size -= step;
      span.style.fontSize = size + 'px';
    }
  }

  /* ------------------------------------------------------------ */
  /* Top bar and Back button                                       */
  /* ------------------------------------------------------------ */
  function topbar(right = '') {
    return `
      <header class="topbar">
        <div class="top-left"><span class="logo">${esc(siteName())}</span></div>
        <div class="top-right">${right}</div>
      </header>`;
  }
  function setBack(view, on) {
    const left = $('.top-left', view);
    if (!left) return;
    left.innerHTML = on ? '<button class="btn back" type="button" data-back>← Back</button>' : `<span class="logo">${esc(siteName())}</span>`;
  }
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-back]')) { e.preventDefault(); e.stopPropagation(); goBack(); }
  }, true);

  /* ------------------------------------------------------------ */
  /* Porch                                                         */
  /* ------------------------------------------------------------ */
  function renderPorch() {
    document.title = siteName();
    state.view = 'porch';
    state.room = null;
    state.preRoom = null;
    state.cat = null;
    state.item = null;
    app.innerHTML = '';
    const d = PORCH.door, w = PORCH.doorway, pl = PORCH.plate, al = PORCH.addrLabel;
    const doorClip = `path('${shiftPath(DOOR_PATH, d.x, d.y)}')`;
    const inside = `
      <div class="doorway" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px;clip-path:${doorClip}">
        <img src="${w.img}" alt="" style="left:${w.x - d.x}px;top:${w.y - d.y}px;width:${w.w}px;height:${w.h}px">
      </div>
      <div class="door-leaf" style="left:${d.x}px;top:${d.y}px;width:${d.w}px;height:${d.h}px;transform-origin:${d.hinge - d.x}px 50%">
        <div class="door-leaf-paint" style="clip-path:${doorClip};background-position:${-d.x}px ${-d.y}px"></div>
      </div>`;
    // the name sits above the hover glow so it never disappears; screws at both ends stay clear
    const over = `<div class="nameplate-text" style="left:${pl.x + PLATE_PAD}px;top:${pl.y + 4}px;width:${pl.w - PLATE_PAD * 2}px;height:${pl.h - 10}px"><span>${esc(siteName())}</span></div>` + (site().email ? `
      <div class="addr-label" style="left:${al.x}px;top:${al.y}px;width:${al.w}px;height:${al.h}px" hidden>
        <span class="addr-to">To reach me</span>
        <span class="addr-mail">${esc(site().email)}</span>
        <button class="addr-copy" type="button">Copy</button>
      </div>` : `
      <div class="addr-label soon" style="left:${al.x}px;top:${al.y}px;width:${al.w}px;height:${al.h}px" hidden>
        <span class="addr-to">To reach me</span>
        <span class="addr-soon">Coming soon</span>
      </div>`);
    const st = buildStage(PORCH, inside, over);
    const view = el(`<div class="view porch-view">${topbar()}
        <p class="porch-hint"><span class="hint-mouse">Look around the porch, then click the door handle to come in</span><span class="hint-touch">Tap the door handle to come in</span></p>
      </div>`);
    view.prepend(st.root);
    app.append(view);
    st.layout();
    state.porch = { st, view, focus: null };
    fitText($('.nameplate-text', st.root), PORCH.plateText, 9, 0.5);
    centerScroll(st, 636); // narrow screens: door and mailbox both in view
    const s = site();
    PORCH.spots.forEach((sp) => {
      const active = sp.when ? sp.when(s) : true;
      addSpot(st, sp, active, {
        aria: sp.act === 'enter' ? 'Door handle — enter the room' : sp.act === 'about' ? 'Nameplate — who am I?' : 'Mailbox — how to reach me',
        enter: () => { if (state.busy || !state.porch || state.porch.focus) return; glowOn(st, sp.d); showLabel(st, bboxOf(st, sp.id), `<b>${esc(sp.name)}</b>`, sp.place, sp.id); },
        leave: () => { glowOff(st); hideLabel(st, sp.id); },
        act: () => {
          if (!state.porch || state.porch.focus) return;
          if (sp.act === 'enter') run(enterRoom);
          else run(async () => { pushState({ v: 'porch', focus: sp.act }); await porchFocus(sp.act); });
        },
      });
    });
    const copyBtn = $('.addr-copy', st.root);
    if (copyBtn) copyBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (await copyText(site().email)) {
        copyBtn.textContent = 'Copied';
        copyBtn.classList.add('done');
        setTimeout(() => { copyBtn.textContent = 'Copy'; copyBtn.classList.remove('done'); }, 1400);
      } else {
        const r = document.createRange();
        r.selectNodeContents($('.addr-mail', st.root));
        getSelection().removeAllRanges();
        getSelection().addRange(r);
        toast('Selected — press Ctrl+C (⌘C) to copy');
      }
    });
    // a click away from the focused thing works like Back
    st.root.addEventListener('click', (e) => {
      if (state.porch && state.porch.focus && !state.busy && !e.target.closest('.addr-label, .plate-card')) goBack();
    });
    st.scroller.addEventListener('scroll', () => hideLabel(st), { passive: true });
    if (document.fonts) document.fonts.ready.then(() => fitText($('.nameplate-text', st.root), PORCH.plateText, 9, 0.5));
    setTimeout(prebuildRoom, 500);
  }

  // Mailbox or nameplate: short zoom, then the address label / the plate flips. Back reverses it.
  async function porchFocus(kind) {
    const P = state.porch, st = P.st;
    P.focus = kind;
    P.prevFocusSpot = kind === 'mail' ? 'mailbox' : 'nameplate';
    glowOff(st);
    hideLabel(st);
    setBack(P.view, true);
    P.view.classList.add('focused');
    P.prevCam = st.cam;
    st.scroller.classList.add('locked');
    const vw = window.innerWidth, vh = window.innerHeight;
    if (kind === 'mail') {
      const b = PORCH.mailboxFocus;
      const box = { x: b.x, y: b.y, width: b.w, height: b.h };
      const z = clamp(Math.min((vw * 0.86) / (b.w * st.s), (vh * 0.62) / (b.h * st.s)), 1.4, 2.8);
      const lab = $('.addr-label', st.root);
      await st.moveCam(st.cameraFor(box, z), T_ZOOM);
      lab.hidden = false;
      fitMail(lab);
      await play(lab, [{ opacity: 0, transform: 'rotate(-2deg) scale(.9)' }, { opacity: 1, transform: 'rotate(-2deg) scale(1)' }], { duration: 160, easing: EASE });
      $('.addr-copy', lab).focus({ preventScroll: true });
    } else {
      const pl = PORCH.plate;
      const box = { x: pl.x, y: pl.y, width: pl.w, height: pl.h };
      const z = clamp(vw / 3 / (pl.w * st.s), 1.15, 2.2);
      const cam = st.cameraFor(box, z);
      const from = st.toScreen(box);
      const to0 = st.toScreen(box, cam);
      const card = plateCard();
      P.card = card;
      P.cardBox = box;
      st.hud.append(card);
      const W = Math.min(600, vw - 32);
      card.style.width = W + 'px';
      card.style.setProperty('--card-w', W + 'px');
      const back = $('.plate-back', card);
      const bs = getComputedStyle(back);
      const H = Math.min(back.scrollHeight + parseFloat(bs.borderTopWidth) + parseFloat(bs.borderBottomWidth) + 6, vh - 140);
      card.style.height = H + 'px';
      const fx = clamp(to0.left + to0.width / 2, W / 2 + 16, vw - W / 2 - 16);
      const fy = clamp(to0.top + to0.height / 2, H / 2 + 76, vh - H / 2 - 16);
      const start = { x: from.left + from.width / 2 - W / 2, y: from.top + from.height / 2 - H / 2, sx: from.width / W, sy: from.height / H };
      const end = { x: fx - W / 2, y: fy - H / 2, sx: 1, sy: 1 };
      card.style.transform = cardT(start);
      P.cardEnd = end;
      await Promise.all([
        st.moveCam(cam, T_ZOOM + 40),
        flipCard(card, start, end, T_ZOOM + 60, true),
      ]);
      card.classList.add('flipped');
      $('.plate-back', card).focus({ preventScroll: true });
    }
  }
  function fitMail(lab) {
    const m = $('.addr-mail', lab);
    if (!m) return; // no address yet: the label says "Coming soon"
    let size = 7.5;
    m.style.fontSize = size + 'px';
    while (m.scrollWidth > lab.clientWidth - 6 && size > 3) { size -= 0.25; m.style.fontSize = size + 'px'; }
  }
  // the flip card's front shows the name at the same proportion as on the plate
  function plateFontPx() {
    const t = state.porch && $('.nameplate-text span', state.porch.st.root);
    const f = t ? parseFloat(t.style.fontSize) || PORCH.plateText : PORCH.plateText;
    return `calc(var(--card-w) * ${f / PORCH.plate.w})`;
  }
  function plateCard() {
    const s = site(), pl = PORCH.plate;
    const bgSize = `${(PORCH.w / pl.w) * 100}% ${(PORCH.h / pl.h) * 100}%`;
    const bgPos = `${(pl.x / (PORCH.w - pl.w)) * 100}% ${(pl.y / (PORCH.h - pl.h)) * 100}%`;
    const paras = String(s.aboutText || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    return el(`
      <div class="plate-card" role="dialog" aria-label="Who am I?">
        <div class="plate-front" style="background-size:${bgSize};background-position:${bgPos};padding:0 ${(PLATE_PAD / pl.w) * 100}%"><span style="font-size:${plateFontPx()}">${esc(siteName())}</span></div>
        <div class="plate-back" tabindex="-1">
          <h2>${esc(siteName())}</h2>
          ${paras.map((p) => `<p>${esc(p)}</p>`).join('')}
          ${s.aboutHistory.length ? `<ul>${s.aboutHistory.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>` : ''}
          ${!paras.length && !s.aboutHistory.length ? '<p class="soon-note">My story is coming soon.</p>' : ''}
        </div>
      </div>`);
  }
  // The plate flips without 3D: it folds to an edge, the other face comes up, and it unfolds.
  // (Safari does not reliably hide the back face of a 3D-rotated card, so both faces could show.)
  const cardT = (c) => `translate(${c.x}px, ${c.y}px) scale(${c.sx}, ${c.sy})`;
  async function flipCard(card, from, to, duration, toBack) {
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, sx: 0.001, sy: (from.sy + to.sy) / 2 };
    await play(card, [{ transform: cardT(from) }, { transform: cardT(mid) }], { duration: duration / 2, easing: 'cubic-bezier(.5,0,.9,.6)' });
    card.classList.toggle('show-back', toBack);
    await play(card, [{ transform: cardT(mid) }, { transform: cardT(to) }], { duration: duration / 2, easing: 'cubic-bezier(.1,.4,.5,1)' });
  }
  async function porchUnfocus() {
    const P = state.porch, st = P.st;
    const back = P.prevCam || { t: { x: 0, y: 0 }, z: 1 };
    if (P.focus === 'mail') {
      const lab = $('.addr-label', st.root);
      await play(lab, [{ opacity: 1 }, { opacity: 0 }], { duration: 100 });
      lab.hidden = true;
      lab.style.opacity = '';
      await st.moveCam(back, T_BACK);
    } else if (P.card) {
      const card = P.card;
      card.classList.remove('flipped');
      const to = st.toScreen(P.cardBox, back);
      const W = card.offsetWidth, H = card.offsetHeight;
      const end = { x: to.left + to.width / 2 - W / 2, y: to.top + to.height / 2 - H / 2, sx: to.width / W, sy: to.height / H };
      await Promise.all([
        st.moveCam(back, T_BACK + 40),
        flipCard(card, P.cardEnd, end, T_BACK + 40, false),
      ]);
      card.remove();
      P.card = null;
    }
    st.scroller.classList.remove('locked');
    P.focus = null;
    P.view.classList.remove('focused');
    setBack(P.view, false);
    st.spots[P.prevFocusSpot]?.p.focus({ preventScroll: true });
  }

  // Handle → the door swings inward on its left hinge, the room shows through, the camera walks in.
  async function enterRoom() {
    const P = state.porch, st = P.st;
    glowOff(st);
    hideLabel(st);
    $('.porch-hint', P.view)?.classList.add('gone');
    pushState({ v: 'room' }, '/room' + location.search);
    const room = state.preRoom || prebuildRoom();
    state.preRoom = null;
    if (reduced()) {
      room.view.classList.remove('standby');
      P.view.remove();
      afterEnter(room);
      return;
    }
    glowOn(st, PORCH.spots[0].d);
    st.glow.classList.add('press');
    setTimeout(() => { glowOff(st); st.glow.classList.remove('press'); }, 180);
    const d = PORCH.door;
    const leaf = $('.door-leaf', st.root);
    play($('.nameplate-text', st.root), [{ opacity: 1 }, { opacity: 0 }], { duration: 140 });
    const vw = window.innerWidth, vh = window.innerHeight;
    const z = Math.max(vw / (d.w * st.s), vh / (d.h * st.s)) * 1.25;
    const sl = st.scroller.scrollLeft;
    const cx = (d.x + d.w * 0.52) * st.s * z, cy = (d.y + d.h * 0.58) * st.s * z;
    const camIn = { t: { x: sl + vw / 2 - cx, y: -st.offY + vh / 2 - cy }, z };
    // the room waits underneath, slightly pushed in, and settles as the porch fades away
    room.st.setCam({ t: { x: -vw * 0.04, y: -vh * 0.04 }, z: 1.08 });
    room.view.classList.remove('standby');
    room.view.style.opacity = '0';
    room.view.style.zIndex = '3';
    await Promise.all([
      play(leaf, [{ transform: 'perspective(900px) rotateY(0deg)' }, { transform: 'perspective(900px) rotateY(80deg)' }], { duration: 400, easing: 'cubic-bezier(.3,.1,.3,1)' }),
      (async () => { await wait(110); await st.moveCam(camIn, 470, EASE_IN); })(),
      (async () => {
        await wait(400);
        await Promise.all([
          play(room.view, [{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: 'linear' }),
          room.st.moveCam({ t: { x: 0, y: 0 }, z: 1 }, 320, EASE),
        ]);
      })(),
    ]);
    room.view.style.opacity = '';
    room.view.style.zIndex = '';
    P.view.remove();
    afterEnter(room);
  }
  function afterEnter(room) {
    state.porch = null;
    state.view = 'room';
    state.room = room;
    room.st.setCam({ t: { x: 0, y: 0 }, z: 1 });
    room.hint.classList.remove('gone');
    const firstZone = $('.spot.zone.active', room.st.svg);
    if (firstZone) firstZone.focus({ preventScroll: true });
  }

  /* ------------------------------------------------------------ */
  /* Room                                                          */
  /* ------------------------------------------------------------ */
  function prebuildRoom() {
    if (state.preRoom || state.view !== 'porch') return state.preRoom;
    const room = buildRoomView();
    room.view.classList.add('standby');
    app.prepend(room.view);
    room.st.layout();
    centerScroll(room.st, 760);
    state.preRoom = room;
    return room;
  }
  function renderRoom(zone) {
    document.title = siteName();
    app.innerHTML = '';
    state.porch = null;
    state.cat = null;
    state.item = null;
    state.preRoom = null;
    const room = buildRoomView();
    app.append(room.view);
    room.st.layout();
    centerScroll(room.st, 760);
    state.view = 'room';
    state.room = room;
    room.hint.classList.remove('gone');
    if (zone) applyZone(zone, false);
  }
  // A thing is shown (title, glow, bubble) when it has a place on the site: a category or a link.
  function thingActive(t) {
    if (t.link || t.music) return true;
    return !!t.cat;
  }
  // ...and it has something to open when its category has public work, its link is set, or a song is ready.
  function thingReady(t) {
    if (t.link) return !!site()[t.link];
    if (t.music) return !!site().featuredTrack || catActive(t.cat);
    return !!t.cat && catActive(t.cat);
  }
  function zoneActive(z) {
    return ROOM.things.some((t) => t.zone === z && thingActive(t));
  }
  function thingName(t) {
    if (t.link) return t.name;
    if (t.music && !catActive(t.cat)) return t.cat && !site().featuredTrack ? cats()[t.cat].name : 'Turntable';
    return cats()[t.cat].name;
  }
  function buildRoomView() {
    const r = ROOM.record, P = ROOM.props;
    const inside = `
      <div class="record" style="left:${r.x}px;top:${r.y}px;width:${r.w}px;height:${r.h}px"><div class="record-squash" style="width:${r.w}px;height:${r.w}px;transform:scaleY(${r.h / r.w})"><img src="/img/record.png" alt="" class="record-disc"></div></div>
      <div class="cutout tonearm" style="clip-path:path('${ROOM.tonearm}')"></div>`;
    const over = `
      <img class="prop-plate" data-plate="cup" src="/img/cup-clean.png" alt="" style="left:${P.cup.plate[0]}px;top:${P.cup.plate[1]}px" hidden>
      <img class="prop-plate" data-plate="plant" src="/img/plant-clean.png" alt="" style="left:${P.plant.plate[0]}px;top:${P.plant.plate[1]}px" hidden>
      <img class="prop-layer" data-prop="cup" src="/img/cup-sprite.png" alt="" style="left:${P.cup.plate[0]}px;top:${P.cup.plate[1]}px;transform-origin:${P.cup.origin[0] - P.cup.plate[0]}px ${P.cup.origin[1] - P.cup.plate[1]}px" hidden>
      <img class="prop-layer" data-prop="plant" src="/img/plant-sprite.png" alt="" style="left:${P.plant.plate[0]}px;top:${P.plant.plate[1]}px;transform-origin:${P.plant.origin[0] - P.plant.plate[0]}px ${P.plant.origin[1] - P.plant.plate[1]}px" hidden>
      <img class="candle-off" src="/img/candle-off.png" alt="" style="left:636px;top:318px;width:26px;height:26px" hidden>
      <span class="smoke" style="left:649px;top:326px" hidden></span>
      <img class="flame" src="/img/flame.png" alt="" style="left:643px;top:321px;width:12px;height:19px" hidden>
      <div class="bird-sky" style="clip-path:circle(140px at 1092px 305px)"><img class="bird" src="/img/bird.png" alt="" hidden></div>`;
    const st = buildStage(ROOM, inside, over);
    const view = el(`<div class="view room-view">${topbar('<button class="btn small" type="button" data-map>Room map</button>')}
        <p class="room-hint gone"><span class="hint-mouse">Click a corner of the room to look closer</span><span class="hint-touch">Swipe to look around, tap a corner to look closer</span></p>
      </div>`);
    view.prepend(st.root);
    const room = { st, view, zone: null, hint: $('.room-hint', view), tags: [], pop: null };
    // corners of the room (whole-room view)
    Object.entries(ROOM.zones).forEach(([key, z]) => {
      addSpot(st, { id: 'zone-' + key, d: z.d }, zoneActive(key), {
        cls: 'zone',
        aria: `${z.name} — look closer`,
        enter: () => {
          if (state.busy || room.zone) return;
          const list = ROOM.things.filter((t) => t.zone === key && thingActive(t));
          glowOn(st, list.map((t) => t.d).join(' '));
          showLabel(st, z.box, `<b>${esc(z.name)}</b><span>${list.map(thingName).map(esc).join(' · ')}</span>`, 'above', 'zone-' + key);
        },
        leave: () => { glowOff(st); hideLabel(st, 'zone-' + key); },
        act: () => goZone(key),
      });
    });
    // things (inside a corner)
    ROOM.things.forEach((t) => {
      t.zoneAttr = t.zone;
      addSpot(st, t, thingActive(t), {
        cls: 'thing',
        role: t.link ? 'link' : 'button',
        aria: t.link ? `${t.name} (opens in a new tab)` : thingName(t),
        enter: (how) => thingEnter(room, t, how),
        leave: (how, e) => thingLeave(room, t, how, e),
        act: (how) => thingAct(room, t, how),
      });
    });
    // small props: react in place, never move the camera
    Object.entries(P).forEach(([id, pr]) => {
      addSpot(st, { id: 'prop-' + id, d: pr.d }, true, {
        cls: 'prop',
        aria: pr.name,
        enter: () => { if (!state.busy) { closePop(room); glowOn(st, pr.d); } },
        leave: () => glowOff(st),
        act: () => propReact(room, id),
      });
    });
    $('[data-map]', view).addEventListener('click', () => openMap(room));
    st.root.addEventListener('click', (e) => {
      if (!e.target.closest('.bubble')) closePop(room);
    });
    st.scroller.addEventListener('scroll', () => hideLabel(st), { passive: true });
    syncPlayer();
    return room;
  }

  function goZone(key) {
    const room = state.room;
    if (!room || state.busy || room.zone === key) return;
    run(async () => {
      pushState({ v: 'room', zone: key }, '/room' + location.search);
      await setZone(key);
    });
  }
  function zoneCam(st, key) {
    const z = ROOM.zones[key];
    const vw = window.innerWidth, vh = window.innerHeight - 64;
    const box = vw < 760 && z.narrowBox ? z.narrowBox : z.box;
    const zoom = clamp(Math.min(vw / (box.width * st.s), vh / (box.height * st.s)) * 0.96, 1, 2.3);
    const cam = st.cameraFor(box, zoom);
    cam.t.y = Math.min(-st.offY, Math.max(-st.offY + window.innerHeight - ROOM.h * st.s * zoom, cam.t.y + 22));
    return cam;
  }
  async function setZone(key) {
    const room = state.room, st = room.st;
    closePop(room);
    hideLabel(st);
    glowOff(st);
    clearTags(room);
    room.hint.classList.add('gone');
    if (key) {
      st.scroller.classList.add('locked');
      await st.moveCam(zoneCam(st, key), T_ZOOM);
      applyZone(key, true);
      holdHoverUntilMove(room);
    } else {
      const was = room.zone;
      await st.moveCam({ t: { x: 0, y: 0 }, z: 1 }, T_BACK);
      st.scroller.classList.remove('locked');
      room.zone = null;
      st.root.classList.remove('in-zone');
      delete st.root.dataset.zone;
      setBack(room.view, false);
      room.hint.classList.remove('gone');
      st.spots['zone-' + was]?.p.focus({ preventScroll: true });
    }
  }
  function applyZone(key, animated) {
    const room = state.room, st = room.st;
    room.zone = key;
    if (!animated) {
      st.scroller.classList.add('locked');
      st.setCam(zoneCam(st, key));
      room.hint.classList.add('gone');
    }
    st.root.classList.add('in-zone');
    st.root.dataset.zone = key;
    setBack(room.view, true);
    showTags(room, true);
  }
  // After a zoom the cursor hasn't moved but the picture has: wait for a real move before hover pop-ups.
  function holdHoverUntilMove(room) {
    room.holdHover = true;
    const sx = [];
    const onMove = (e) => {
      sx.push(e);
      if (sx.length < 2) return; // the first event can be synthetic
      room.holdHover = false;
      room.st.root.removeEventListener('mousemove', onMove);
      const hit = document.elementFromPoint(e.clientX, e.clientY);
      const t = hit && hit.classList && hit.classList.contains('thing') ? thing(hit.dataset.id) : null;
      if (t && thingActive(t)) thingEnter(room, t, 'hover');
    };
    room.st.root.addEventListener('mousemove', onMove);
  }
  // Category titles next to each active thing in the corner.
  function showTags(room, focusFirst) {
    clearTags(room);
    const st = room.st;
    ROOM.things.filter((t) => t.zone === room.zone && thingActive(t) && t.tag).forEach((t) => {
      const [x, y, dir] = t.tag;
      const p = st.toScreen({ x, y, width: 0, height: 0 });
      const tag = el(`<span class="tag ${dir}${thingReady(t) ? '' : ' soon'}" style="left:${p.left}px;top:${p.top}px">${esc(thingName(t))}</span>`);
      st.hud.append(tag);
      room.tags.push({ t, tag });
    });
    if (focusFirst) {
      const first = ROOM.things.find((t) => t.zone === room.zone && thingActive(t));
      if (first) st.spots[first.id].p.focus({ preventScroll: true });
    }
  }
  function clearTags(room) {
    room.tags.forEach(({ tag }) => tag.remove());
    room.tags = [];
  }

  // Hover / focus on a thing: glow + one bubble (title, button, sub-categories with public content).
  const popOf = (room) => (room.st.bubble && room.st.bubble.node.classList.contains('pop') ? room.st.bubble.node : null);
  function thingEnter(room, t, how) {
    if (state.busy || !room.zone || state.cat) return;
    if (how === 'hover' && room.holdHover) return; // the camera moved under a still cursor
    const st = room.st;
    if (how === 'hover' && touchFirst()) return;
    // focus from a mouse click or from code shouldn't pop it open; keyboard focus should
    if (how === 'focus' && !st.spots[t.id].p.matches(':focus-visible')) return;
    if (t.link && thingReady(t)) {
      closePop(room);
      glowOn(st, t.d);
      showLabel(st, bboxOf(st, t.id), `<b>${esc(t.name)}</b><span>Opens in a new tab ↗</span>`, 'below', t.id);
      room.tags.forEach(({ t: tt, tag }) => tag.classList.toggle('hide', tt.id === t.id)); // the bubble takes the title's place
      return;
    }
    openPop(room, t);
  }
  // Leaving a thing closes its bubble at once, unless the cursor went straight into that bubble.
  function thingLeave(room, t, how, e) {
    const st = room.st;
    if (how === 'focus') return; // keyboard: the bubble stays while focus is on it or its buttons
    const b = st.bubble;
    if (!b || b.owner !== t.id) return;
    if (e && e.relatedTarget && b.node.contains(e.relatedTarget)) return;
    closePop(room);
  }
  // Clicking (or tapping) a thing does the same as its bubble's button.
  function thingAct(room, t) {
    if (!room.zone) { goZone(t.zone); return; }
    if (!thingReady(t)) { openPop(room, t); return; } // nothing here yet: the bubble says so
    if (t.link) { window.open(site()[t.link], '_blank', 'noopener'); return; }
    if (catActive(t.cat)) { openCatFromRoom(t.cat); return; }
    openPop(room, t); // turntable with a song but no compositions page yet: the play button lives in the bubble
    $('button', popOf(room))?.focus();
  }
  // which side of each thing its bubble prefers; if none fits, the bubble slides onto its own thing rather than a neighbour
  const POP_SIDE = { board: ['above'], crt: ['below'], shirt: 'right', chest: ['right', 'below'], bookshelf: ['below'], cork: ['above', 'right'], bed: ['below', 'above'], diary: ['above', 'below'], turntable: ['below'] };
  function openPop(room, t) {
    const st = room.st;
    if (popOf(room) && st.bubble.owner === t.id) return;
    closePop(room);
    glowOn(st, t.d);
    let html;
    if (!thingReady(t)) {
      html = `<b class="pop-title">${esc(thingName(t))}</b><span class="pop-soon">Coming soon</span>`;
    } else if (t.music) {
      const tr = site().featuredTrack;
      html = `
        ${catActive(t.cat) ? `<b class="pop-title">${esc(cats()[t.cat].name)}</b><button class="btn small primary" type="button" data-open="${esc(t.cat)}">${esc(cats()[t.cat].button)} →</button>` : '<b class="pop-title">Turntable</b>'}
        ${tr ? `<button class="pop-play" type="button" data-play="${esc(tr.id)}" aria-pressed="false"><span class="pp-icon">▶</span> <span class="pp-title">${esc(tr.title)}</span></button>` : ''}`;
    } else {
      const c = cats()[t.cat];
      const subs = subsWithItems(t.cat);
      html = `
        <b class="pop-title">${esc(c.name)}</b>
        <button class="btn small primary" type="button" data-open="${t.cat}">${esc(c.button)} →</button>
        ${subs.length ? `<ul class="pop-subs">${subs.map((s) => `<li>${esc(s.name)}</li>`).join('')}</ul>` : ''}`;
    }
    const pop = el(`<div class="bubble pop anim" data-thing="${t.id}" role="group" aria-label="${esc(thingName(t))}" ${t.popWidth ? `style="max-width:${t.popWidth}px"` : ''}>${html}</div>`);
    setBubble(st, pop, t.popBox || bboxOf(st, t.id), POP_SIDE[t.id] || 'below', t.id, t.popAlign);
    room.tags.forEach(({ t: tt, tag }) => tag.classList.toggle('hide', tt.id === t.id));
    pop.addEventListener('mouseleave', (e) => {
      if (e.relatedTarget === st.spots[t.id].p) return; // back onto its own thing
      if (st.bubble && st.bubble.node === pop) closePop(room);
    });
    pop.addEventListener('focusout', () => setTimeout(() => {
      if (popOf(room) === pop && !pop.contains(document.activeElement) && document.activeElement !== st.spots[t.id].p) closePop(room);
    }, 0));
    pop.addEventListener('click', (e) => {
      e.stopPropagation();
      const o = e.target.closest('[data-open]');
      if (o) { openCatFromRoom(o.dataset.open); return; }
      const pl = e.target.closest('[data-play]');
      if (pl) togglePlay(site().featuredTrack);
    });
    syncPlayer();
  }
  function closePop(room) {
    if (!room) return;
    closeBubble(room.st);
    room.tags.forEach(({ tag }) => tag.classList.remove('hide'));
    glowOff(room.st);
  }

  // Small props: a short reaction in place.
  function propReact(room, id) {
    if (state.busy) return;
    const s = room.st.sceneEl;
    if (id === 'cup' || id === 'plant') {
      const layer = $(`[data-prop="${id}"]`, s);
      if (layer.dataset.busy) return;
      const plate = $(`[data-plate="${id}"]`, s);
      layer.dataset.busy = '1';
      plate.hidden = false;
      layer.hidden = false;
      // cup: tips on one bottom corner and settles; plant: sways from the pot's base and settles
      const frames = id === 'cup'
        ? [{ transform: 'rotate(0deg)' }, { transform: 'rotate(4deg)', offset: 0.3, easing: 'ease-in' }, { transform: 'rotate(-1deg)', offset: 0.65 }, { transform: 'rotate(0deg)' }]
        : [{ transform: 'rotate(0deg)' }, { transform: 'rotate(-3deg)', offset: 0.2 }, { transform: 'rotate(2.2deg)', offset: 0.48 }, { transform: 'rotate(-1deg)', offset: 0.74 }, { transform: 'rotate(0deg)' }];
      const a = layer.animate(frames, { duration: reduced() ? 1 : id === 'cup' ? 420 : 860, easing: 'ease-out' });
      const run = String(Date.now());
      layer.dataset.run = run;
      const end = () => { if (layer.dataset.run !== run) return; layer.hidden = true; plate.hidden = true; delete layer.dataset.busy; delete layer.dataset.run; };
      a.finished.then(end, end);
      setTimeout(end, 1300); // never leave the plate showing if a hidden tab pauses the animation
    } else if (id === 'candle') {
      const off = $('.candle-off', s), smoke = $('.smoke', s), flame = $('.flame', s);
      if (off.dataset.busy) return;
      off.dataset.busy = '1';
      off.hidden = false;
      smoke.hidden = false;
      smoke.animate([{ opacity: 0.85, transform: 'translate(-50%,0) scale(.6)' }, { opacity: 0, transform: 'translate(-50%,-24px) scale(1.7)' }], { duration: reduced() ? 1 : 700, easing: 'ease-out' })
        .finished.then(() => { smoke.hidden = true; });
      setTimeout(() => {
        flame.hidden = false;
        flame.animate([{ opacity: 0, transform: 'scale(.2)' }, { opacity: 1, transform: 'scale(1.15)', offset: 0.5 }, { opacity: 1, transform: 'scale(.95)', offset: 0.75 }, { opacity: 1, transform: 'scale(1)' }], { duration: reduced() ? 1 : 420, easing: 'ease-out' })
          .finished.then(() => { off.hidden = true; flame.hidden = true; delete off.dataset.busy; });
      }, reduced() ? 400 : 820);
    } else if (id === 'window') {
      const bird = $('.bird', s);
      if (!bird.hidden) return;
      bird.hidden = false;
      bird.animate([
        { transform: 'translate(930px, 352px) rotate(-6deg)' },
        { transform: 'translate(1030px, 300px) rotate(4deg)', offset: 0.35 },
        { transform: 'translate(1130px, 318px) rotate(-4deg)', offset: 0.65 },
        { transform: 'translate(1250px, 262px) rotate(6deg)' },
      ], { duration: reduced() ? 900 : 1500, easing: 'ease-in-out' }).finished.catch(() => {}).then(() => { bird.hidden = true; });
    }
  }

  /* ------------------------------------------------------------ */
  /* Room map                                                      */
  /* ------------------------------------------------------------ */
  function openMap(room) {
    if (state.busy || $('.map')) return;
    const groups = Object.entries(ROOM.zones).map(([key, z]) => {
      const rows = ROOM.things.filter((t) => t.zone === key && thingActive(t)).map((t) => {
        if (!thingReady(t)) return `<li><button class="map-row soon" type="button" data-zone-go="${key}" data-thing="${t.id}">${esc(thingName(t))} <span class="soon-tag">soon</span></button></li>`;
        if (t.link) return `<li><a class="map-row" href="${esc(site()[t.link])}" target="_blank" rel="noopener">${esc(t.name)} <span aria-hidden="true">↗</span></a></li>`;
        if (t.music && !catActive(t.cat)) return `<li><button class="map-row" type="button" data-zone-go="${key}" data-thing="${t.id}">Turntable</button></li>`;
        return `<li><button class="map-row" type="button" data-cat="${t.cat}">${esc(cats()[t.cat].name)}</button></li>`;
      });
      return rows.length ? `<section><h3><button type="button" class="map-zone" data-zone-go="${key}">${esc(z.name)}</button></h3><ul>${rows.join('')}</ul></section>` : '';
    }).join('');
    const map = el(`<div class="map" role="dialog" aria-modal="true" aria-label="Room map"><div class="map-card"><div class="map-head"><b>Room map</b><button class="btn small" type="button" data-close>Close</button></div>${groups || '<p>Nothing to see here yet.</p>'}</div></div>`);
    room.view.append(map);
    $('.map-zone, .map-row', map)?.focus();
    const close = () => map.remove();
    map.addEventListener('click', (e) => {
      if (e.target === map || e.target.closest('[data-close]')) return close();
      const c = e.target.closest('[data-cat]');
      if (c) { close(); return openCatFromRoom(c.dataset.cat); }
      const z = e.target.closest('[data-zone-go]');
      if (z) {
        close();
        const thingId = z.dataset.thing;
        run(async () => {
          if (room.zone !== z.dataset.zoneGo) { pushState({ v: 'room', zone: z.dataset.zoneGo }, '/room' + location.search); await setZone(z.dataset.zoneGo); }
          if (thingId) openPop(room, thing(thingId));
        });
      }
    });
  }

  /* ------------------------------------------------------------ */
  /* Category screen                                               */
  /* ------------------------------------------------------------ */
  function openCatFromRoom(key) {
    const room = state.room;
    if (!room || state.busy || !catActive(key)) return;
    const t = thingOfCat(key);
    run(async () => {
      if (room.zone !== t.zone) { pushState({ v: 'room', zone: t.zone }, '/room' + location.search); await setZone(t.zone); }
      pushState({ v: 'cat', key, zone: t.zone, filter: 'all', page: 0 }, '/room' + location.search);
      await openCat(key, { filter: 'all', page: 0 });
    });
  }
  async function openCat(key, opts = {}) {
    const room = state.room;
    closePop(room);
    hideLabel(room.st);
    clearTags(room);
    const t = thingOfCat(key);
    const from = room.st.toScreen(bboxOf(room.st, t.id));
    const c = buildCat(key, opts);
    state.cat = c;
    app.append(c.view);
    layoutCat(c);
    // narrow screens pan sideways: start where the items start
    c.scroller.scrollLeft = opts.scroll || Math.max(0, (Math.min(...LAYOUTS[kindOf(key)].slots.map((sl) => sl.x)) - 40) * c.s);
    document.title = `${cats()[key].name} · ${siteName()}`;
    const to = c.panel.getBoundingClientRect();
    await Promise.all([
      play(c.panel, [
        { transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${from.width / to.width}, ${from.height / to.height})`, opacity: 0.35 },
        { transform: 'none', opacity: 1 },
      ], { duration: 340, easing: EASE }),
      play(c.view, [{ backgroundColor: 'rgba(43,26,16,0)' }, { backgroundColor: 'rgba(43,26,16,.55)' }], { duration: 300 }),
    ]);
    $('[data-back]', c.view)?.focus({ preventScroll: true });
  }
  async function closeCat() {
    const c = state.cat, room = state.room;
    if (!c) return;
    const t = thingOfCat(c.key);
    const to = room.st.toScreen(bboxOf(room.st, t.id));
    const fr = c.panel.getBoundingClientRect();
    await Promise.all([
      play(c.panel, [
        { transform: 'none', opacity: 1 },
        { transform: `translate(${to.left - fr.left}px, ${to.top - fr.top}px) scale(${to.width / fr.width}, ${to.height / fr.height})`, opacity: 0 },
      ], { duration: 300, easing: EASE }),
      play(c.view, [{ backgroundColor: 'rgba(43,26,16,.55)' }, { backgroundColor: 'rgba(43,26,16,0)' }], { duration: 280 }),
    ]);
    c.view.remove();
    state.cat = null;
    document.title = siteName();
    if (room.zone) showTags(room, false);
    room.st.spots[t.id]?.p.focus({ preventScroll: true });
  }
  function buildCat(key, opts) {
    const kind = kindOf(key);
    const c = cats()[key], L = LAYOUTS[kind];
    const items = catItems(key);
    const per = L.slots.length;
    const subs = subsWithItems(key);
    const view = el(`
      <div class="cat-view" data-cat="${kind}">
        <div class="cat-panel" role="dialog" aria-label="${esc(c.name)}">
          <aside class="cat-side">
            <button class="btn back" type="button" data-back>← Back</button>
            <h1>${esc(c.name)}</h1>
            <nav class="filters" aria-label="Filter ${esc(c.name)}" ${subs.length ? '' : 'hidden'}>
              <button type="button" class="chip" data-filter="all">All</button>
              ${subs.map((s) => `<button type="button" class="chip" data-filter="${esc(s.id)}">${esc(s.name)}</button>`).join('')}
            </nav>
            <div class="pager" hidden>
              <button type="button" class="btn small" data-page="-1" aria-label="Previous">‹</button>
              <span class="pager-label"></span>
              <button type="button" class="btn small" data-page="1" aria-label="Next">›</button>
            </div>
          </aside>
          <div class="cat-stage">
            <div class="cat-scroller">
              <div class="cat-sizer">
                <div class="cat-scene cat-${kind} style-${L.style}" style="width:1586px;height:992px">
                  <img class="cat-bg" src="/img/tabs/${kind}.jpg" alt="" width="1586" height="992" decoding="async">
                  <div class="slots"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>`);
    const co = {
      key, view, panel: $('.cat-panel', view), stageEl: $('.cat-stage', view), scroller: $('.cat-scroller', view),
      sizer: $('.cat-sizer', view), sceneEl: $('.cat-scene', view), slotsEl: $('.slots', view),
      items, per, pages: Math.max(1, Math.ceil(items.length / per)), filter: opts.filter || 'all', page: opts.page || 0, s: 1, pagesWith: [0],
    };
    if (!co.items.some((i) => co.filter === 'all' || i.sub === co.filter)) co.filter = 'all';
    const bg = $('.cat-bg', view);
    bg.addEventListener('load', () => co.sceneEl.classList.add('loaded'));
    if (bg.complete) co.sceneEl.classList.add('loaded');
    renderSlots(co);
    applyFilter(co);
    $$('[data-filter]', view).forEach((b) => b.addEventListener('click', () => setFilter(co, b.dataset.filter)));
    $$('[data-page]', view).forEach((b) => b.addEventListener('click', () => turnPage(co, Number(b.dataset.page))));
    co.slotsEl.addEventListener('click', (e) => {
      const pl = e.target.closest('[data-play]');
      if (pl) { e.stopPropagation(); togglePlay(trackOf(items.find((i) => i.id === pl.dataset.play))); return; }
      const s = e.target.closest('[data-slug]');
      if (!s || state.busy) return;
      const it = items.find((i) => i.slug === s.dataset.slug);
      if (kindOf(key) === 'compositions' && !hasDetail(it)) { togglePlay(trackOf(it)); return; }
      run(async () => {
        replaceState({ ...state.cur, filter: co.filter, page: co.page, scroll: co.scroller.scrollLeft });
        pushState({ v: 'item', slug: it.slug, key, zone: state.cur.zone, filter: co.filter, page: co.page }, `/w/${it.slug}` + location.search);
        await openItem(it.slug, s);
      });
    });
    return co;
  }
  function layoutCat(c) {
    const r = c.stageEl.getBoundingClientRect();
    const narrow = window.innerWidth < 760;
    const s = narrow ? r.height / 992 : Math.min(r.width / 1586, r.height / 992);
    c.s = s;
    c.sceneEl.style.transform = `scale(${s})`;
    c.sizer.style.width = 1586 * s + 'px';
    c.sizer.style.height = 992 * s + 'px';
  }
  function trackOf(it) {
    return it && it.audio ? { id: it.id, title: it.title, src: it.audio } : null;
  }
  function hasDetail(it) {
    return !!(it.body || it.role || it.result || it.context || it.links.length || it.gallery.length);
  }
  function renderSlots(c) {
    const L = LAYOUTS[kindOf(c.key)];
    const start = c.page * c.per;
    const list = c.items.slice(start, start + c.per);
    const subName = (id) => (cats()[c.key].subs.find((s) => s.id === id) || {}).name || '';
    const pos = (sl) => `left:${sl.x}px;top:${sl.y}px;width:${sl.w}px;height:${sl.h}px;${sl.r ? `--r:${sl.r}deg;` : ''}`;
    const img = (it, cls = 'thumb') => (it.thumb
      ? `<img class="${cls}" src="${esc(it.thumb)}" alt="" loading="lazy" decoding="async">`
      : `<span class="${cls} ph" aria-hidden="true">${esc((it.title || '?').trim().charAt(0).toUpperCase())}</span>`);
    const one = (it) => (it.summary ? `<span class="one">${esc(it.summary)}</span>` : '');
    let html = '';
    list.forEach((it, i) => {
      const sl = L.slots[i];
      const idx = start + i;
      const attrs = `data-i="${idx}" data-sub="${esc(it.sub)}" style="${pos(sl)}"`;
      const btn = (inner, extra = '') => `<button type="button" class="slot slot-${L.style}" data-slug="${esc(it.slug)}" ${attrs} ${extra} aria-label="${esc(it.title)}${it.summary ? ' — ' + esc(it.summary) : ''}">${inner}</button>`;
      switch (L.style) {
        case 'pinned':
        case 'polaroid':
          html += btn(`<span class="pin"></span>${img(it)}<b>${esc(it.title)}</b>${one(it)}`);
          break;
        case 'icon':
          html += btn(`${img(it, 'icon-img')}<b>${esc(it.title)}</b>`);
          break;
        case 'pocket':
          html += btn(`<span class="card-top">${it.thumb ? img(it) : ''}<span class="txt"><b>${esc(it.title)}</b>${it.context ? `<span class="where">${esc(it.context)}</span>` : ''}${one(it)}</span></span>`, `data-row="${i < 2 ? 1 : 2}"`);
          html += `<div class="pocket-front" data-for="${idx}" data-row="${i < 2 ? 1 : 2}" style="clip-path:path('${sl.pocket}')" aria-hidden="true"></div>`;
          break;
        case 'memo':
          html += btn(`${it.thumb ? img(it) : ''}<span class="txt"><b>${esc(it.title)}</b>${one(it)}</span>`);
          break;
        case 'file':
          html += btn(`<span class="spine">${esc(subName(it.sub) || cats()[c.key].name)}</span>${it.thumb ? img(it) : ''}<b>${esc(it.title)}</b>`);
          break;
        case 'object':
          html += btn(`${img(it)}<b>${esc(it.title)}</b>`, `data-kind="${esc(it.sub || 'crafts')}"`);
          break;
        case 'line':
          html += btn(`<b>${esc(it.title)}</b>`);
          break;
        case 'jacket':
          html += `<div class="slot slot-jacket" ${attrs} role="group" aria-label="${esc(it.title)}">
              <button type="button" class="jacket" data-slug="${esc(it.slug)}" aria-label="${esc(it.title)}${hasDetail(it) ? ' — details' : ''}">${img(it)}</button>
              ${it.audio ? `<button type="button" class="play" data-play="${esc(it.id)}" aria-pressed="false" aria-label="Play ${esc(it.title)}">▶</button>` : ''}
              <span class="jtag"><b>${esc(it.title)}</b>${one(it)}</span>
            </div>`;
          break;
      }
    });
    c.slotsEl.innerHTML = html;
    syncPlayer();
  }
  const matches = (c, it) => c.filter === 'all' || it.sub === c.filter;
  // A filter keeps every item in its own place; the others leave their spot empty.
  function applyFilter(c) {
    $$('[data-filter]', c.view).forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.filter === c.filter)));
    const pagesWith = [...Array(c.pages).keys()].filter((p) => c.items.slice(p * c.per, (p + 1) * c.per).some((it) => matches(c, it)));
    c.pagesWith = pagesWith.length ? pagesWith : [0];
    if (!c.pagesWith.includes(c.page)) { c.page = c.pagesWith[0]; renderSlots(c); }
    $$('.slot', c.slotsEl).forEach((s) => {
      const on = matches(c, c.items[Number(s.dataset.i)]);
      s.classList.toggle('off', !on);
      s.toggleAttribute('inert', !on);
    });
    const pager = $('.pager', c.view);
    pager.hidden = c.pagesWith.length < 2;
    const idx = c.pagesWith.indexOf(c.page);
    $('.pager-label', c.view).textContent = `${PAGE_WORD[kindOf(c.key)] || 'Page'} ${idx + 1} of ${c.pagesWith.length}`;
    $('[data-page="-1"]', c.view).disabled = idx <= 0;
    $('[data-page="1"]', c.view).disabled = idx >= c.pagesWith.length - 1;
  }
  function setFilter(c, f) {
    if (state.busy || c.filter === f) return;
    c.filter = f;
    applyFilter(c);
    replaceState({ ...state.cur, filter: f, page: c.page });
  }
  function turnPage(c, dir) {
    const idx = c.pagesWith.indexOf(c.page) + dir;
    if (idx < 0 || idx >= c.pagesWith.length) return;
    run(async () => {
      await play(c.slotsEl, [{ opacity: 1 }, { opacity: 0 }], { duration: 120 });
      c.page = c.pagesWith[idx];
      renderSlots(c);
      applyFilter(c);
      await play(c.slotsEl, [{ opacity: 0 }, { opacity: 1 }], { duration: 160 });
      replaceState({ ...state.cur, filter: c.filter, page: c.page });
    });
  }

  /* ------------------------------------------------------------ */
  /* Item detail                                                   */
  /* ------------------------------------------------------------ */
  function formatBody(text) {
    return String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
      .map((p) => `<p>${esc(p).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>').replace(/\n/g, '<br>')}</p>`).join('');
  }
  function detailHTML(it, catKey) {
    const isWork = catKey === 'work';
    const built = catKey === 'competitions' || catKey === 'coding';
    const roles = String(it.role || '').split(',').map((r) => r.trim()).filter(Boolean);
    const links = it.links.map((l, i) => `<a class="btn ${i === 0 ? 'primary' : ''}" href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)} ↗</a>`).join('');
    return `
      ${it.cover ? `<figure class="d-cover"><img src="${esc(it.cover.url)}" alt="${esc(it.cover.alt)}" decoding="async"></figure>` : ''}
      <div class="d-body">
        ${it.context ? `<p class="d-context">${isWork ? '<span class="d-k">Where</span> ' : ''}${esc(it.context)}</p>` : ''}
        <h2 class="d-title">${esc(it.title)}</h2>
        ${it.summary ? `<p class="d-summary">${esc(it.summary)}</p>` : ''}
        ${catKey === 'compositions' && it.audio ? `<p><button class="btn primary" type="button" data-play="${esc(it.id)}" aria-pressed="false">▶ Play</button></p>` : ''}
        ${links ? `<div class="d-links">${links}</div>` : ''}
        ${roles.length ? `<section class="d-sec"><h3>${isWork ? 'What I did' : 'My role'}</h3><ul class="d-roles">${roles.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></section>` : ''}
        ${it.body ? `<section class="d-sec">${built ? '<h3>What I built</h3>' : ''}${formatBody(it.body)}</section>` : ''}
        ${it.result ? `<section class="d-sec"><h3>Result</h3><p>${esc(it.result)}</p></section>` : ''}
        ${it.gallery.length ? `<section class="d-sec d-gallery">${it.gallery.map((g) => `<img src="${esc(g.url)}" alt="" loading="lazy" decoding="async">`).join('')}</section>` : ''}
        <p class="d-share"><button class="btn small" type="button" data-copy-link="${esc(it.slug)}">Copy link</button></p>
      </div>`;
  }
  function bindDetail(node) {
    node.addEventListener('click', async (e) => {
      const cp = e.target.closest('[data-copy-link]');
      if (cp) {
        const ok = await copyText(`${location.origin}/w/${cp.dataset.copyLink}`);
        cp.textContent = ok ? 'Copied' : 'Copy failed';
        setTimeout(() => (cp.textContent = 'Copy link'), 1400);
      }
      const pl = e.target.closest('[data-play]');
      if (pl) togglePlay(trackOf(findItem(pl.dataset.play)));
    });
  }
  function findItem(id) {
    for (const list of Object.values(state.site.items)) {
      const f = list.find((i) => i.id === id);
      if (f) return f;
    }
    return state.shareItem && state.shareItem.id === id ? state.shareItem : null;
  }
  async function openItem(slug, fromEl) {
    const c = state.cat;
    const it = c.items.find((i) => i.slug === slug);
    if (!it) return;
    const fromNode = fromEl || $(`[data-slug="${CSS.escape(slug)}"]`, c.slotsEl);
    const wrap = el(`<div class="sheet-wrap"><button class="btn back sheet-back" type="button" data-back>← Back</button><article class="sheet" tabindex="-1" aria-label="${esc(it.title)}">${detailHTML(it, kindOf(c.key))}</article></div>`);
    bindDetail(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap) goBack(); });
    c.view.append(wrap);
    state.item = { wrap, slug };
    document.title = `${it.title} · ${siteName()}`;
    syncPlayer();
    const sheet = $('.sheet', wrap);
    const to = sheet.getBoundingClientRect();
    const fr = fromNode && fromNode.getBoundingClientRect();
    await Promise.all([
      fr ? play(sheet, [
        { transform: `translate(${fr.left - to.left}px, ${fr.top - to.top}px) scale(${fr.width / to.width}, ${fr.height / to.height})`, opacity: 0.3 },
        { transform: 'none', opacity: 1 },
      ], { duration: 320, easing: EASE }) : Promise.resolve(),
      play(wrap, [{ opacity: 0 }, { opacity: 1 }], { duration: 200 }),
    ]);
    sheet.focus({ preventScroll: true });
  }
  async function closeItem() {
    const c = state.cat, I = state.item;
    if (!I) return;
    const sheet = $('.sheet', I.wrap);
    const fromNode = $(`[data-slug="${CSS.escape(I.slug)}"]`, c.slotsEl);
    const fr = sheet.getBoundingClientRect();
    const to = fromNode ? fromNode.getBoundingClientRect() : null;
    await Promise.all([
      to ? play(sheet, [{ transform: 'none', opacity: 1 }, { transform: `translate(${to.left - fr.left}px, ${to.top - fr.top}px) scale(${to.width / fr.width}, ${to.height / fr.height})`, opacity: 0 }], { duration: 280, easing: EASE }) : Promise.resolve(),
      play(I.wrap, [{ opacity: 1 }, { opacity: 0 }], { duration: 260 }),
    ]);
    I.wrap.remove();
    state.item = null;
    document.title = `${cats()[c.key].name} · ${siteName()}`;
    if (fromNode) fromNode.focus({ preventScroll: true });
  }

  // /w/<slug> opened directly: the item first, the room one click away.
  // /preview/<notion page id>: the same page for the signed-in admin, showing the unpublished Notion version.
  async function renderShare(slug, previewId) {
    state.view = 'share';
    state.room = null;
    state.cat = null;
    state.item = null;
    state.porch = null;
    state.preRoom = null;
    let data;
    try {
      data = previewId && !STATIC
        ? await getJSON(`/api/admin/notion/preview/${encodeURIComponent(previewId)}`)
        : await getJSON(API.item(slug));
    } catch (e) {
      document.title = siteName();
      const msg = previewId
        ? (e.status === 401 ? '<h2 class="d-title">관리자 로그인이 필요해요</h2><p>미리보기는 관리자에게만 보여요. <a href="/admin">관리자 화면</a>에서 로그인한 뒤 다시 열어 주세요.</p>' : `<h2 class="d-title">미리보기를 불러오지 못했어요</h2><p>${esc((e.body && e.body.error) || '노션 연결을 확인해 주세요.')}</p>`)
        : '<h2 class="d-title">This page isn’t here</h2><p>It may have been moved or made private.</p>';
      app.innerHTML = `<div class="share-view">${topbar('<a class="btn primary" href="/room">Explore the room →</a>')}<div class="sheet-page"><article class="sheet"><div class="d-body">${msg}</div></article></div></div>`;
      return;
    }
    const it = data.item;
    state.shareItem = it;
    document.title = `${previewId ? '[미리보기] ' : ''}${it.title} · ${siteName()}`;
    app.innerHTML = '';
    const kind = previewId ? data.kind : data.categoryKind || kindOf(it.category);
    const view = el(`
      <div class="share-view">
        ${topbar('<a class="btn primary" href="/room" data-explore>Explore the room →</a>')}
        <div class="sheet-page">${previewId ? previewBanner(data) : ''}<p class="share-cat">${esc(data.categoryName)}</p><article class="sheet" tabindex="-1">${detailHTML(it, kind)}</article></div>
      </div>`);
    bindDetail(view);
    app.append(view);
    $('[data-explore]', view).addEventListener('click', (e) => {
      e.preventDefault();
      run(async () => {
        await play(view, [{ opacity: 1 }, { opacity: 0 }], { duration: 220 });
        pushState({ v: 'room' }, '/room' + location.search);
        renderRoom(null);
        await play(state.room.view, [{ opacity: 0 }, { opacity: 1 }], { duration: 260 });
      });
    });
    syncPlayer();
  }

  function previewBanner(d) {
    const cur = d.current;
    const now = !cur ? '사이트에 아직 공개본이 없어요.'
      : cur.adopt ? `발행하면 기존 공개 작품 '${esc(cur.title)}'(/w/${esc(cur.slug)})을 이 버전으로 바꿔요.`
        : cur.isPublic ? `지금 사이트에는 v${cur.version} 공개본이 보이고 있어요. 이 화면은 그 공개본이 아니에요.` : `v${cur.version}까지 발행됐다가 지금은 비공개예요.`;
    const list = (arr, cls) => (arr.length ? `<ul class="pv-${cls}">${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
    return `<aside class="preview-banner" role="note">
      <b>비공개 미리보기 · 노션 상태 '${esc(d.status || '없음')}'</b>
      <p>${now} 주소: /w/${esc(d.item.slug || '(비어 있음)')}${d.notionUrl ? ` · <a href="${esc(d.notionUrl)}" target="_blank" rel="noopener">노션에서 열기 ↗</a>` : ''}</p>
      ${d.errors.length ? '<p><b>발행 전에 고칠 것</b></p>' : ''}${list(d.errors, 'err')}
      ${d.warnings.length ? '<p><b>참고</b></p>' : ''}${list(d.warnings, 'warn')}
    </aside>`;
  }

  /* ------------------------------------------------------------ */
  /* Music: only ever starts from a play button                    */
  /* ------------------------------------------------------------ */
  const player = { audio: null, track: null, playing: false };
  if (isDebug) window.__player = player; // for checking playback position while testing
  function togglePlay(track) {
    if (!track || !track.src) return;
    if (!player.audio) {
      player.audio = new Audio();
      player.audio.preload = 'none';
      player.audio.addEventListener('play', () => { player.playing = true; syncPlayer(); });
      player.audio.addEventListener('pause', () => { player.playing = false; syncPlayer(); });
      player.audio.addEventListener('ended', () => { player.playing = false; syncPlayer(); });
      player.audio.addEventListener('error', () => { if (player.track) { player.playing = false; syncPlayer(); toast('This track could not be played.'); } });
    }
    const a = player.audio;
    if (player.track && player.track.id === track.id) {
      if (a.paused) a.play().catch(() => {});
      else a.pause();
      return;
    }
    player.track = track;
    a.src = track.src; // the file is fetched only now
    a.play().catch(() => {});
    syncPlayer();
  }
  function syncPlayer() {
    const on = player.playing, tid = player.track && player.track.id;
    $$('.stage-room').forEach((r) => r.classList.toggle('playing', on));
    $$('[data-play]').forEach((b) => {
      const mine = b.dataset.play === tid;
      b.setAttribute('aria-pressed', String(mine && on));
      b.classList.toggle('is-playing', mine && on);
      const icon = $('.pp-icon', b);
      if (icon) icon.textContent = mine && on ? '❚❚' : '▶';
      else if (b.classList.contains('play')) b.textContent = mine && on ? '❚❚' : '▶';
      else if (b.classList.contains('btn')) b.textContent = mine && on ? '❚❚ Pause' : '▶ Play';
    });
    let pill = $('.now-playing');
    if (!player.track) { if (pill) pill.remove(); return; }
    if (!pill) {
      pill = el('<button class="now-playing" type="button"><span class="np-icon"></span><span class="np-title"></span></button>');
      pill.addEventListener('click', () => togglePlay(player.track));
      document.body.append(pill);
    }
    pill.classList.toggle('on', on);
    $('.np-icon', pill).textContent = on ? '❚❚' : '▶';
    $('.np-title', pill).textContent = player.track.title;
    pill.setAttribute('aria-label', `${on ? 'Pause' : 'Play'} ${player.track.title}`);
  }

  /* ------------------------------------------------------------ */
  /* Boot                                                          */
  /* ------------------------------------------------------------ */
  function relayout() {
    if (state.porch) {
      const P = state.porch;
      P.st.layout();
      if (P.focus) P.st.setCam(P.focus === 'mail'
        ? P.st.cameraFor({ x: PORCH.mailboxFocus.x, y: PORCH.mailboxFocus.y, width: PORCH.mailboxFocus.w, height: PORCH.mailboxFocus.h }, P.st.cam.z)
        : P.st.cam);
    }
    if (state.preRoom) state.preRoom.st.layout();
    if (state.room) {
      const room = state.room;
      room.st.layout();
      closePop(room);
      hideLabel(room.st);
      if (room.zone) { room.st.setCam(zoneCam(room.st, room.zone)); if (!state.cat) showTags(room, false); }
    }
    if (state.cat) layoutCat(state.cat);
  }
  async function boot() {
    history.scrollRestoration = 'manual';
    try {
      state.site = await getJSON(API.site);
    } catch {
      app.innerHTML = '<p class="loading">The treehouse is closed for a moment. Please try again soon.</p>';
      return;
    }
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if (!state.busy) relayout(); }, 120); });
    window.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const map = $('.map');
      if (map) { map.remove(); return; }
      if (state.room && state.room.st.bubble) { closePop(state.room); return; }
      const c = state.cur;
      if (c.focus || c.v === 'item' || c.v === 'cat' || (c.v === 'room' && c.zone)) goBack();
    });
    window.addEventListener('pageshow', (e) => { if (e.persisted && location.pathname === '/') location.reload(); });

    linkThings();
    const s = stateFromURL();
    if (s.v === 'share') {
      replaceState(s);
      await renderShare(s.slug);
    } else if (s.v === 'preview') {
      replaceState(s);
      await renderShare(null, s.id);
    } else if (s.v === 'room') {
      replaceState({ v: 'room' });
      renderRoom(null);
    } else {
      // "/" always starts on the porch, whatever was open before
      replaceState({ v: 'porch' }, '/' + location.search);
      renderPorch();
    }
  }
  boot();
})();
