// 뀡잉힝 관리자 화면
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const root = $('#admin');
  const MAX_UPLOAD = 28 * 1024 * 1024;

  const st = { data: null, tab: 'items', filter: '', currentId: null, dirty: false };
  const ko = (k) => st.data.categoriesKo[k] || k;
  const subsOf = (k) => (st.data.categories[k] || { subs: [] }).subs;
  const catOptions = (sel) => st.data.categoryKeys.map((k) => `<option value="${k}" ${sel === k ? 'selected' : ''}>${esc(ko(k))} · ${esc(st.data.categories[k].name)}</option>`).join('');
  const subOptions = (k, sel) => `<option value="">분류 없음</option>` + subsOf(k).map((x) => `<option value="${esc(x.id)}" ${sel === x.id ? 'selected' : ''}>${esc(x.ko || x.name)} · ${esc(x.name)}</option>`).join('');
  // 목록용 작은 썸네일을 브라우저에서 만든다 (긴 변 480px JPEG).
  function makeThumb(file) {
    return new Promise((resolve) => {
      if (file.type === 'image/gif') return resolve(null);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, 480 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/jpeg', 0.82).split(',')[1]);
      };
      img.onerror = () => resolve(null);
      img.src = URL.createObjectURL(file);
    });
  }

  async function api(method, url, body) {
    const r = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-KK-Admin': '1' },
      body: body ? JSON.stringify(body) : undefined,
      credentials: 'same-origin',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `요청이 실패했어요 (${r.status})`);
    return j;
  }
  let tt;
  function toast(m) {
    const t = $('.toast');
    t.textContent = m;
    t.classList.add('show');
    clearTimeout(tt);
    tt = setTimeout(() => t.classList.remove('show'), 2200);
  }
  function fileToBase64(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(String(r.result).split(',')[1] || '');
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  /* ---------- 로그인 ---------- */
  async function start() {
    const me = await api('GET', '/api/admin/me');
    if (me.loggedIn) return loadAndRender();
    if (me.needsSetup) return renderSetup(me.canSetup);
    renderLogin();
  }
  function renderSetup(canSetup) {
    root.innerHTML = `
      <div class="auth"><div class="card">
        <h1>처음 설정</h1>
        ${canSetup ? `
          <p class="muted">관리자 비밀번호를 정해 주세요. 이 화면은 서버가 켜진 컴퓨터에서만 보여요.</p>
          <form>
            <label class="f"><span>새 비밀번호 (8자 이상)</span><input type="password" name="pw" autocomplete="new-password" required minlength="8"></label>
            <label class="f"><span>한 번 더</span><input type="password" name="pw2" autocomplete="new-password" required minlength="8"></label>
            <p class="err"></p>
            <button class="btn primary" type="submit">비밀번호 저장하고 시작하기</button>
          </form>` : `<p class="muted">아직 관리자 비밀번호가 없어요. 서버 컴퓨터에서 <code>npm run set-password</code>를 실행해 주세요.</p>`}
      </div></div>`;
    const f = $('form', root);
    if (!f) return;
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (f.pw.value !== f.pw2.value) return ($('.err', f).textContent = '두 비밀번호가 달라요.');
      try {
        await api('POST', '/api/admin/setup', { password: f.pw.value });
        loadAndRender();
      } catch (err) {
        $('.err', f).textContent = err.message;
      }
    });
  }
  function renderLogin() {
    root.innerHTML = `
      <div class="auth"><div class="card">
        <h1>뀡잉힝 관리자</h1>
        <form>
          <label class="f"><span>비밀번호</span><input type="password" name="pw" autocomplete="current-password" required autofocus></label>
          <p class="err"></p>
          <button class="btn primary" type="submit">들어가기</button>
        </form>
        <p class="muted" style="margin-bottom:0"><a href="/">← 사이트로 돌아가기</a></p>
      </div></div>`;
    const f = $('form', root);
    f.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('POST', '/api/admin/login', { password: f.pw.value });
        loadAndRender();
      } catch (err) {
        $('.err', f).textContent = err.message;
      }
    });
  }

  async function loadAndRender() {
    st.data = await api('GET', '/api/admin/data');
    renderShell();
  }

  /* ---------- 틀 ---------- */
  function renderShell() {
    root.innerHTML = `
      <header class="top">
        <h1>🏠 뀡잉힝 관리자</h1>
        <div class="tabs" role="tablist">
          <button class="btn small" role="tab" data-tab="items" aria-selected="${st.tab === 'items'}">콘텐츠</button>
          <button class="btn small" role="tab" data-tab="categories" aria-selected="${st.tab === 'categories'}">카테고리</button>
          <button class="btn small" role="tab" data-tab="settings" aria-selected="${st.tab === 'settings'}">사이트 설정</button>
          <button class="btn small" role="tab" data-tab="notion" aria-selected="${st.tab === 'notion'}">노션</button>
        </div>
        <nav><a class="btn small" href="/room" target="_blank" rel="noopener">사이트 보기 ↗</a><button class="btn small btn-logout" type="button">로그아웃</button></nav>
      </header>
      <main></main>`;
    $$('[data-tab]', root).forEach((b) => b.addEventListener('click', () => {
      if (!confirmLeave()) return;
      st.tab = b.dataset.tab;
      renderShell();
    }));
    $('.btn-logout', root).addEventListener('click', async () => {
      await api('POST', '/api/admin/logout');
      location.reload();
    });
    if (st.tab === 'items') renderItems();
    else if (st.tab === 'categories') renderCategories();
    else if (st.tab === 'notion') renderNotion();
    else renderSettings();
  }
  function confirmLeave() {
    if (!st.dirty) return true;
    if (confirm('저장하지 않은 변경이 있어요. 버리고 이동할까요?')) { st.dirty = false; return true; }
    return false;
  }
  window.addEventListener('beforeunload', (e) => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } });

  /* ---------- 콘텐츠 목록 ---------- */
  function sortedItems() {
    const order = st.data.categoryKeys;
    return st.data.items
      .filter((i) => !st.filter || i.category === st.filter)
      .sort((a, b) => order.indexOf(a.category) - order.indexOf(b.category) || (b.isFeatured - a.isFeatured) || a.sort - b.sort || b.updatedAt.localeCompare(a.updatedAt));
  }
  function renderItems() {
    const main = $('main', root);
    const cats = st.data.categories;
    main.innerHTML = `
      <div class="layout">
        <aside>
          <div class="list-head">
            <select class="filter" aria-label="카테고리 거르기"><option value="">모든 카테고리</option>${catOptions(st.filter)}</select>
            <button class="btn primary btn-new" type="button">+ 새 항목</button>
          </div>
          <ul class="items">${sortedItems().map((i) => `
            <li><button class="item-row" type="button" data-id="${i.id}" aria-current="${i.id === st.currentId}">
              <span class="t">${esc(i.title)}</span>
              <span class="badges"><span class="badge">${esc(ko(i.category))}</span>${i.isPublic ? '<span class="badge pub">공개</span>' : '<span class="badge priv">비공개</span>'}${i.isFeatured ? '<span class="badge feat">대표</span>' : ''}${i.notionPageId ? '<span class="badge">노션</span>' : ''}</span>
            </button></li>`).join('') || '<li class="muted">아직 항목이 없어요.</li>'}</ul>
        </aside>
        <section class="editor-wrap">${st.currentId ? '' : '<div class="card empty"><h2>왼쪽에서 항목을 고르거나 새로 만들어 주세요</h2><p class="muted">공개로 켠 항목만 방 안의 물건에 나타나요. 비공개 항목과 첨부파일은 방문자가 열 수 없어요.</p></div>'}</section>
      </div>`;
    $('.filter', main).addEventListener('change', (e) => { st.filter = e.target.value; renderItems(); });
    $('.btn-new', main).addEventListener('click', async () => {
      if (!confirmLeave()) return;
      const { item } = await api('POST', '/api/admin/items', { category: st.filter || 'competitions' });
      st.data.items.push(item);
      st.currentId = item.id;
      renderItems();
      $('[name=title]', main).select();
    });
    $$('.item-row', main).forEach((b) => b.addEventListener('click', () => {
      if (!confirmLeave()) return;
      st.currentId = b.dataset.id;
      renderItems();
    }));
    if (st.currentId) renderEditor($('.editor-wrap', main));
  }

  /* ---------- 항목 편집 ---------- */
  function fileById(id) {
    return st.data.files.find((f) => f.id === id);
  }
  function renderEditor(wrap) {
    const it = st.data.items.find((i) => i.id === st.currentId);
    if (!it) { st.currentId = null; return renderItems(); }
    const shareUrl = `${location.origin}/w/${it.slug}`;
    wrap.innerHTML = `
      <form class="editor" novalidate>
        <div class="sec">
          <h2>기본 정보</h2>
          <div class="grid2">
            <label class="f"><span>카테고리 (방 안의 물건)</span><select name="category">${catOptions(it.category)}</select></label>
            <label class="f"><span>하위 분류 <small>(방문자 필터)</small></span><select name="sub">${subOptions(it.category, it.sub)}</select></label>
          </div>
          <div class="grid2">
            <label class="f"><span>공유 주소</span><input type="text" name="slug" value="${esc(it.slug)}" pattern="[a-z0-9-]+"><small>${esc(location.origin)}/w/<b>${esc(it.slug)}</b> · 영문 소문자, 숫자, -</small></label>
          </div>
          <label class="f"><span>제목</span><input type="text" name="title" value="${esc(it.title)}" maxlength="200"></label>
          <label class="f"><span>한 줄 소개 <small>(카드에 보여요 · 무엇을 만들었는지)</small></span><input type="text" name="summary" value="${esc(it.summary)}" maxlength="300"></label>
          <label class="f"><span>출품·소속 정보 <small>(일한 기록은 '어디서·언제' · 제목 위 작은 글씨)</small></span><input type="text" name="context" value="${esc(it.context)}" maxlength="200"></label>
          <label class="f"><span>내 역할 <small>(일한 기록은 '맡았던 일' · 쉼표로 구분)</small></span><input type="text" name="role" value="${esc(it.role)}" maxlength="300"></label>
          <label class="f"><span>결과물·수상 <small>(입력한 경우에만 표시돼요)</small></span><input type="text" name="result" value="${esc(it.result)}" maxlength="300"></label>
          <label class="f"><span>본문</span><textarea name="body" rows="8">${esc(it.body)}</textarea><small>빈 줄로 문단을 나눠요. 주소는 자동으로 링크가 돼요.</small></label>
        </div>

        <div class="sec">
          <h2>외부 링크</h2>
          <div class="links-list">${(it.links.length ? it.links : []).map(linkRow).join('')}</div>
          <div><button class="btn small btn-add-link" type="button">+ 링크 추가</button> <span class="hint">첫 번째 링크가 노란 버튼으로 크게 보여요.</span></div>
        </div>

        <div class="sec">
          <h2>이미지</h2>
          <div>
            <p class="hint" style="margin:0 0 6px">대표 이미지 — 패널에서 크게 보이는 한 장 (png, jpg, webp, gif)</p>
            <div class="thumbs">${it.coverFileId ? thumb(it.coverFileId) : '<span class="hint">없음 · 없으면 제목과 소개 중심으로 보여요</span>'}</div>
            <label class="btn small upload" style="margin-top:8px">대표 이미지 ${it.coverFileId ? '바꾸기' : '올리기'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-kind="cover"></label>
          </div>
          <div>
            <p class="hint" style="margin:0 0 6px">추가 이미지 — 본문 아래 갤러리</p>
            <div class="thumbs">${it.galleryFileIds.map(thumb).join('') || '<span class="hint">없음</span>'}</div>
            <label class="btn small upload" style="margin-top:8px">추가 이미지 올리기<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-kind="gallery" multiple></label>
          </div>
        </div>

        ${it.category === 'compositions' ? `<div class="sec">
          <h2>음원 (자작곡)</h2>
          ${it.audioFileId && fileById(it.audioFileId) ? `<div><p style="margin:0 0 6px">올린 파일: <b>${esc(fileById(it.audioFileId).name)}</b></p><audio controls preload="none" src="/files/${it.audioFileId}" style="width:100%"></audio>
            <button class="btn small danger" type="button" data-del-file="${it.audioFileId}" style="margin-top:8px">음원 지우기</button></div>` : '<p class="hint" style="margin:0">아직 음원이 없어요. 음원이 없으면 재생 버튼이 보이지 않아요.</p>'}
          <label class="btn small upload">${it.audioFileId ? '다른 음원으로 바꾸기' : '음원 올리기 (mp3, m4a, ogg, wav)'}<input type="file" accept="audio/*" data-kind="audio"></label>
          <p class="hint" style="margin:0">대표 이미지가 음반 재킷으로 쓰여요. 턴테이블 대표곡은 사이트 설정에서 골라요.</p>
        </div>` : ''}

        <div class="sec">
          <h2>공개 설정</h2>
          <div class="toggles">
            <label><input type="checkbox" name="isPublic" ${it.isPublic ? 'checked' : ''}> 방문자에게 공개</label>
            <label><input type="checkbox" name="isFeatured" ${it.isFeatured ? 'checked' : ''}> 이 카테고리의 대표 항목</label>
          </div>
          <label class="f" style="max-width:200px"><span>정렬 순서</span><input type="number" name="sort" value="${Number(it.sort) || 0}"><small>작은 숫자가 먼저 (대표 항목은 항상 맨 앞)</small></label>
          <p class="hint" style="margin:0">${it.isPublic ? `공유 주소: <a href="${esc(shareUrl)}" target="_blank" rel="noopener">${esc(shareUrl)}</a>` : '비공개 상태에서는 공유 주소도 열리지 않아요.'}</p>
        </div>

        <div class="sec private">
          <h2>비공개 보관함</h2>
          <label class="f"><span>비공개 메모</span><textarea name="privateNotes" rows="5" placeholder="회의 메모, AI 활용 과정, 아이디어 등">${esc(it.privateNotes)}</textarea></label>
          <div>
            <p style="margin:0 0 6px;font-weight:700">진행 기록</p>
            <div class="logs-list" style="display:grid;gap:8px">${it.logs.map(logRow).join('')}</div>
            <button class="btn small btn-add-log" type="button" style="margin-top:8px">+ 기록 추가</button>
          </div>
          <div>
            <p style="margin:0 0 6px;font-weight:700">원본 첨부자료 <span class="hint">(신청서, 조사 자료 등 · 관리자만 내려받을 수 있어요)</span></p>
            <ul class="files">${it.attachmentFileIds.map((id) => {
              const f = fileById(id);
              return f ? `<li><span>📎 <a href="/files/${f.id}">${esc(f.name)}</a> <small class="hint">${(f.size / 1024).toFixed(0)}KB</small></span><button class="btn small danger" type="button" data-del-file="${f.id}">삭제</button></li>` : '';
            }).join('') || '<li class="hint" style="border:0;background:none">없음</li>'}</ul>
            <label class="btn small upload" style="margin-top:8px">첨부파일 올리기<input type="file" data-kind="attachment" multiple></label>
          </div>
        </div>

        <div class="actions">
          <button class="btn primary" type="submit">저장</button>
          <span class="hint save-state"></span>
          <span style="flex:1"></span>
          <button class="btn danger btn-delete" type="button">항목 삭제</button>
        </div>
      </form>`;

    const form = $('form', wrap);
    if (it.notionPageId) lockNotionItem(form, it);
    form.addEventListener('input', () => { st.dirty = true; $('.save-state', form).textContent = '저장하지 않은 변경이 있어요'; });
    form.elements.category.addEventListener('change', () => { form.elements.sub.innerHTML = subOptions(form.elements.category.value, ''); });
    $('.btn-add-link', form).addEventListener('click', () => { $('.links-list', form).insertAdjacentHTML('beforeend', linkRow({ label: '', url: '' })); st.dirty = true; });
    $('.btn-add-log', form).addEventListener('click', () => { $('.logs-list', form).insertAdjacentHTML('beforeend', logRow({ id: '', date: new Date().toISOString().slice(0, 10), text: '' })); st.dirty = true; });
    form.addEventListener('click', async (e) => {
      const rm = e.target.closest('[data-remove-row]');
      if (rm) { rm.closest('.link-row, .log-row').remove(); st.dirty = true; return; }
      const del = e.target.closest('[data-del-file]');
      if (del) {
        if (!confirm('이 파일을 지울까요? 되돌릴 수 없어요.')) return;
        if (st.dirty) await save(form, true);
        const r = await api('DELETE', `/api/admin/files/${del.dataset.delFile}`);
        replaceItem(r.item);
        st.data.files = st.data.files.filter((f) => f.id !== del.dataset.delFile);
        toast('파일을 지웠어요');
        renderItems();
      }
    });
    $$('input[type=file]', form).forEach((inp) => inp.addEventListener('change', async () => {
      const files = [...inp.files];
      if (!files.length) return;
      if (st.dirty) await save(form, true);
      for (const file of files) {
        if (file.size > MAX_UPLOAD) { toast(`${file.name}: 28MB 이하만 올릴 수 있어요`); continue; }
        try {
          toast(`${file.name} 올리는 중…`);
          const r = await api('POST', `/api/admin/items/${it.id}/files`, { kind: inp.dataset.kind, name: file.name, mime: file.type || 'application/octet-stream', data: await fileToBase64(file) });
          replaceItem(r.item);
          st.data.files.push(r.file);
          if (inp.dataset.kind === 'cover') {
            const t = await makeThumb(file);
            if (t) {
              const r2 = await api('POST', `/api/admin/items/${it.id}/files`, { kind: 'thumb', name: 'thumb-' + file.name.replace(/\.\w+$/, '') + '.jpg', mime: 'image/jpeg', data: t });
              replaceItem(r2.item);
              st.data.files.push(r2.file);
            }
          }
        } catch (err) { toast(err.message); }
      }
      toast('올렸어요');
      renderItems();
    }));
    form.addEventListener('submit', (e) => { e.preventDefault(); save(form); });
    $('.btn-delete', form).addEventListener('click', async () => {
      if (!confirm(`'${it.title}' 항목과 첨부파일을 모두 지울까요? 되돌릴 수 없어요.`)) return;
      await api('DELETE', `/api/admin/items/${it.id}`);
      st.data.items = st.data.items.filter((i) => i.id !== it.id);
      st.currentId = null;
      st.dirty = false;
      toast('지웠어요');
      renderItems();
    });
  }
  // 노션에서 발행한 작품: 공개 내용은 노션에서만 바꾼다. 비공개 보관함만 여기서 고친다.
  function lockNotionItem(form, it) {
    const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : '-');
    form.insertAdjacentHTML('afterbegin', `<div class="sec notion-note"><h2>노션에서 관리하는 작품</h2>
      <p style="margin:0">공개 내용(제목, 요약, 이미지, 링크, 분류, 공개 여부)은 노션 '전시 게시물'에서 고친 뒤 '재발행 요청'으로 바꿔 주세요. 여기서는 아래 비공개 보관함만 고칠 수 있어요.</p>
      <p class="hint" style="margin:0">발행 v${it.publishedVersion || 0} · 최초 발행 ${when(it.firstPublishedAt)} · 최근 발행 ${when(it.lastPublishedAt)} · ${it.isPublic ? '공개 중' : '비공개'}</p></div>`);
    $$('input, select, textarea, button', form).forEach((c) => {
      if (c.closest('.sec.private') || c.closest('.actions') || c.closest('.notion-note')) return;
      c.disabled = true;
    });
    $$('label.upload', form).forEach((l) => { if (!l.closest('.sec.private')) l.classList.add('disabled'); });
    const del = $('.btn-delete', form);
    if (del) del.remove();
  }
  function replaceItem(item) {
    if (!item) return;
    const i = st.data.items.findIndex((x) => x.id === item.id);
    if (i >= 0) st.data.items[i] = item;
  }
  function thumb(id) {
    return `<div class="thumb"><img src="/files/${id}" alt=""><button class="btn small danger" type="button" data-del-file="${id}">삭제</button></div>`;
  }
  function linkRow(l) {
    return `<div class="link-row"><input type="text" data-k="label" placeholder="버튼 이름" value="${esc(l.label)}"><input type="url" data-k="url" placeholder="https://" value="${esc(l.url)}"><button class="btn small" type="button" data-remove-row aria-label="링크 지우기">✕</button></div>`;
  }
  function logRow(l) {
    return `<div class="log-row" data-id="${esc(l.id)}"><input type="date" data-k="date" value="${esc(l.date)}"><textarea data-k="text" placeholder="무엇을 했는지">${esc(l.text)}</textarea><button class="btn small" type="button" data-remove-row aria-label="기록 지우기">✕</button></div>`;
  }
  async function save(form, quiet) {
    const it = st.data.items.find((i) => i.id === st.currentId);
    const v = (n) => form.elements[n].value;
    const body = {
      category: v('category'), sub: v('sub'), slug: v('slug'), title: v('title'), summary: v('summary'), context: v('context'), role: v('role'), result: v('result'), body: v('body'),
      privateNotes: v('privateNotes'), sort: v('sort'),
      isPublic: form.elements.isPublic.checked, isFeatured: form.elements.isFeatured.checked,
      links: $$('.link-row', form).map((r) => ({ label: $('[data-k=label]', r).value, url: $('[data-k=url]', r).value })).filter((l) => l.url.trim()),
      logs: $$('.log-row', form).map((r) => ({ id: r.dataset.id || undefined, date: $('[data-k=date]', r).value, text: $('[data-k=text]', r).value })),
    };
    try {
      const r = await api('PUT', `/api/admin/items/${it.id}`, body);
      replaceItem(r.item);
      if (r.item.isFeatured) st.data.items.forEach((o) => { if (o.id !== r.item.id && o.category === r.item.category) o.isFeatured = false; });
      st.dirty = false;
      if (!quiet) { toast('저장했어요'); renderItems(); }
    } catch (err) {
      toast(err.message);
      throw err;
    }
  }

  /* ---------- 카테고리 ---------- */
  function renderCategories() {
    const main = $('main', root);
    if (st.data.notion && st.data.notion.configured) {
      const THING = { board: '책상 게시판', crt: '컴퓨터', shirt: '셔츠', chest: '상자', bookshelf: '책장', cork: '벽 게시판', bed: '침대', diary: '일기장', turntable: '턴테이블' };
      main.innerHTML = `<div class="editor" style="max-width:860px">
        <p class="hint" style="margin:0">분류는 노션 '분류 관리'에서 관리해요. 이름, 순서, 방 물건, 사용 여부를 노션에서 바꾸면 다음 동기화 때 사이트에 반영돼요. 아래는 지금 사이트에 적용된 값이에요.</p>
        ${st.data.categoryKeys.map((k) => {
          const c = st.data.categories[k];
          const shown = c.enabled !== false && c.thing;
          return `<div class="sec"><h2>${esc(c.ko || k)} · ${esc(c.name)} <small class="hint">${esc(k)}</small></h2>
            <p style="margin:0">방 물건: ${c.thing ? esc(THING[c.thing] || c.thing) : '미연결'} · ${shown ? '<span class="badge pub">사이트에 표시</span>' : '<span class="badge priv">숨김</span>'} · 버튼: ${esc(c.button)}</p>
            <p class="hint" style="margin:0">하위 분류: ${c.subs.map((x) => `${esc(x.ko || x.name)}${x.enabled === false ? ' (숨김)' : ''}`).join(', ') || '없음'}</p></div>`;
        }).join('')}</div>`;
      return;
    }
    const subRow = (x) => `<div class="sub-row" data-id="${esc(x.id || '')}"><input type="text" data-k="ko" placeholder="한국어 메모" value="${esc(x.ko || '')}"><input type="text" data-k="name" placeholder="방문자에게 보일 영어 이름" value="${esc(x.name || '')}"><button class="btn small" type="button" data-remove-row aria-label="분류 지우기">✕</button></div>`;
    main.innerHTML = `
      <form class="editor" style="max-width:860px" novalidate>
        <p class="hint" style="margin:0">방문자 화면에 보일 이름은 영어로 써 주세요. 카테고리와 방 안의 물건은 짝이 정해져 있어요. 하위 분류에 공개 항목이 없으면 방문자에게는 숨겨져요.</p>
        ${st.data.categoryKeys.map((k) => {
          const c = st.data.categories[k];
          return `<div class="sec cat-sec" data-key="${k}">
            <h2>${esc(ko(k))}</h2>
            <div class="grid2">
              <label class="f"><span>이름</span><input type="text" data-k="name" value="${esc(c.name)}" maxlength="60"></label>
              <label class="f"><span>이동 버튼 문구</span><input type="text" data-k="button" value="${esc(c.button)}" maxlength="60"></label>
            </div>
            <div><p style="margin:0 0 6px;font-weight:700">하위 분류</p><div class="subs-list" style="display:grid;gap:8px">${c.subs.map(subRow).join('')}</div>
            <button class="btn small btn-add-sub" type="button" style="margin-top:8px">+ 하위 분류 추가</button></div>
          </div>`;
        }).join('')}
        <div class="actions"><button class="btn primary" type="submit">카테고리 저장</button><span class="hint save-state"></span></div>
      </form>`;
    const form = $('form', main);
    form.addEventListener('input', () => { st.dirty = true; $('.save-state', form).textContent = '저장하지 않은 변경이 있어요'; });
    form.addEventListener('click', (e) => {
      const add = e.target.closest('.btn-add-sub');
      if (add) { add.previousElementSibling.lastElementChild.insertAdjacentHTML('beforeend', subRow({})); st.dirty = true; return; }
      const rm = e.target.closest('[data-remove-row]');
      if (rm) { rm.closest('.sub-row').remove(); st.dirty = true; }
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = {};
      $$('.cat-sec', form).forEach((sec) => {
        body[sec.dataset.key] = {
          name: $('[data-k=name]', sec).value, button: $('[data-k=button]', sec).value,
          subs: $$('.sub-row', sec).map((r) => ({ id: r.dataset.id || $('[data-k=name]', r).value, name: $('[data-k=name]', r).value, ko: $('[data-k=ko]', r).value })),
        };
      });
      try {
        const r = await api('PUT', '/api/admin/categories', body);
        st.data.categories = r.categories;
        st.data = await api('GET', '/api/admin/data');
        st.dirty = false;
        toast('저장했어요');
        renderCategories();
      } catch (err) { toast(err.message); }
    });
  }

  /* ---------- 노션 ---------- */
  async function renderNotion() {
    const main = $('main', root);
    main.innerHTML = '<div class="card"><p class="muted" style="margin:0">노션 상태를 불러오는 중…</p></div>';
    let n;
    try { n = await api('GET', '/api/admin/notion?rows=1'); } catch (err) {
      main.innerHTML = `<div class="card"><p class="err" style="margin:0">${esc(err.message)}</p></div>`;
      return;
    }
    if (st.tab !== 'notion') return;
    const when = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : '없음');
    const siteCell = (r) => (!r.site ? '<span class="badge priv">사이트에 없음</span>'
      : r.site.adopt ? `<span class="badge ${r.site.isPublic ? 'pub' : 'priv'}">기존 ${r.site.isPublic ? '공개본' : '비공개 작품'}</span><br><small class="hint">발행하면 이 작품을 이어받아요</small>`
      : (r.site.isPublic ? `<span class="badge pub">공개 v${r.site.version}</span>` : `<span class="badge priv">비공개 (v${r.site.version})</span>`)
        + (r.site.pendingWriteback ? ' <span class="badge">노션 기록 대기</span>' : ''));
    const rows = (n.rows || []).map((r) => `<tr>
      <td><b>${esc(r.title || '(제목 없음)')}</b>${r.featured ? ' <span class="badge feat">대표</span>' : ''}<br><small class="hint">${esc(r.category)} · /w/${esc(r.slug)}</small></td>
      <td><span class="badge">${esc(r.status || '-')}</span></td>
      <td>${siteCell(r)}</td>
      <td class="memo">${r.failure ? `<span class="err">${esc(r.failure.errors.join(' / '))}</span>` : esc(r.memo)}</td>
      <td class="acts"><a class="btn small" href="/preview/${esc(r.pageId)}" target="_blank" rel="noopener">미리보기 ↗</a>${r.url ? ` <a class="btn small" href="${esc(r.url)}" target="_blank" rel="noopener">노션 ↗</a>` : ''}</td>
    </tr>`).join('');
    const LV = { ok: '✓', warn: '!', error: '✕' };
    main.innerHTML = `
      <div class="editor" style="max-width:1040px">
        <div class="sec">
          <h2>노션 연동</h2>
          ${n.configured && !n.localPublish ? `<p style="margin:0">연결됨 · <b>미리보기 전용</b>이에요. 실제 사이트 발행은 GitHub가 10분마다 처리해요 (급하면 GitHub 저장소 → Actions → Notion sync → Run workflow).</p>` : ''}
          ${n.configured && n.localPublish
            ? `<p style="margin:0">연결됨 · 이 서버에서 발행 · ${n.intervalMinutes ? `${n.intervalMinutes}분마다 노션의 요청을 확인해요` : '자동 확인 꺼짐 (아래 버튼으로 실행해요)'}</p>`
            : n.configured ? ''
            : '<p class="err" style="margin:0">서버에 NOTION_TOKEN이 없어 연동이 꺼져 있어요. README의 \'노션 연동\'을 따라 토큰을 넣고 서버를 다시 시작해 주세요.</p>'}
          <p class="hint" style="margin:0">노션 '전시 게시물'에서 발행 상태를 '발행 요청', '재발행 요청', '내림 요청'으로 바꾼 작품만 처리해요. 다른 상태에서는 노션을 고쳐도 사이트 공개본이 그대로예요. 분류 이름·순서는 동기화할 때마다 노션 '분류 관리'를 따라요.</p>
          <p class="hint" style="margin:0">마지막 실행 ${when(n.lastRunAt)} · 마지막 성공 ${when(n.lastOkAt)}</p>
          <div class="actions" style="margin:0">
            <button class="btn primary btn-sync" type="button" ${n.configured && n.localPublish ? '' : 'disabled'}>지금 동기화</button>
            <button class="btn small btn-reload" type="button">새로고침</button>
            <label class="hint"><input type="checkbox" class="force"> 실패했던 요청도 다시 시도</label>
          </div>
        </div>
        ${n.configured ? `<div class="sec"><h2>전시 게시물</h2>${n.rowsError ? `<p class="err" style="margin:0">${esc(n.rowsError)}</p>`
          : `<div class="ntable-wrap"><table class="ntable"><thead><tr><th>작품</th><th>노션 상태</th><th>사이트</th><th>발행 메모</th><th></th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="hint">행이 없어요.</td></tr>'}</tbody></table></div>`}
          <p class="hint" style="margin:0">미리보기는 관리자에게만 열리고, 아직 발행하지 않은 노션 버전을 보여줘요.</p></div>` : ''}
        <div class="sec"><h2>최근 기록</h2><ul class="nlog">${n.log.map((l) => `<li class="lv-${l.level}"><span>${LV[l.level] || ''}</span> <small class="hint">${when(l.at)}</small> ${l.title ? `<b>${esc(l.title)}</b> · ` : ''}${esc(l.msg)}</li>`).join('') || '<li class="hint">아직 기록이 없어요.</li>'}</ul></div>
      </div>`;
    $('.btn-reload', main).addEventListener('click', renderNotion);
    const sync = $('.btn-sync', main);
    sync.addEventListener('click', async () => {
      sync.disabled = true;
      sync.textContent = '동기화 중…';
      try {
        const { result } = await api('POST', '/api/admin/notion/sync', { force: $('.force', main).checked });
        const parts = [];
        if (result.published.length) parts.push(`발행 ${result.published.length}`);
        if (result.unpublished.length) parts.push(`비공개 전환 ${result.unpublished.length}`);
        if (result.failed.length) parts.push(`실패 ${result.failed.length}`);
        if (result.errors.length) parts.push(result.errors[0]);
        toast(parts.length ? parts.join(' · ') : '처리할 요청이 없었어요');
        st.data = await api('GET', '/api/admin/data');
      } catch (err) { toast(err.message); }
      renderNotion();
    });
  }

  /* ---------- 사이트 설정 ---------- */
  function renderSettings() {
    const s = st.data.settings;
    const tracks = st.data.items.filter((i) => i.category === 'compositions');
    const main = $('main', root);
    main.innerHTML = `
      <form class="editor" style="max-width:760px" novalidate>
        <div class="sec">
          <h2>이름</h2>
          <label class="f"><span>사이트 이름 · 활동명 (영어)</span><input type="text" name="siteName" value="${esc(s.siteName)}" maxlength="40" required><small>탭 제목, 문패, 현판 뒷면에 함께 쓰여요. 지금은 임시 이름이에요.</small></label>
        </div>
        <div class="sec">
          <h2>현관</h2>
          <label class="f"><span>현판 뒷면 → 짧은 자기소개 (영어)</span><textarea name="aboutText" rows="4" maxlength="2000">${esc(s.aboutText)}</textarea><small>소개와 이력이 모두 비어 있으면 현판은 그냥 그림이에요.</small></label>
          <label class="f"><span>현판 뒷면 → 주요 이력 (영어, 한 줄에 하나)</span><textarea name="aboutHistory" rows="5" maxlength="3000" placeholder="2026 · HUFS × NAVER Cloud Vibe Coding Competition">${esc(s.aboutHistory)}</textarea></label>
          <label class="f"><span>우편함 → 연락용 이메일</span><input type="text" name="email" value="${esc(s.email)}" placeholder="name@example.com" inputmode="email"><small>비워 두면 우편함은 눌리지 않아요.</small></label>
        </div>
        <div class="sec">
          <h2>벽에 걸린 액자</h2>
          <label class="f"><span>노란 액자 → 네이버 블로그 홈 주소</span><input type="url" name="naverUrl" value="${esc(s.naverUrl)}" placeholder="https://blog.naver.com/아이디"><small>비워 두면 액자는 그냥 장식으로 걸려 있어요.</small></label>
          <label class="f"><span>흰 액자 → 인스타그램 프로필 주소</span><input type="url" name="instagramUrl" value="${esc(s.instagramUrl)}" placeholder="https://www.instagram.com/아이디"></label>
        </div>
        <div class="sec">
          <h2>턴테이블 대표곡</h2>
          <label class="f"><span>대표곡 (작곡 카테고리의 곡)</span><select name="featuredTrackId"><option value="">자동 (음원이 있는 첫 공개 곡)</option>${tracks.map((t) => `<option value="${t.id}" ${s.featuredTrackId === t.id ? 'selected' : ''}>${esc(t.title)}${t.audioFileId ? '' : ' (음원 없음)'}${t.isPublic ? '' : ' (비공개)'}</option>`).join('')}</select>
          <small>곡과 음원은 콘텐츠 탭에서 '작곡' 카테고리 항목으로 추가해요. 공개된 곡에 음원이 하나도 없으면 턴테이블에 재생 버튼이 나타나지 않아요.</small></label>
        </div>
        <div class="actions"><button class="btn primary" type="submit">설정 저장</button><span class="hint save-state"></span></div>
      </form>`;
    const form = $('form', main);
    form.addEventListener('input', () => { st.dirty = true; $('.save-state', form).textContent = '저장하지 않은 변경이 있어요'; });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const r = await api('PUT', '/api/admin/settings', { siteName: form.siteName.value, aboutText: form.aboutText.value, aboutHistory: form.aboutHistory.value, email: form.email.value, naverUrl: form.naverUrl.value, instagramUrl: form.instagramUrl.value, featuredTrackId: form.featuredTrackId.value || null });
        st.data.settings = r.settings;
        st.dirty = false;
        toast('저장했어요');
        renderSettings();
      } catch (err) { toast(err.message); }
    });
  }

  start().catch((e) => { root.innerHTML = `<p class="center">${esc(e.message)}</p>`; });
})();
