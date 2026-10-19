import { categories, addDays, dayIndex, score } from './model.js';
const root = document.querySelector('#app');
const modal = document.querySelector('#modal');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dateLabel = value => value ? `${Number(value.slice(5, 7))}.${Number(value.slice(8, 10))}` : '시작 전';
const percent = member => Math.round(score(member.completed, member.planned) * 100);
let user = null, rooms = [], room = null, view = 'dashboard', busy = false, offline = false, authMode = 'login';
let invitation = new URLSearchParams(location.hash.slice(1)).get('invite') || '';
let toastTimer, refreshVersion = 0;
const mine = () => room?.members.find(member => member.id === user.id);
const avatar = member => `<span class="avatar ${member.id === user?.id ? 'mint' : 'peach'}">${esc(member.name.slice(0, 1))}</span>`;
const goalText = goal => goal.category === 'sleep' ? `${goal.bedtime} 전 취침 · 7일 중 ${goal.frequency}회` : `1회 ${goal.minutes}분 이상 · 7일 중 ${goal.frequency}회`;
function toast(message) { const element = document.querySelector('#toast'); element.textContent = message; element.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => element.classList.remove('visible'), 5000); }
async function api(path, data) {
  const response = await fetch(`/api${path}`, { method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.timeout(15000) });
  const result = await response.json();
  if (!response.ok) { const error = new Error(result.error || '요청을 처리하지 못했습니다.'); error.status = response.status; throw error; }
  return result;
}
function friendly(error) { return error.name === 'TimeoutError' || error instanceof TypeError ? '서버에 연결하지 못했습니다. 연결을 확인한 뒤 다시 시도해 주세요.' : error.message; }
async function refresh() {
  const version = ++refreshVersion;
  const selected = room?.id;
  const result = selected ? await api(`/rooms/${selected}`) : await api('/rooms');
  if (version !== refreshVersion || selected !== room?.id) return;
  const changed = JSON.stringify(selected ? room : rooms) !== JSON.stringify(selected ? result.room : result.rooms);
  if (selected) room = result.room; else rooms = result.rooms;
  if (offline || changed) { offline = false; render(); }
}
async function mutation(operation, payload = {}, targetRoom = room?.id) {
  const result = await api(`/rooms/${targetRoom}/${operation}`, payload);
  ++refreshVersion;
  if (room?.id === targetRoom) room = result.room;
  offline = false; render(); return result;
}
function showModal(title, html) {
  modal.innerHTML = `<div class="modal-top"><span class="eyebrow">MY SEVEN DAYS</span><button class="close-button" aria-label="닫기">×</button></div><h2 id="modal-title">${title}</h2>${html}`;
  modal.querySelector('.close-button').onclick = () => modal.close();
  modal.showModal();
}
function formHandler(form, callback) {
  form.onsubmit = async event => {
    event.preventDefault(); if (busy) return;
    busy = true; const button = form.querySelector('[type="submit"]'); button.disabled = true;
    const errorElement = form.querySelector('.form-error'); errorElement.textContent = '';
    try { await callback(Object.fromEntries(new FormData(form))); }
    catch (error) { errorElement.textContent = friendly(error); }
    finally { busy = false; if (button.isConnected) button.disabled = false; }
  };
}
function navButton(id, icon, label) { return `<button class="nav-item ${view === id ? 'active' : ''}" data-view="${id}" ${view === id ? 'aria-current="page"' : ''}><span aria-hidden="true">${icon}</span>${label}</button>`; }
function render() {
  if (!user) return renderAuth();
  root.innerHTML = `<aside class="sidebar"><a class="brand" href="#"><span class="brand-mark">7</span>seven<span class="brand-dot">.</span></a><div class="workspace"><span class="workspace-icon">↗</span><div>작은 약속, 큰 변화<small>MY ROUTINE CLUB</small></div></div><p class="nav-label">MY CHALLENGE</p><nav aria-label="메인 메뉴">${navButton('dashboard', '◫', '나의 7일')}${navButton('friends', '♧', '친구방')}${navButton('league', '⚑', '우리 리그')}</nav><button class="text-button room-switch" data-action="rooms">다른 친구방 보기 ↗</button><div class="sidebar-note"><span>✳</span><strong>완벽함보다 꾸준함.</strong><p>작은 약속을 지키는 매일이<br>더 나은 나를 만들어요.</p><button class="text-button" data-action="rules">챌린지 이용 안내 ↗</button></div><div class="profile">${avatar(user)}<div>${esc(user.name)}<small>@${esc(user.username)}</small></div><button class="text-button" data-action="logout">로그아웃</button></div></aside>
    <div class="main-shell"><header class="topbar"><div>내 챌린지 <span>/</span><strong>${room ? esc(room.name) : '나의 친구방'}</strong></div><div class="topbar-right"><span class="demo-badge"><i></i>${offline ? '연결 확인 필요' : '서버 연결됨'}</span><button class="help-button" data-action="rules" aria-label="이용 안내">?</button><button class="text-button mobile-logout" data-action="logout">로그아웃</button></div></header><main>
    ${offline ? '<div class="error-banner" role="alert">서버에 연결되지 않았습니다. 마지막으로 받은 기록을 표시합니다. 연결되면 자동 갱신됩니다.</div>' : ''}
    ${invitation ? '<div class="invite-banner"><div><b>친구에게 초대받으셨나요?</b><p>참여하면 이름, 목표, 인증 기록이 방의 친구들에게 공유됩니다.</p></div><button class="button primary" data-action="join-invitation">초대받은 방 참여하기</button></div>' : ''}
    ${room ? roomPage() : lobby()}
    <footer><span><b>seven.</b> 서로 다른 목표, 같은 마음.</span><span>서버 저장 · 한국 시간 기준 · 5초마다 최신 기록 확인</span></footer></main></div>`;
  root.querySelector('.brand').onclick = event => { event.preventDefault(); runAction('rooms'); };
  root.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; render(); });
  root.querySelectorAll('[data-action]').forEach(button => button.onclick = () => runAction(button.dataset.action, button.dataset.id));
}
function renderAuth() {
  const register = authMode === 'register';
  root.innerHTML = `<main class="auth-layout"><section class="auth-intro"><a class="brand" href="#"><span class="brand-mark">7</span>seven<span class="brand-dot">.</span></a><p class="eyebrow">A LITTLE BETTER, TOGETHER</p><h1>각자의 목표로,<br>함께하는 7일.</h1><p>친구를 초대하고, 서로의 약속을 확인하고.<br>오늘의 작은 실천을 함께 쌓아보세요.</p><div class="auth-seven" aria-hidden="true">7<span>DAYS</span></div><span class="pill">다른 목표 · 같은 기간 · 같은 달성률 기준</span></section><section class="card auth-card"><p class="eyebrow">YOUR ROUTINE CLUB</p><h2>${register ? '우리의 7일을 시작해요' : '다시 만나 반가워요'}</h2><p class="modal-description">${invitation ? '친구의 초대가 도착했어요. 로그인한 뒤 참여해 주세요.' : '내 계정으로 어느 기기에서나 기록을 이어가세요.'}</p><div class="segmented"><button data-auth="login" class="${!register ? 'selected' : ''}">로그인</button><button data-auth="register" class="${register ? 'selected' : ''}">회원가입</button></div><form id="auth-form">${register ? '<label>친구들에게 보일 이름<input name="name" autocomplete="nickname" minlength="1" maxlength="20" required placeholder="예: 민지"></label>' : ''}<label>아이디<input name="username" autocomplete="username" pattern="[A-Za-z0-9_-]{3,32}" minlength="3" maxlength="32" required placeholder="영문·숫자·밑줄·하이픈, 3~32자"></label><label>비밀번호<input name="password" autocomplete="${register ? 'new-password' : 'current-password'}" type="password" minlength="10" maxlength="128" required placeholder="10자 이상"></label>${register ? '<label>비밀번호 확인<input name="confirmation" autocomplete="new-password" type="password" minlength="10" maxlength="128" required></label><p class="field-hint">아이디와 비밀번호를 따로 보관해 주세요. 현재 비밀번호 찾기 기능은 제공하지 않습니다.</p>' : ''}<p class="form-error" role="alert"></p><button class="button primary full" type="submit">${register ? '계정 만들기' : '로그인하기'} ↗</button></form><p class="field-hint">목표와 인증 기록은 참여한 친구방 구성원에게만 표시됩니다.</p></section></main>`;
  root.querySelectorAll('[data-auth]').forEach(button => button.onclick = () => { if (busy) return; authMode = button.dataset.auth; renderAuth(); });
  formHandler(root.querySelector('form'), async values => {
    if (register && values.password !== values.confirmation) throw new Error('비밀번호 확인이 일치하지 않습니다.');
    const result = await api(register ? '/register' : '/login', values);
    user = result.user; room = null; rooms = (await api('/rooms')).rooms; render();
  });
}
function lobby() {
  return `<div class="page-heading"><div><p class="eyebrow">OUR LITTLE CHALLENGES</p><h1>함께할 친구방을 골라보세요</h1><p>친구들과 목표를 정하고, 같은 날 7일 챌린지를 시작해요.</p></div><button class="button primary" data-action="create-room">친구방 만들기 +</button></div><section class="hero"><div class="hero-copy"><span class="pill">7-DAY ROUTINE CHALLENGE</span><h2>혼자 정한 목표도,<br>함께라면 조금 더 꾸준하게.</h2><p>방을 만들고 초대 링크를 친구에게 보내세요.<br>모두의 약속을 확인하면 방장이 함께 시작할 수 있어요.</p><button class="text-button lobby-join" data-action="join">초대 링크로 참여하기 ↗</button></div><div class="hero-art" aria-hidden="true"><div class="orbit orbit-one"></div><div class="seven-art">7<span>DAYS</span></div></div></section><div class="rooms-grid">${rooms.length ? rooms.map(item => `<button class="card room-tile" data-action="open-room" data-id="${item.id}"><span class="eyebrow">${item.start ? 'CHALLENGE' : 'GETTING READY'}</span><h2>${esc(item.name)}</h2><p>${item.count}명 함께하는 중 · ${item.ownerId === user.id ? '내가 만든 방' : '참여한 방'}</p><span>${item.start ? `${dateLabel(item.start)} ~ ${dateLabel(item.end)}` : '친구들의 약속을 기다리는 중'} <b>↗</b></span></button>`).join('') : '<section class="card empty-room"><span>♧</span><h2>첫 친구방을 만들어 보세요</h2><p>가상의 참가자 없이, 초대한 친구들과 함께합니다.</p><button class="button primary" data-action="create-room">새 친구방 만들기</button></section>'}</div>`;
}
function roomPage() {
  const title = { dashboard: '나와의 약속을 지키는 7일', friends: '서로의 약속을 확인해요', league: '우리의 꾸준함, 한눈에' }[view];
  return `<div class="page-heading"><div><p class="eyebrow">${room.status === 'waiting' ? 'GETTING READY TOGETHER' : 'OUR SEVEN DAYS'}</p><h1>${title}</h1><p>${esc(room.name)} · ${room.members.length}명 · ${room.start ? `${dateLabel(room.start)} ~ ${dateLabel(room.end)}` : '모두 준비되면 같은 날 시작해요'}</p></div><div class="heading-actions"><button class="button secondary" data-action="rooms">방 목록</button>${room.invite ? '<button class="button primary" data-action="invite">친구 초대 ↗</button>' : ''}</div></div>${room.status === 'waiting' ? waitingBanner() : `<div class="shared-period"><span>▣ 시작할 때 정한 목표가 잠겼어요.</span><strong>${room.status === 'finished' ? '챌린지 종료' : room.status === 'settling' ? '마지막 수면 인증 마감일' : `DAY ${dayIndex(room.start, room.today) + 1} / 7`}</strong></div>`}${view === 'friends' ? friendsPage() : view === 'league' ? leaguePage() : dashboard()}`;
}
function waitingBanner() {
  const readyCount = room.members.filter(member => member.goal).length;
  return `<section class="waiting-banner"><div><span class="eyebrow">BEFORE WE START</span><h2>${room.ready ? '모든 약속을 확인했어요. 시작할 준비 완료!' : '친구들의 약속을 모으고 있어요'}</h2><p>목표 제출 ${readyCount}/${room.members.length}명 · 모든 친구가 서로의 목표를 확인하면 시작할 수 있어요.</p></div>${room.ownerId === user.id ? `<button class="button primary" data-action="start" ${!room.ready ? 'disabled' : ''}>모두 함께 시작하기 ↗</button>` : '<span class="status-label">방장이 시작하면 함께 시작됩니다</span>'}</section>`;
}
function canCertify(member) {
  if (!room.start || !member.goal || room.status === 'finished' || member.completed >= member.planned) return false;
  const recordDay = member.goal.category === 'sleep' ? addDays(room.today, -1) : room.today;
  return recordDay >= room.start && recordDay <= room.end && !member.records.some(record => record.day === recordDay);
}
function dashboard() {
  const member = mine(), goal = member.goal;
  return `<div class="stat-grid"><div class="stat-card"><span class="stat-icon green">◷</span><div><p>함께하는 여정</p><strong>${room.start ? room.status === 'active' ? `DAY ${dayIndex(room.start, room.today) + 1}` : '기간 종료' : '준비 중'} <small>/ 7 DAYS</small></strong></div></div><div class="stat-card"><span class="stat-icon peach">✓</span><div><p>나의 약속 달성률</p><strong>${percent(member)}<small>%</small> <span class="stat-caption">${member.completed} / ${member.planned || '—'}회</span></strong></div></div><div class="stat-card"><span class="stat-icon lilac">♧</span><div><p>실제로 함께하는 친구</p><strong>${room.members.length}명 <small>최대 100명</small></strong></div></div></div><div class="content-grid"><div class="primary-column"><section class="card routine-card"><div class="section-heading"><h2>나의 약속</h2><span class="status-label locked">${room.start ? '▣ 목표 잠금' : '시작 전 수정 가능'}</span></div><div class="goal-summary"><span class="goal-icon">${goal ? categories[goal.category].icon : '✳'}</span><div><span class="category-label">YOUR OWN PACE</span><h3>${goal ? esc(goal.title) : '작지만 분명한 약속 하나'}</h3><p>${goal ? esc(goalText(goal)) : '횟수, 시간, 인증 기준을 정하고 친구에게 보여주세요.'}</p></div></div>${room.start ? `<div class="week-strip">${Array.from({ length: 7 }, (_, i) => { const day = addDays(room.start, i); const done = member.records.some(r => r.day === day); return `<div class="day-cell ${done ? 'done' : ''} ${day === room.today ? 'today' : ''}"><span>DAY ${i + 1}</span><div>${done ? '✓' : '—'}</div><small>${dateLabel(day)}</small></div>`; }).join('')}</div>` : `<p class="form-notice">${goal ? `친구 ${member.approvals.length}/${Math.max(0, room.members.length - 1)}명이 이 목표를 확인했어요. 목표를 수정하면 다시 확인받아야 해요.` : '공부·운동은 주 3회, 20분 이상. 수면은 주 5회 이상으로 정해요.'}</p>`}<div class="routine-bottom"><div><strong>${room.start ? '작은 실천을 친구들과 나누세요.' : '목표는 시작할 때 함께 잠깁니다.'}</strong><p>${goal?.category === 'sleep' ? '수면은 다음 날 인증 · 마지막 날은 8일째까지' : '하루 한 번 인증 · 전체 예정 횟수 기준으로 계산'}</p></div>${!room.start ? `<button class="button primary" data-action="goal">${goal ? '내 약속 수정하기' : '내 약속 정하기'} ↗</button>` : `<button class="button primary" data-action="certify" ${!canCertify(member) ? 'disabled' : ''}>${canCertify(member) ? '오늘 인증하기 ↗' : member.completed >= member.planned ? '✓ 목표 달성' : '인증 완료 / 대기'}</button>`}</div></section><section class="card"><div class="section-heading"><h2>함께 지키는 약속</h2><button class="text-button" data-view="friends">친구방 보기 ↗</button></div>${room.members.filter(m => m.id !== user.id).map(friendRow).join('') || '<p class="modal-description">초대 링크를 보내 첫 친구를 초대해 보세요.</p>'}</section></div><aside class="secondary-column"><section class="league-promo"><span class="eyebrow">THE CONSISTENCY LEAGUE</span><div class="promo-title"><h2>우리 리그</h2><span>⚑</span></div><p>목표의 크기가 아닌<br><b>약속을 지킨 비율</b>로 겨뤄요.</p><div class="formula"><span>달성한 횟수</span><span>÷</span><span>예정한 횟수</span></div><div class="promo-meta"><span>동점은 공동 순위</span><span>실제 참가자 ${room.members.length}명</span></div><button class="button dark" data-view="league">순위 확인하기 <span>↗</span></button></section><section class="card note-card"><span class="note-symbol">“</span><h3>많이 하는 사람보다,<br>자신의 약속을 지키는 사람.</h3><p>최소 기준만으로 난이도가 같아지지는 않아요. 시작 전에 친구들과 목표를 함께 확인해요.</p></section></aside></div>${recordsSection(member)}`;
}
function friendRow(member) { return `<div class="friend-row">${avatar(member)}<div class="friend-info"><strong>${esc(member.name)}${member.id === user.id ? '<span>나</span>' : ''}</strong><p>${esc(member.goal?.title || '목표를 정하는 중')}</p></div><div class="friend-progress"><span>${member.completed}<small> / ${member.planned || '—'}회</small><b>${percent(member)}%</b></span><div class="progress-track"><i style="width:${percent(member)}%"></i></div></div>${member.id !== user.id ? `<button class="cheer-button ${member.cheered ? 'cheered' : ''}" data-action="cheer" data-id="${member.id}" aria-label="${esc(member.name)} 응원" aria-pressed="${member.cheered}">${member.cheered ? '♥' : '♡'} ${member.cheers}</button>` : ''}</div>`; }
function recordsSection(member) { return `<section class="card record-section"><div class="section-heading"><h2>${member.id === user.id ? '나의' : `${esc(member.name)}님의`} 인증 기록</h2><span class="subtle-badge">${member.records.length}개의 실천</span></div>${member.records.length ? member.records.slice().reverse().map(record => `<article class="record"><span class="record-check">✓</span><div><strong>${dateLabel(record.day)} <span>${record.bedtime ? `${esc(record.bedtime)} 취침` : `${record.minutes}분 실천`}</span></strong><p>${esc(record.note)}</p></div><small>자기 기록</small></article>`).join('') : '<div class="empty-records"><span>✎</span><p>아직 남긴 기록이 없어요.<br><small>첫 번째 실천을 기다리고 있어요.</small></p></div>'}</section>`; }
function friendsPage() {
  return `<div class="members-grid">${room.members.map(member => `<section class="card member-card">${friendRow(member)}${member.goal ? `<p class="member-goal">${esc(goalText(member.goal))}</p><div class="proof-box"><span>인증 기준</span><p>${esc(member.goal.proof)}</p></div>` : '<p class="modal-description">아직 목표를 제출하지 않았어요.</p>'}<div class="member-bottom"><span class="status-label">${room.start ? '▣ 시작할 때 잠긴 목표' : `친구 확인 ${member.approvals.length}/${room.members.length - 1}명`}</span>${member.id === user.id && !room.start ? '<button class="button secondary" data-action="goal">내 목표 설정</button>' : member.goal && !room.start ? `<button class="button ${member.approvals.includes(user.id) ? 'secondary' : 'primary'}" data-action="review" data-id="${member.id}" ${member.approvals.includes(user.id) ? 'disabled' : ''}>${member.approvals.includes(user.id) ? '✓ 확인 완료' : '목표 확인하기'}</button>` : ''}</div>${room.start ? `<button class="text-button member-records" data-action="records" data-id="${member.id}">인증 기록 ${member.records.length}개 보기 ↗</button>` : ''}</section>`).join('')}</div>`;
}
function leaguePage() {
  const finished = room.status === 'finished';
  const winners = room.rankings.filter(member => member.rank === 1);
  return `<section class="league-heading"><div><span class="pill">SAME PROMISE, SAME RULES</span><h2>꾸준함이 실력이 되는 곳.</h2><p>같은 7일, 서로 다른 목표. 약속을 지킨 비율로 함께 겨뤄요.</p></div><div class="league-number">${room.members.length}<span>ROUTINES. ONE LEAGUE.</span></div></section>${finished && winners.length ? `<div class="form-notice winner-banner"><b>${winners.length > 1 ? `공동 우승 ${winners.length}명` : `우승: ${esc(winners[0].name)}`}</b><p>${winners.map(w => esc(w.name)).join(', ')} · 최종 달성률 ${percent(winners[0])}%</p></div>` : ''}<section class="card ranking-card"><div class="section-heading"><h2>${finished ? '최종 순위' : room.start ? '진행 순위' : '참가자 현황'} <span class="subtle-badge">같은 달성률 = 공동 순위</span></h2><span class="status-label">최대 100명 · 실제 ${room.members.length}명</span></div>${room.rankings.length ? `<div class="table-scroll"><table><thead><tr><th>순위</th><th>참가자 / 약속</th><th>인증 횟수</th><th>달성률</th></tr></thead><tbody>${room.rankings.map(member => { const full = room.members.find(m => m.id === member.id); return `<tr class="${member.id === user.id ? 'my-row' : ''}"><td><span class="rank ${member.rank <= 3 ? 'top-rank' : ''}">${room.start ? member.rank : '—'}</span></td><td><div class="table-person">${avatar(member)}<div><strong>${esc(member.name)}</strong><p>${esc(full.goal.title)}</p></div></div></td><td>${member.completed} / ${member.planned}회</td><td><strong>${percent(member)}%</strong><div class="progress-track"><i style="width:${percent(member)}%"></i></div></td></tr>`; }).join('')}</tbody></table></div>` : '<p class="modal-description">목표를 제출하면 참가자 현황에 표시됩니다.</p>'}<p class="demo-caption">표시는 반올림하며 공동 순위는 정확한 비율로 계산합니다. 마지막 수면 인증일이 지나면 최종 결과가 확정됩니다. 상금 결제·분배 기능은 없습니다.</p></section>`;
}
async function runAction(action, id) {
  if (busy) return;
  try {
    if (action === 'create-room') return createRoom();
    if (action === 'join') return joinForm();
    if (action === 'goal') return goalForm();
    if (action === 'certify') return certification();
    if (action === 'invite') return inviteDialog();
    if (action === 'review') return reviewGoal(id);
    if (action === 'start') return startDialog();
    if (action === 'rules') return rules();
    if (action === 'records') { const member = room.members.find(m => m.id === id); showModal('친구의 실천 기록', recordsSection(member)); return; }
    busy = true;
    if (action === 'rooms') { ++refreshVersion; rooms = (await api('/rooms')).rooms; room = null; view = 'dashboard'; render(); }
    if (action === 'open-room') { ++refreshVersion; room = (await api(`/rooms/${id}`)).room; view = 'dashboard'; render(); }
    if (action === 'logout') { await api('/logout', {}); ++refreshVersion; user = null; room = null; rooms = []; render(); }
    if (action === 'join-invitation') await joinRoom(invitation);
    if (action === 'cheer') { const member = room.members.find(m => m.id === id); await mutation('cheer', { targetId: id, active: !member.cheered }); toast('친구에게 보내는 응원이 저장됐어요.'); }
  } catch (error) { toast(friendly(error)); }
  finally { busy = false; }
}
function createRoom() {
  showModal('함께할 친구방 만들기', '<p class="modal-description">최대 100명까지 초대할 수 있어요. 모든 친구가 준비되면 방장이 시작해요.</p><form><label>친구방 이름<input name="name" minlength="2" maxlength="60" placeholder="우리의 작은 도전" required></label><p class="form-error" role="alert"></p><button class="button primary full" type="submit">친구방 만들기</button></form>');
  formHandler(modal.querySelector('form'), async values => { room = (await api('/rooms', values)).room; ++refreshVersion; view = 'dashboard'; modal.close(); render(); toast('친구방이 만들어졌어요. 초대 링크를 보내보세요!'); });
}
function parseInvite(value) {
  const clean = value.trim();
  if (/^[a-f0-9]{64}$/.test(clean)) return clean;
  try { const parsed = new URL(clean); const code = new URLSearchParams(parsed.hash.slice(1)).get('invite'); if (parsed.origin !== location.origin) throw new Error(); if (/^[a-f0-9]{64}$/.test(code)) return code; } catch {}
  throw new Error('이 서버에서 만든 초대 링크 또는 64자리 초대 코드를 입력해 주세요.');
}
async function joinRoom(code) {
  room = (await api('/join', { invite: parseInvite(code) })).room; ++refreshVersion; invitation = ''; history.replaceState(null, '', location.pathname); view = 'friends'; render(); toast('친구방에 참여했어요. 나의 약속을 정해보세요.');
}
function joinForm() {
  showModal('초대받은 방 참여하기', '<p class="modal-description">참여하면 이름, 목표, 인증 기록이 친구방 구성원에게 공유됩니다.</p><form><label>초대 링크 또는 코드<input name="invite" required placeholder="친구에게 받은 초대 링크"></label><p class="form-error" role="alert"></p><button class="button primary full" type="submit">친구방 참여하기</button></form>');
  formHandler(modal.querySelector('form'), async values => { await joinRoom(values.invite); modal.close(); });
}
function inviteDialog() {
  if (!room.invite) return;
  const link = `${location.origin}/#invite=${room.invite}`;
  const localOnly = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  showModal('친구를 우리의 7일에 초대해요', `<p class="modal-description">링크를 받은 친구가 계정을 만들고 참여할 수 있어요. 시작 전까지만 새 친구가 참여할 수 있습니다.</p><label class="invite-label">초대 링크<input id="invite-link" readonly value="${esc(link)}"></label><button class="button primary full" id="copy-link">초대 링크 복사</button>${localOnly ? '<div class="form-notice">현재 주소는 이 컴퓨터에서만 열립니다. 다른 기기에서 초대하려면 이 PC의 네트워크 주소 또는 배포한 HTTPS 주소로 접속한 뒤 링크를 복사하세요.</div>' : ''}<p class="field-hint">링크를 아는 사람은 누구나 참여할 수 있어요. 믿을 수 있는 친구에게만 공유하세요.</p><button class="text-button" id="rotate-link">기존 초대 링크 폐기하고 새로 만들기</button><p class="form-error" role="alert"></p>`);
  modal.querySelector('#copy-link').onclick = async () => { try { await navigator.clipboard.writeText(link); toast('초대 링크를 복사했어요.'); } catch { const input = modal.querySelector('#invite-link'); input.select(); toast('링크를 선택했어요. 복사해서 친구에게 보내주세요.'); } };
  modal.querySelector('#rotate-link').onclick = async () => { if (busy) return; busy = true; try { await mutation('rotate-invite'); modal.close(); inviteDialog(); toast('기존 링크는 더 이상 사용할 수 없어요.'); } catch (error) { modal.querySelector('.form-error').textContent = friendly(error); } finally { busy = false; } };
}
function goalForm() {
  if (room.start) return;
  const previous = mine().goal;
  const targetRoom = room.id;
  showModal('나의 7일을 정해볼까요?', `<p class="modal-description">친구들과 서로 확인한 뒤 방장이 함께 시작해요.</p><form><label>어떤 루틴인가요?<select name="category">${Object.entries(categories).map(([key, category]) => `<option value="${key}">${category.label}</option>`).join('')}</select></label><label>나의 목표<input name="title" required minlength="5" maxlength="60" placeholder="매일 영어 단어 공부하기"></label><div class="form-grid"><label>7일 동안 몇 회?<input name="frequency" type="number" min="3" max="7" value="7" required></label><label id="amount-label"></label></div><p class="field-hint" id="minimum-hint"></p><label>어떻게 인증하나요?<textarea name="proof" required minlength="10" maxlength="200" placeholder="타이머 기록을 확인하고 학습 내용과 시간을 적기"></textarea></label><label class="checkbox-label"><input name="reviewed" type="checkbox" required><span>실천 가능한 구체적인 목표이며, 인증 기준을 확인했습니다.</span></label><p class="field-hint">수정하면 친구들의 기존 확인이 취소됩니다. 시작 후에는 변경할 수 없습니다.</p><p class="form-error" role="alert"></p><button class="button primary full" type="submit">목표 제출하기</button></form>`);
  const form = modal.querySelector('form');
  const categoryChanged = () => {
    const category = categories[form.elements.category.value]; const sleep = form.elements.category.value === 'sleep';
    form.elements.frequency.min = category.frequency;
    modal.querySelector('#amount-label').innerHTML = sleep ? '취침 마감 시각<input name="bedtime" type="time" min="18:00" max="23:59" value="23:30" required>' : '1회 최소 시간 (분)<input name="minutes" type="number" min="20" max="480" value="30" required>';
    modal.querySelector('#minimum-hint').textContent = `${category.label}: 7일 중 ${category.frequency}회 이상${sleep ? ', 수면은 다음 날 전날 기록 인증' : ', 회당 20분 이상'}`;
  };
  form.elements.category.onchange = categoryChanged;
  if (previous) form.elements.category.value = previous.category;
  categoryChanged();
  if (previous) for (const key of ['title', 'frequency', 'minutes', 'bedtime', 'proof']) if (form.elements[key]) form.elements[key].value = previous[key];
  formHandler(form, async values => { await mutation('goal', { category: values.category, title: values.title, frequency: Number(values.frequency), minutes: Number(values.minutes || 0), bedtime: values.bedtime || '', proof: values.proof, reviewed: values.reviewed === 'on' }, targetRoom); modal.close(); toast('목표를 제출했어요. 친구들의 확인을 기다려 주세요.'); });
}
function reviewGoal(id) {
  const member = room.members.find(m => m.id === id); const targetRoom = room.id;
  showModal(`${esc(member.name)}님의 약속 확인`, `<h3>${esc(member.goal.title)}</h3><p class="modal-description">${esc(goalText(member.goal))}</p><div class="form-notice"><b>인증 기준</b><br>${esc(member.goal.proof)}</div><form><label class="checkbox-label"><input name="reviewed" type="checkbox" required><span>목표와 인증 기준이 구체적이며 친구에게 의미 있는 도전인지 확인했습니다.</span></label><p class="form-error" role="alert"></p><button class="button primary full" type="submit">이 목표 확인하기</button></form>`);
  formHandler(modal.querySelector('form'), async () => { await mutation('approve', { targetId: id, goalVersion: member.goalVersion }, targetRoom); modal.close(); toast('친구의 약속을 확인했어요.'); });
}
function startDialog() {
  const targetRoom = room.id;
  showModal('우리의 7일을 함께 시작해요', `<p class="modal-description">현재 참여한 ${room.members.length}명 모두 같은 기간으로 시작합니다.</p><div class="form-notice">시작하는 날부터 7일 · 한국 시간 기준<br>시작 후에는 목표 변경과 새 친구 참여가 불가능합니다.</div><form><p class="form-error" role="alert"></p><button class="button primary full" type="submit">지금 함께 시작하기</button></form>`);
  formHandler(modal.querySelector('form'), async () => { await mutation('start', {}, targetRoom); modal.close(); toast('모두의 약속을 잠갔어요. 오늘부터 함께 시작해요!'); });
}
function certification() {
  const goal = mine().goal; const sleep = goal.category === 'sleep'; const targetRoom = room.id;
  showModal(`${sleep ? '어젯밤' : '오늘'}의 약속을 남겨요`, `<p class="modal-description">${esc(goal.title)}</p><div class="form-notice"><b>잠긴 인증 기준</b><br>${esc(goal.proof)}</div><form><label>${sleep ? '어제 실제 취침 시각' : '실천한 시간 (분)'}<input name="${sleep ? 'bedtime' : 'minutes'}" type="${sleep ? 'time' : 'number'}" min="${sleep ? '18:00' : goal.minutes}" max="${sleep ? goal.bedtime : 480}" value="${sleep ? goal.bedtime : goal.minutes}" required></label><label>인증 기록<textarea name="note" minlength="10" maxlength="500" required placeholder="확인한 기록과 실천 내용을 구체적으로 적어 주세요."></textarea></label><p class="field-hint">이 기록은 방의 친구들에게 공개됩니다. 텍스트 자기 기록 방식으로, 사진 업로드나 사실 여부 자동 검증은 제공하지 않습니다.</p><p class="form-error" role="alert"></p><button class="button primary full" type="submit">실천 기록 저장하기</button></form>`);
  formHandler(modal.querySelector('form'), async values => { await mutation('record', { note: values.note, minutes: Number(values.minutes || 0), bedtime: values.bedtime || '' }, targetRoom); modal.close(); toast('서버에 인증 기록을 저장했어요.'); });
}
function rules() {
  showModal('서로 다른 목표, 같은 약속', '<div class="rules-list"><section><b>01. 친구를 초대하고 목표를 정해요</b><p>방장이 만든 링크로 최대 100명이 참여할 수 있어요. 공부·운동은 주 3회, 회당 20분 이상. 수면은 주 5회 이상으로 정해요.</p></section><section><b>02. 서로 확인하고 함께 시작해요</b><p>최소 기준은 난이도가 같다는 뜻이 아니에요. 모든 구성원이 서로의 목표를 확인하면 방장이 7일을 시작해요. 시작 후 목표 수정과 새 친구 참여는 차단됩니다.</p></section><section><b>03. 실천은 하루 한 번 기록해요</b><p>서버의 한국 시간으로 인증 날짜를 정해요. 수면은 다음 날 전날 기록으로 인증하며 마지막 날 기록은 8일째까지 제출할 수 있어요. 인증은 친구들에게 공유되는 텍스트 자기 기록입니다.</p></section><section><b>04. 약속을 지킨 비율로 겨뤄요</b><p>달성한 횟수 ÷ 전체 예정 횟수. 같은 비율은 공동 순위이고 최종 동점은 공동 우승이에요. 상금 결제·지급은 제공하지 않습니다.</p></section></div>');
}
async function boot() {
  root.innerHTML = '<main class="loading-screen"><span class="brand">seven.</span><p>우리의 약속을 불러오는 중…</p></main>';
  try { user = (await api('/me')).user; if (user) rooms = (await api('/rooms')).rooms; render(); }
  catch { root.innerHTML = '<main class="loading-screen"><h1>서버에 연결할 수 없어요</h1><p>서버 실행 상태를 확인한 뒤 다시 시도해 주세요.</p><button class="button primary" id="retry">다시 연결</button></main>'; root.querySelector('#retry').onclick = boot; }
}
setInterval(async () => {
  if (!user || busy || modal.open || document.hidden) return;
  try { await refresh(); } catch (error) { if (error.status === 401) { user = null; room = null; render(); toast('로그인이 만료되었습니다. 다시 로그인해 주세요.'); } else if (!offline) { offline = true; render(); } }
}, 5000);
window.addEventListener('hashchange', () => { invitation = new URLSearchParams(location.hash.slice(1)).get('invite') || ''; render(); });
boot();
