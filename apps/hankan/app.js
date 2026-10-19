const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let state, receivedAt = 0, filter = 'all', duration = 25, selectedTask = '', editingId, toastTimer, previousSessions;
const dateKey = timestamp => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(timestamp));
$('#today-date').textContent = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(new Date());
function toast(text) { $('#toast').textContent = text; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); }
async function request(path, data) {
  const response = await fetch(path, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error || '요청에 실패했습니다.'); return result;
}
function accept(next) {
  if (previousSessions !== undefined && next.sessions.length > previousSessions) toast('한 칸을 채웠어요! 집중 시간이 기록되었습니다.');
  previousSessions = next.sessions.length; state = next; receivedAt = Date.now(); render();
  $('#save-status').textContent = '안전하게 저장됨';
}
async function refresh() { try { accept(await request('/api/state')); } catch { $('#save-status').textContent = '서버 연결 확인 필요'; } }
async function change(path, data) { accept(await request(path, data)); }
function setFilter(next) { filter = next; render(); }
function render() {
  if (!state) return;
  const done = state.tasks.filter(t => t.done).length, remaining = state.tasks.length - done;
  $('#remaining-count').textContent = remaining; $('#nav-count').textContent = remaining;
  $('#completed-count').textContent = done; $('#task-total').textContent = state.tasks.length;
  $('#completion-label').textContent = state.tasks.length ? `${Math.round(done / state.tasks.length * 100)}% 채웠어요` : '나만의 속도로';
  $('#focus-minutes').textContent = state.sessions.filter(s => dateKey(s.finished) === dateKey(state.serverNow)).reduce((sum, s) => sum + s.minutes, 0);
  document.querySelectorAll('[data-filter]').forEach(b => { const on = b.dataset.filter === filter; b.classList.toggle('selected', on); b.setAttribute('aria-pressed', String(on)); });
  document.querySelectorAll('[data-nav]').forEach(b => { const on = b.dataset.nav === (filter === 'completed' ? 'completed' : 'all'); b.classList.toggle('active', on); });
  const tasks = state.tasks.filter(t => filter === 'all' || (filter === 'completed' ? t.done : !t.done));
  const list = tasks.length ? tasks.map(t => `<article class="task-row ${t.done ? 'done' : ''}" data-id="${t.id}"><input class="task-check" type="checkbox" ${t.done ? 'checked' : ''} aria-label="${esc(t.title)} 완료"><div class="task-content"><span class="task-name">${esc(t.title)}</span><div class="task-meta">${t.priority === 'important' ? '<span class="important-tag">중요한 일</span>' : '<span>나의 작은 한 칸</span>'}<span>·</span><span>${t.done ? '완료했어요' : '차근차근 진행해요'}</span></div></div><div class="task-tools">${!t.done ? `<button data-focus="${t.id}" aria-label="${esc(t.title)}에 집중하기">▷</button>` : ''}<button data-edit="${t.id}" aria-label="${esc(t.title)} 수정">···</button></div></article>`).join('') : `<div class="empty-state"><span class="empty-icon">${filter === 'completed' ? '✓' : '＋'}</span><h3>${filter === 'completed' ? '완료한 일이 여기에 모여요' : filter === 'active' && state.tasks.length ? '오늘의 할 일을 모두 채웠어요!' : '오늘의 첫 한 칸을 적어보세요'}</h3><p>${filter === 'completed' ? '할 일 옆 네모를 눌러 완료해 보세요.' : '아주 작은 일도 좋아요.<br>하나씩 채우다 보면 오늘이 달라질 거예요.'}</p></div>`;
  if ($('#task-list').innerHTML !== list) $('#task-list').innerHTML = list;
  if (selectedTask && !state.tasks.some(t => t.id === selectedTask && !t.done)) selectedTask = '';
  if (state.timer.status !== 'idle') selectedTask = state.timer.task_id || '';
  const options = `<option value="">자유롭게 집중하기</option>${state.tasks.filter(t => !t.done).map(t => `<option value="${t.id}">${esc(t.title)}</option>`).join('')}`;
  if ($('#focus-task').innerHTML !== options) $('#focus-task').innerHTML = options;
  $('#focus-task').value = selectedTask; $('#focus-task').disabled = state.timer.status !== 'idle';
  document.querySelectorAll('[data-minutes]').forEach(b => { b.classList.toggle('selected', Number(b.dataset.minutes) === (state.timer.status === 'idle' ? duration : state.timer.minutes)); b.disabled = state.timer.status !== 'idle'; });
  $('#timer-primary').textContent = state.timer.status === 'running' ? 'Ⅱ 잠시 쉬어가기' : state.timer.status === 'paused' ? '▶ 이어서 집중하기' : '▶ 집중 시작하기';
  $('#timer-reset').disabled = state.timer.status === 'idle';
  $('#timer-label').textContent = state.timer.status === 'running' ? '오롯이 집중하는 중' : state.timer.status === 'paused' ? '잠시 숨을 고르는 중' : '나를 위한 집중 시간';
  renderTimer();
  $('#session-list').innerHTML = state.sessions.length ? state.sessions.map(s => `<div class="session-row"><div>${esc(s.title)}<small>${new Date(s.finished).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</small></div><strong>${s.minutes}분</strong></div>`).join('') : '<div class="empty-state"><span class="empty-icon">◷</span><h3>첫 집중을 기다리고 있어요</h3><p>타이머를 끝까지 채우면 여기에 기록됩니다.</p></div>';
}
function renderTimer() {
  if (!state) return;
  const t = state.timer, remaining = t.status === 'idle' ? duration * 60000 : t.status === 'running' ? Math.max(0, t.remaining - (Date.now() - receivedAt)) : t.remaining;
  const seconds = Math.ceil(remaining / 1000), text = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  $('#timer-time').textContent = text;
  $('#timer-ring').setAttribute('stroke-dashoffset', String(t.status === 'idle' ? 0 : 100 * (1 - remaining / (t.minutes * 60000))));
  document.title = t.status === 'running' ? `${text} · 집중하는 한 칸` : '한 칸 — 나의 작은 집중 공간';
}
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true;
  try { await change('/api/tasks', { title: $('#task-title').value, priority: $('#task-priority').value }); $('#task-title').value = ''; setFilter('all'); toast('새로운 한 칸을 적었어요.'); }
  catch (error) { toast(error.message); } finally { submit.disabled = false; $('#task-title').focus(); }
});
$('#add-focus').onclick = () => $('#task-title').focus();
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => setFilter(b.dataset.filter));
document.querySelectorAll('[data-nav]').forEach(b => b.onclick = () => setFilter(b.dataset.nav));
document.querySelectorAll('[data-suggest]').forEach(b => b.onclick = () => { $('#task-title').value = b.dataset.suggest; $('#task-title').focus(); });
$('#task-list').addEventListener('change', async event => {
  if (!event.target.matches('.task-check')) return;
  try { await change(`/api/tasks/${event.target.closest('[data-id]').dataset.id}`, { action: 'toggle', done: event.target.checked }); }
  catch (error) { render(); toast(error.message); }
});
$('#task-list').addEventListener('click', event => {
  const edit = event.target.closest('[data-edit]'), focus = event.target.closest('[data-focus]');
  if (edit) {
    const task = state.tasks.find(t => t.id === edit.dataset.edit); if (!task) return;
    editingId = task.id; $('#edit-title').value = task.title; $('#edit-priority').value = task.priority; $('#edit-dialog').showModal();
  }
  if (focus) {
    if (state.timer.status !== 'idle') return toast('현재 집중을 끝내거나 초기화한 뒤 선택해 주세요.');
    selectedTask = focus.dataset.focus; render(); $('#timer-primary').focus();
    if (innerWidth < 700) $('.focus-panel').scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
});
$('#edit-form').addEventListener('submit', async event => {
  event.preventDefault(); event.submitter.disabled = true;
  try { await change(`/api/tasks/${editingId}`, { title: $('#edit-title').value, priority: $('#edit-priority').value }); $('#edit-dialog').close(); toast('할 일을 수정했어요.'); }
  catch (error) { toast(error.message); } finally { event.submitter.disabled = false; }
});
$('#delete-task').onclick = async () => {
  try { await change(`/api/tasks/${editingId}`, { action: 'delete' }); $('#edit-dialog').close(); toast('할 일을 삭제했어요.'); }
  catch (error) { toast(error.message); }
};
document.querySelectorAll('[data-close]').forEach(b => b.onclick = () => $(`#${b.dataset.close}`).close());
$('#history-open').onclick = () => $('#history-dialog').showModal();
$('#focus-task').onchange = event => selectedTask = event.target.value;
document.querySelectorAll('[data-minutes]').forEach(b => b.onclick = () => { duration = Number(b.dataset.minutes); render(); });
$('#timer-primary').onclick = async () => {
  if (!state) return; $('#timer-primary').disabled = true;
  try { await change('/api/timer', { action: state.timer.status === 'running' ? 'pause' : 'start', minutes: duration, taskId: selectedTask || null }); }
  catch (error) { toast(error.message); } finally { $('#timer-primary').disabled = false; }
};
$('#timer-reset').onclick = async () => {
  try { await change('/api/timer', { action: 'reset' }); toast('타이머를 초기화했어요. 중단한 시간은 기록되지 않아요.'); }
  catch (error) { toast(error.message); }
};
$('#export-data').onclick = () => {
  if (!state) return;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), tasks: state.tasks, sessions: state.sessions }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url; link.download = `hankan-${dateKey(Date.now())}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('할 일과 집중 기록을 내려받았어요.');
};
await refresh(); setInterval(renderTimer, 250); setInterval(refresh, 5000);
