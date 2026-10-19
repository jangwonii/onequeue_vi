const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const statusNames = { planned: '읽고 싶은', reading: '읽는 중', done: '다 읽은' };
let state, filter = 'all', view = 'library', detailId, editId, featuredId, toastTimer, requestVersion = 0;
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 3500); }
function cover(book) { return `<div class="book-cover ${esc(book.color)}"><span class="cover-mark">MY LITTLE LIBRARY</span><span class="cover-title">${esc(book.title)}</span><span class="cover-author">${esc(book.author)}</span><span class="cover-art" aria-hidden="true"></span><span class="cover-ribbon" aria-hidden="true"></span></div>`; }
async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '잠시 후 다시 시도해 주세요.'); return result;
}
function accept(next) { state = next; render(); $('#connection').textContent = '이 컴퓨터에 저장됨'; }
async function refresh() {
  const version = ++requestVersion;
  try { const result = await request('/api/state'); if (version === requestVersion) accept(result); }
  catch { $('#connection').textContent = '연결을 확인해 주세요'; }
}
async function change(path, data) { ++requestVersion; accept(await request(path, data)); }
const percent = book => Math.round(book.pages / book.total * 100);
function render() {
  if (!state) return;
  $('#goal-year').textContent = state.year; $('#goal-total').textContent = state.goal; $('#year-finished').textContent = state.stats.yearFinished;
  $('#goal-progress').max = state.goal; $('#goal-progress').value = Math.min(state.goal, state.stats.yearFinished);
  $('#goal-message').textContent = state.stats.yearFinished >= state.goal ? '올해의 약속을 채웠어요. 다음 이야기도 기대해요.' : state.stats.yearFinished ? `앞으로 ${state.goal - state.stats.yearFinished}권, 나만의 속도로 읽어가요.` : '한 권의 책이 새로운 시작이 될 거예요.';
  $('#stat-total').textContent = state.stats.total; $('#stat-reading').textContent = state.stats.reading; $('#stat-notes').textContent = state.stats.notes;
  const featured = state.books.find(b => b.status === 'reading'); featuredId = featured?.id;
  $('#current-kicker').textContent = featured ? '지금, 함께 읽고 있는 책' : '새로운 이야기를 만날 시간';
  $('#current-title').textContent = featured?.title || '어떤 책으로 시작할까요?';
  $('#current-author').textContent = featured ? `${featured.author}${featured.sample ? ' · 예시 책' : ''}` : '읽고 싶은 책 한 권을 서재에 담아보세요.';
  $('#current-pages').textContent = featured ? `${featured.pages} / ${featured.total} 페이지` : '나만의 속도로, 한 페이지씩';
  $('#current-percent').textContent = featured ? `${percent(featured)}%` : '';
  $('#current-progress').value = featured ? percent(featured) : 0;
  $('#current-open').innerHTML = featured ? '오늘의 독서 기록 <span>↗</span>' : '책 등록하기 <span>↗</span>';
  $('#featured-cover').innerHTML = cover(featured || { title: '다음 페이지의 나에게', author: 'YOUR NEXT CHAPTER', color: 'sage' });
  $('#count-all').textContent = state.books.length;
  for (const kind of ['reading', 'planned', 'done']) $(`#count-${kind}`).textContent = state.books.filter(b => b.status === kind).length;
  document.querySelectorAll('[data-filter]').forEach(b => { const selected = filter === b.dataset.filter; b.classList.toggle('selected', selected); b.setAttribute('aria-pressed', String(selected)); });
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', view === b.dataset.view));
  $('#book-grid').hidden = view !== 'library'; $('#notes-grid').hidden = view !== 'notes';
  $('#shelf-title').textContent = view === 'notes' ? '나의 독서 노트' : '나의 책장';
  $('#sample-label').hidden = !state.books.some(b => b.sample);
  const query = $('#search').value.trim().toLocaleLowerCase();
  let books = state.books.filter(b => (filter === 'all' || b.status === filter) && `${b.title} ${b.author}`.toLocaleLowerCase().includes(query));
  if ($('#sort').value === 'title') books.sort((a, b) => a.title.localeCompare(b.title, 'ko'));
  if ($('#sort').value === 'progress') books.sort((a, b) => b.pages / b.total - a.pages / a.total);
  $('#shelf-count').textContent = view === 'notes' ? books.filter(b => b.note).length : books.length;
  $('#book-grid').innerHTML = books.length ? books.map(b => `<article class="book-card" data-id="${b.id}"><button class="cover-stage" data-open="${b.id}" aria-label="${esc(b.title)} 자세히">${cover(b)}${b.sample ? '<span class="sample-tag">예시 책</span>' : ''}</button><div class="book-info"><h3 class="book-title">${esc(b.title)}</h3><p class="book-author">${esc(b.author)}</p><div class="book-footer"><span class="status-badge ${b.status}">${statusNames[b.status]}</span>${b.status === 'done' && b.rating ? `<span class="stars" aria-label="별점 ${b.rating}점">${'★'.repeat(b.rating)}${'☆'.repeat(5 - b.rating)}</span>` : `<span>${b.pages} / ${b.total}p</span>`}</div><progress max="${b.total}" value="${b.pages}" aria-label="${esc(b.title)} 읽기 진행률"></progress></div></article>`).join('') : emptyLibrary();
  const notes = books.filter(b => b.note);
  $('#notes-grid').innerHTML = notes.length ? notes.map(b => `<button class="note-card" data-open="${b.id}" aria-label="${esc(b.title)} 독서 노트 열기"><span class="note-quote">“</span><span class="note-content">${esc(b.note)}</span><span class="note-meta"><span>${esc(b.title)}${b.sample ? ' · 예시' : ''}</span><span class="stars">${b.rating ? '★'.repeat(b.rating) : '↗'}</span></span></button>`).join('') : '<div class="empty-state"><span class="empty-emblem">“</span><h3>책을 덮고 남은 마음을 적어보세요</h3><p>책의 상세 화면에서 메모를 남기면<br>이곳에서 다시 꺼내 읽을 수 있어요.</p></div>';
}
function emptyLibrary() {
  if (state.books.length) return '<div class="empty-state"><span class="empty-emblem">⌕</span><h3>조건에 맞는 책이 없어요</h3><p>다른 제목을 검색하거나 독서 상태를 바꿔보세요.</p><button class="secondary-button" id="clear-search">전체 책 보기</button></div>';
  return '<div class="empty-state"><span class="empty-emblem">❧</span><h3>나의 첫 책장을 채워볼까요?</h3><p>읽고 싶은 책 한 권이면 충분해요.<br>어디까지 읽었는지, 무엇을 느꼈는지 함께 담아둘게요.</p><div class="empty-actions"><button class="primary-button" id="empty-add">첫 책 등록하기</button><button class="secondary-button" id="sample-books">가상의 예시 책장 보기 ↗</button></div></div>';
}
function openBookForm(book) {
  editId = book?.id;
  $('#book-form-title').textContent = book ? '책 정보 수정' : '서재에 책 한 권';
  $('#book-title').value = book?.title || ''; $('#book-author').value = book?.author || ''; $('#book-total').value = book?.total || ''; $('#book-genre').value = book?.genre || '에세이';
  $(`#book-form input[name=color][value=${book?.color || 'sage'}]`).checked = true;
  $('#book-form button[type=submit]').textContent = book ? '수정한 내용 저장' : '서재에 담기';
  $('#book-dialog').showModal();
}
function renderDetail(resetReview = false) {
  const book = state.books.find(b => b.id === detailId); if (!book) return $('#detail-dialog').close();
  $('#detail-cover').innerHTML = cover(book); $('#detail-title').textContent = book.title; $('#detail-author').textContent = book.author; $('#detail-genre').textContent = `${book.genre} · ${book.total}페이지`;
  $('#detail-status').textContent = statusNames[book.status]; $('#detail-status').className = `status-badge ${book.status}`;
  $('#detail-percent').textContent = `${percent(book)}%`; $('#detail-progress').value = percent(book);
  $('#read-pages').max = book.total; $('#read-pages').value = book.pages; $('#detail-total').textContent = book.total;
  $('#start-reading').hidden = book.status !== 'planned'; $('#finish-reading').disabled = book.status === 'done';
  $('#sample-detail').textContent = book.sample ? '가상의 제목·저자로 만든 예시 책입니다.' : '마지막 기록 ' + new Date(book.updated).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric' });
  if (resetReview) { $('#rating').value = book.rating; $('#book-note').value = book.note; $('#delete-confirm').hidden = true; }
  $('#note-length').textContent = `${$('#book-note').value.length.toLocaleString()} / 4,000`;
}
function openDetail(id) { detailId = id; renderDetail(true); $('#detail-dialog').showModal(); }
async function submit(event, work) {
  event.preventDefault(); const button = event.submitter; if (button) button.disabled = true;
  try { await work(); } catch (error) { toast(error.message); } finally { if (button) button.disabled = false; }
}
$('#add-book').onclick = () => openBookForm();
$('#current-open').onclick = () => featuredId ? openDetail(featuredId) : openBookForm();
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(`#${b.dataset.close}`).close());
document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { view = b.dataset.view; filter = 'all'; render(); });
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => { filter = b.dataset.filter; render(); });
$('#search').oninput = render; $('#sort').onchange = render;
$('.shelf-section').addEventListener('click', async event => {
  const open = event.target.closest('[data-open]'); if (open) return openDetail(open.dataset.open);
  if (event.target.closest('#empty-add')) return openBookForm();
  if (event.target.closest('#clear-search')) { filter = 'all'; $('#search').value = ''; render(); }
  const sample = event.target.closest('#sample-books');
  if (sample) { sample.disabled = true; try { await change('/api/sample', {}); toast('가상의 예시 책 4권을 추가했어요. 각 책에서 삭제할 수 있습니다.'); } catch (error) { toast(error.message); sample.disabled = false; } }
});
$('#book-form').addEventListener('submit', event => submit(event, async () => {
  const data = { title: $('#book-title').value, author: $('#book-author').value, total: Number($('#book-total').value), genre: $('#book-genre').value, color: $('#book-form input[name=color]:checked').value };
  await change(editId ? `/api/books/${editId}/edit` : '/api/books', data);
  $('#book-dialog').close();
  if (editId && $('#detail-dialog').open) renderDetail(false);
  if (!editId) { view = 'library'; filter = 'all'; $('#search').value = ''; render(); }
  toast(editId ? '책 정보를 수정했어요.' : '서재에 새로운 이야기를 담았어요.');
}));
$('#edit-book').onclick = () => openBookForm(state.books.find(b => b.id === detailId));
async function progress(pages, start = false) { await change(`/api/books/${detailId}/progress`, { pages, start }); renderDetail(false); toast(pages === state.books.find(b => b.id === detailId).total ? '마지막 페이지까지, 완독을 기록했어요.' : '오늘의 독서를 기록했어요.'); }
$('#progress-form').addEventListener('submit', event => submit(event, () => progress(Number($('#read-pages').value))));
$('#start-reading').onclick = async () => { try { await progress(0, true); } catch (error) { toast(error.message); } };
$('#finish-reading').onclick = async () => { try { await progress(state.books.find(b => b.id === detailId).total); } catch (error) { toast(error.message); } };
$('#book-note').oninput = () => $('#note-length').textContent = `${$('#book-note').value.length.toLocaleString()} / 4,000`;
$('#review-form').addEventListener('submit', event => submit(event, async () => {
  await change(`/api/books/${detailId}/review`, { rating: Number($('#rating').value), note: $('#book-note').value }); renderDetail(false); toast('책을 덮고 남은 마음을 저장했어요.');
}));
$('#delete-book').onclick = () => $('#delete-confirm').hidden = false;
$('#cancel-delete').onclick = () => $('#delete-confirm').hidden = true;
$('#confirm-delete').onclick = async () => {
  $('#confirm-delete').disabled = true;
  try { await change(`/api/books/${detailId}/delete`, {}); $('#detail-dialog').close(); toast('책과 독서 노트를 삭제했어요.'); }
  catch (error) { toast(error.message); } finally { $('#confirm-delete').disabled = false; }
};
$('#edit-goal').onclick = () => { if (!state) return; $('#goal-input').value = state.goal; $('#goal-dialog').showModal(); };
$('#goal-form').addEventListener('submit', event => submit(event, async () => { await change('/api/goal', { goal: Number($('#goal-input').value) }); $('#goal-dialog').close(); toast('올해의 작은 약속을 저장했어요.'); }));
$('#export').onclick = () => {
  if (!state) return;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), books: state.books, goal: state.goal }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), anchor = document.createElement('a'); anchor.href = url; anchor.download = 'bookmarks.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); toast('서재와 독서 노트를 내려받았어요.');
};
await refresh(); window.addEventListener('focus', () => { if (!document.querySelector('dialog[open]')) void refresh(); });
