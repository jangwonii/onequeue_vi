const $ = s => document.querySelector(s), app = $('#app'), dialog = $('#dialog');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const paths = {
  home: '<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z"/>',
  cards: '<rect x="5" y="3" width="15" height="18" rx="3"/><path d="M9 8h7M9 12h7M9 16h4M2 7v12"/>',
  leaf: '<path d="M20 3C5 2 3 7 4 13s11 11 16-10ZM4 20 15 9"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-4a6 6 0 0 1 12 0v4m1-16a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 5v2"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  logout: '<path d="M9 4H4v16h5m5-12 4 4-4 4M8 12h10"/>',
  flag: '<path d="M5 21V3m0 1c6-5 8 5 15 0v10c-7 5-9-5-15 0"/>',
  copy: '<rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  bell: '<path d="M5 17h14l-2-4V9a5 5 0 0 0-10 0v4Zm5 3h4"/>'
};
const icon = name => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (paths[name] || paths.leaf) + '</svg>';
const brand = '<span class="brand-mark">✳</span><span>우리의 약속</span>';
const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
const add = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dateLabel = day => Number(day.slice(5, 7)) + '.' + Number(day.slice(8));
const weekday = day => weekdays[new Date(day + 'T00:00:00Z').getUTCDay()];
const stateText = { draft: '시작 준비', scheduled: '시작 대기', active: '진행 중', review: '결과 확인 중', finished: '시즌 완료' };
const dayText = { planned: '예정', done: '완료', rest: '쉬는 날', missed: '미달', pending: '확인 필요' };
let user = null, rooms = [], room = null, today = '', tab = 'today', authTab = 'register', historyId = '', fetchedAt = Date.now(), busy = false, toastTimer, syncError = false;
let invite = new URL(location.href).searchParams.get('invite') || '';
let lastRoom = localStorage.getItem('promise-room') || '';
async function api(path, data) {
  const response = await fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data) });
  const value = await response.json();
  if (!response.ok) { if (response.status === 401 && user) { user = null; room = null; render(); } throw new Error(value.error || '요청을 완료하지 못했습니다.'); }
  return value;
}
const notify = message => { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4000); };
function setRoom(value) { room = value; lastRoom = room.id; localStorage.setItem('promise-room', lastRoom); fetchedAt = Date.now(); syncError = false; }
async function refreshRooms() { rooms = (await api('/rooms')).rooms; }
async function openRoom(id) { historyId = ''; tab = 'today'; setRoom((await api('/rooms/' + id)).room); render(); }
async function mutate(op, data = {}) {
  const value = await api('/rooms/' + room.id + '/' + op, { ...data, seasonId: room.season.id });
  setRoom(value.room); historyId = ''; render(); return value.room;
}
const mine = () => room?.members.find(m => m.id === user?.id);
const archive = () => room && room.season.id !== room.current;
function avatar(m, i = 0) { return `<span class="avatar a${i % 4}">${esc(m.name.slice(0, 1))}</span>`; }
function days(m) {
  return '<div class="day-grid">' + m.days.map(d => `<div class="day-cell ${d.day === room.today ? 'today' : ''}" title="${esc(d.day + ' ' + dayText[d.status])}"><span>${weekday(d.day)}</span><div class="day-dot ${d.status}">${d.status === 'done' ? '✓' : d.status === 'missed' ? '−' : d.status === 'pending' ? '?' : d.scheduled ? Number(d.day.slice(8)) : '·'}</div><span>${dateLabel(d.day)}</span></div>`).join('') + '</div>';
}
function promiseCard(m, i) {
  const g = m.goal;
  return `<article class="card promise-card"><div class="row between"><div class="row">${avatar(m, i)}<strong>${esc(m.name)}${m.id === user.id ? ' <small>나</small>' : ''}</strong></div><span class="badge ${m.ready ? '' : 'gray'}">${room.season.started ? '약속 잠금' : m.ready ? '준비 완료' : '준비 중'}</span></div>${g ? `<h3>${esc(g.title)}</h3><p class="reason">${esc(g.reason || '이유는 마음속에 간직할게요.')}</p><dl><dt>일정</dt><dd>${g.days.map(d => dateLabel(add(room.season.start, d)) + '(' + weekday(add(room.season.start, d)) + ')').join(' · ')}</dd><dt>마감</dt><dd>${esc(g.cutoff)} · 한국시간</dd><dt>완료 조건</dt><dd>${esc(g.proof)}</dd><dt>인증</dt><dd>${g.kind === 'timer' ? '앱 타이머 ' + g.minutes + '분 + 실천 기록' : '실천 기록 한 줄 · 자기신고'}</dd></dl>${days(m)}` : '<div class="empty"><p>어떤 약속을 할지 생각 중이에요.</p></div>'}</article>`;
}
function auth() {
  const register = authTab === 'register';
  return `<main class="auth"><header class="auth-header"><div class="brand">${brand}</div><small>작은 실천이 모이는 곳</small></header><div class="auth-main"><section class="auth-story"><p class="eyebrow">DIFFERENT GOALS, ONE PROMISE.</p><h1>할 일은 달라도,<br><em>약속은 함께 지키는 7일.</em></h1><p>혼자 미뤄 두었던 작은 다짐.<br>친구들과 나누고, 실천한 순간을 하나씩 모아 보세요.</p><div class="auth-art" aria-label="가상 약속 카드 예시"><div class="mini-promise"><div class="symbol">▤</div><b>책 10쪽 읽기</b><span>나의 속도로, 조금씩</span></div><div class="mini-promise"><div class="symbol">✳</div><b>동네 한 바퀴 걷기</b><span>오늘도 가볍게 한 걸음</span></div><div class="mini-promise"><div class="symbol">☾</div><b>취침 준비 체크인</b><span>하루를 편안하게 마무리</span></div></div><div class="row wrap"><span class="badge">7일 동안</span><span class="badge">각자의 목표</span><span class="badge">같은 4번의 약속</span></div></section><section class="auth-card"><h2>우리, 이번 주부터 해볼까요?</h2><p class="helper">친구에게 공개한 약속이 작은 힘이 됩니다.</p>${invite ? '<div class="notice">친구의 초대장이 도착했어요. 로그인 후 방에 참여해 주세요.</div>' : ''}<div class="auth-tabs"><button data-auth="register" class="${register ? 'active' : ''}">회원가입</button><button data-auth="login" class="${!register ? 'active' : ''}">로그인</button></div><form id="auth-form" class="form-grid">${register ? '<label>친구들에게 보일 이름<input name="name" required maxlength="20" autocomplete="nickname" placeholder="어떻게 불러 드릴까요?"></label>' : ''}<label>아이디<input name="username" required minlength="3" maxlength="32" pattern="[a-zA-Z0-9_-]+" autocomplete="username" placeholder="영문·숫자 3자 이상"></label><label>비밀번호<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="10자 이상"></label><p class="error" role="alert"></p><button class="btn primary wide" type="submit">${register ? '함께 시작하기' : '로그인'} ${icon('arrow')}</button></form><div class="divider">먼저 둘러보고 싶다면</div><button id="demo" class="btn wide">${icon('leaf')} 가상 친구방 체험하기</button><small>체험의 인물과 기록은 모두 가상입니다.</small></section></div><footer class="auth-footer">우리의 약속 · 서로를 재촉하기보다, 함께 돌아올 이유를 만듭니다.</footer></main>`;
}
function navButtons() {
  return [['today', 'home', '오늘의 약속'], ['promises', 'cards', '우리의 약속'], ['results', 'flag', '시즌 기록']].map(([id, symbol, name]) => `<button data-tab="${id}" class="nav-btn ${tab === id ? 'active' : ''}">${icon(symbol)}<span>${name}</span>${id === 'today' && room ? '<b class="nav-count">' + room.members.length + '</b>' : ''}</button>`).join('');
}
function shell(content) {
  return `<div class="shell"><aside class="sidebar"><button class="brand" data-action="rooms">${brand}</button><nav aria-label="친구방 메뉴">${navButtons()}</nav><div><div class="row between"><p class="eyebrow">MY ROOMS</p>${!user.demo ? '<button class="icon-btn" data-action="create" aria-label="친구방 만들기">' + icon('plus') + '</button>' : ''}</div>${rooms.map(r => `<button class="room-nav ${room?.id === r.id ? 'active' : ''}" data-room="${r.id}">${esc(r.name)}</button>`).join('')}${!user.demo ? '<button class="room-nav" data-action="join">초대 코드로 참여</button>' : ''}</div><div class="side-bottom"><div class="side-note"><b>완벽한 일주일보다</b>다시 돌아오는 마음이<br>더 오래 갑니다. <span>✳</span></div><div class="row">${avatar(user)}<div class="user-name"><strong>${esc(user.name)}</strong><br><small>${user.demo ? '가상 체험 중' : '오늘도 나의 속도로'}</small></div><button class="icon-btn" data-action="logout" aria-label="로그아웃">${icon('logout')}</button></div></div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">나의 친구방 <span> / </span> <strong>${esc(room?.name || '작은 약속의 시작')}</strong></div><button class="brand mobile-brand" data-action="rooms">${brand}</button><div class="row"><span class="top-date">${dateLabel(room?.today || today)} ${weekday(room?.today || today)}요일 · 한국시간</span><button class="icon-btn" data-action="rules" aria-label="약속 규칙 보기">${icon('cards')}</button><button class="icon-btn" data-action="logout" aria-label="로그아웃">${icon('logout')}</button></div></header><main class="main">${syncError ? '<div class="stale-banner">새 기록을 불러오지 못했습니다. 연결이 돌아오면 다시 갱신합니다.</div>' : ''}${invite ? '<div class="join-banner row between"><span>친구가 보낸 초대장이 있어요.</span><button class="btn small primary" data-action="join-invite">초대받은 방 참여하기</button></div>' : ''}${room ? '<nav class="view-tabs" aria-label="모바일 친구방 메뉴">' + navButtons() + '</nav>' : ''}${room?.demo ? `<div class="demo-bar"><span><b>가상 체험</b> · 인물과 기록은 예시입니다. ${dateLabel(room.today)} 12:00</span><div class="row"><button class="btn small ghost" data-action="demo-day" ${room.season.status === 'finished' || archive() ? 'disabled' : ''}>하루 뒤 체험 →</button></div></div>` : ''}${content}</main></div></div>`;
}
function roomList() {
  return `<div class="page-title row between"><div><div class="eyebrow">A SMALL START</div><h1>우리의 작은 약속들</h1><p>함께할 친구들이 있으면 시작은 조금 쉬워져요.</p></div></div><div class="action-bar">${!user.demo ? '<button class="btn primary" data-action="create">' + icon('plus') + ' 친구방 만들기</button><button class="btn" data-action="join">초대 코드로 참여</button>' : ''}</div><div class="room-list" style="margin-top:25px">${rooms.map(r => `<button class="room-tile" data-room="${r.id}"><span class="badge">시즌 ${r.number}${r.demo ? ' · 가상 체험' : ''}</span><h3>${esc(r.name)}</h3><p>${dateLabel(r.start)}부터 7일 · 약속 4회</p></button>`).join('')}</div>${!rooms.length ? '<div class="empty" style="margin-top:25px">' + icon('people') + '<h3>함께할 첫 친구방을 만들어 보세요.</h3><p>방을 만든 뒤 초대 링크로 친구와 연결할 수 있어요.</p></div>' : ''}`;
}
function pageTitle() {
  const s = room.season, day = Math.min(7, Math.max(1, Math.floor((Date.parse(room.today) - Date.parse(s.start)) / 86400000) + 1));
  return `<div class="page-title row between"><div><div class="season-info"><span class="badge">${stateText[s.status]}</span><span>시즌 ${String(s.number).padStart(2, '0')} · ${dateLabel(s.start)} — ${dateLabel(add(s.start, 6))}</span></div><h1>${esc(room.name)}</h1><p>${s.status === 'active' ? '함께하는 ' + day + '일차. 오늘도 서로의 작은 실천을 응원해요.' : s.status === 'draft' ? '각자의 약속을 나누고, 같은 일주일을 준비해요.' : s.status === 'scheduled' ? dateLabel(s.start) + '에 함께 시작해요. 약속 카드가 잠겼습니다.' : '우리가 함께 지킨 약속과, 다음 주의 작은 다짐.'}</p></div>${room.invite ? '<button class="btn small" data-action="invite">' + icon('plus') + ' 친구 초대</button>' : ''}</div>${archive() ? '<div class="notice row between"><span>이전 시즌의 기록을 보고 있어요.</span><button class="text-btn" data-action="current">현재 시즌으로</button></div>' : ''}`;
}
function nextText(m) {
  const next = m.days.find(d => d.day >= room.today && d.status === 'planned');
  return next ? dateLabel(next.day) + '(' + weekday(next.day) + ') ' + m.goal.cutoff + '까지' : '이번 시즌의 약속이 모두 지나갔어요.';
}
function myCard() {
  const m = mine(), g = m?.goal, s = room.season.status;
  let title = g?.title || '어떤 작은 실천을 해볼까요?', description = s === 'draft' ? '정확한 행동과 실천할 4일을 정해 주세요.' : nextText(m), button = '';
  if (s === 'draft') button = '<button id="edit-promise" class="btn coral" data-action="goal">' + (g ? '내 약속 수정하기' : '내 약속 만들기') + icon('arrow') + '</button>';
  else if (s === 'active' && m.today === 'planned') { description = '오늘 ' + g.cutoff + '까지 · ' + (g.kind === 'timer' ? g.minutes + '분 타이머 + 실천 기록' : '실천 기록 한 줄'); button = '<button id="record-today" class="btn coral" data-action="record">' + (g.kind === 'timer' ? '시작하고 인증하기' : '오늘의 실천 남기기') + icon('arrow') + '</button>'; }
  else if (m.today === 'done') { description = '오늘의 약속을 지켰어요. 친구의 실천도 응원해 볼까요?'; }
  else if (m.today === 'missed') description = '오늘은 놓쳤지만, 다음 약속에서 다시 시작할 수 있어요.';
  else if (m.today === 'rest' && s === 'active') description = '오늘은 쉬는 날. 다음 약속은 ' + nextText(m);
  return `<article class="card my-card"><div class="row between"><span class="badge peach">MY LITTLE PROMISE</span><span class="badge ${m.today === 'done' ? '' : 'gray'}">${s === 'draft' ? '준비 중' : dayText[m.today]}</span></div><h3>${esc(title)}</h3><p class="description">${esc(description)}</p>${button}<div class="progress">${[0,1,2,3].map(i => '<span class="' + (i < m.count ? 'filled' : '') + '"></span>').join('')}</div><div class="progress-meta"><span>이번 주, 나와의 약속</span><span><b id="my-count">${m.count}</b> / 4회</span></div>${m.recovery ? '<p class="helper">놓친 뒤 다시 돌아왔어요. 회복의 한 걸음을 기록합니다.</p>' : ''}</article>`;
}
function feed() {
  if (!room.records.length) return '<div class="empty">' + icon('leaf') + '<h3>첫 실천이 모일 자리예요.</h3><p>약속을 지킨 순간을 한 줄로 남겨 보세요.</p></div>';
  return '<div class="feed">' + room.records.map(r => {
    const m = room.members.find(m => m.id === r.user), idx = room.members.indexOf(m), time = new Date(r.created + 9 * 3600000).toISOString().slice(11, 16);
    return `<article class="card feed-card ${r.status}" data-record="${r.id}"><div class="row between"><div class="row">${avatar(m, idx)}<div><strong>${esc(r.name)}</strong> <small>${r.user === user.id ? '나' : ''}</small><div class="feed-meta">${dateLabel(r.day)} · ${time}${room.demo ? ' · 가상 기록' : ''}</div></div></div><span class="badge ${r.status === 'pending' ? 'peach' : r.status === 'rejected' ? 'red' : ''}">${r.status === 'pending' ? '확인 필요' : r.status === 'rejected' ? '인정 안 됨' : '약속 완료'}</span></div><div class="feed-title">${esc(m.goal?.title)}</div><p class="feed-note">${esc(r.note)}</p>${r.seconds ? '<p class="helper">앱 타이머 ' + Math.floor(r.seconds / 60) + '분 · 수행 사실은 자기신고입니다.</p>' : ''}${r.reason ? '<p class="helper">확인 요청: ' + esc(r.reason) + '</p>' : ''}${r.decision ? '<p class="helper">검토 근거: ' + esc(r.decision) + '</p>' : ''}<div class="feed-footer">${r.reactions.map((reaction, i) => `<button class="reaction ${reaction.active ? 'active' : ''}" data-react="${esc(reaction.kind)}" data-id="${r.id}" aria-pressed="${reaction.active}" ${archive() ? 'disabled' : ''}>${['✓', '✳', '↗'][i]} ${esc(reaction.kind)}${reaction.count ? ' ' + reaction.count : ''}</button>`).join('')}${r.canResolve && !archive() ? '<button class="text-btn feed-tag" data-resolve="' + r.id + '">기준으로 검토</button>' : r.canReport && !archive() ? '<button class="text-btn feed-tag" data-report="' + r.id + '">확인 요청</button>' : ''}</div></article>`;
  }).join('') + '</div>';
}
function dashboard() {
  const m = mine(), due = m.goal && m.today === 'planned' && room.season.status === 'active', reminder = localStorage.getItem('promise-reminder-' + room.id) === 'on';
  const cutoff = due ? Date.parse(room.today + 'T' + m.goal.cutoff + ':00+09:00') - room.serverNow : Infinity;
  return pageTitle() + `<section class="hero"><div><p class="eyebrow">TOGETHER, A LITTLE BETTER</p><h2>서로 다른 목표,<br>같이 지키는 일주일.</h2><p>대단하지 않아도 괜찮아요.<br>오늘의 작은 실천이 모여 우리의 약속이 됩니다.</p></div><div class="hero-art" aria-hidden="true"><span class="floating-star">✳</span><div class="arch"></div><div class="arch second"></div><span class="art-caption">one day at a time</span></div></section>${due && reminder && cutoff <= Math.max(60, m.goal.minutes + 15) * 60000 ? '<div class="reminder">오늘의 약속을 시작할 시간이에요. ' + esc(m.goal.title) + ' · ' + m.goal.cutoff + ' 마감</div>' : ''}<div class="dashboard"><div class="primary-column"><section><div class="section-head"><h2>나의 오늘</h2><button class="text-btn" data-tab="promises">약속 카드 보기 ↗</button></div>${myCard()}</section><section><div class="section-head"><h2>함께 쌓은 순간들 <span>${room.records.length}</span></h2><span>친구방 안에서만 공유해요</span></div>${feed()}</section></div><aside class="secondary-column"><section class="card week-card"><h3>나의 7일</h3>${days(m)}<div class="week-legend"><span><i></i>완료</span><span><i class="rest"></i>쉬는 날</span><span>미달 − · 확인 ?</span></div></section><section class="card friends-card"><div class="section-head"><h3>친구들의 오늘</h3><span>${room.members.length}명</span></div><div class="friend-list">${room.members.map((f, i) => `<div class="friend">${avatar(f, i)}<div class="friend-info"><strong>${esc(f.name)} ${f.id === user.id ? '<small>나</small>' : ''}</strong><p>${esc(f.goal?.title || '약속을 준비하고 있어요')}</p></div><div class="friend-right"><span class="badge ${f.today === 'done' ? '' : 'gray'}">${room.season.status === 'draft' ? f.ready ? '준비 완료' : '준비 중' : dayText[f.today]}</span><small>${f.count}/4회</small></div></div>`).join('')}</div></section><section class="collective"><div class="mini-flowers" aria-hidden="true">✳ ✳ ✳</div><p>우리가 함께 지킨 약속</p><div class="big">${room.total}<span style="font-size:16px"> 번</span></div><p>작은 실천이 이만큼 모였어요.</p>${room.pending ? '<p>이 중 ' + room.pending + '건은 확인 중이에요.</p>' : ''}</section><section><label class="check"><input id="reminder" type="checkbox" ${reminder ? 'checked' : ''}>앱을 열어 둔 동안 마감 전 알림 보기</label><p class="helper">기본 60분 전 · 타이머 목표는 준비 시간도 고려해요.</p></section></aside></div>`;
}
function promisesPage() {
  const draft = room.season.status === 'draft', m = mine();
  return pageTitle() + `<div class="notice">공식 약속은 각자 4회 · 하루 1회 · 한국시간 기준 · 기록은 이 친구방에만 공개됩니다.</div><div class="promise-grid">${room.members.map(promiseCard).join('')}</div>${draft && !archive() ? `<div class="action-bar"><button class="btn" data-action="goal">${m.goal ? '내 약속 수정하기' : '내 약속 만들기'}</button><button id="ready" class="btn primary" data-action="ready" ${room.members.some(m => !m.goal) ? 'disabled' : ''}>${m.ready ? '준비 완료 취소' : '카드 확인하고 준비 완료'}</button>${room.owner === user.id ? '<button id="start-season" class="btn coral" data-action="start" ' + (!room.canStart ? 'disabled' : '') + '>모두 함께 시작하기</button><button class="text-btn" data-action="date">시작일 변경</button>' : ''}${room.demo ? '<button class="text-btn" data-action="demo-ready">가상 친구 준비 완료</button>' : ''}<p>누군가 약속을 수정하거나 새 친구가 오면 모두 다시 확인해요.</p></div>` : '<p class="helper" style="margin-top:20px">시즌이 시작되면 약속이 잠깁니다. 다음 시즌 준비 때 다시 바꿀 수 있어요.</p>'}`;
}
function resultsPage() {
  const s = room.season.status, ended = ['review', 'finished'].includes(s), m = mine();
  return pageTitle() + `<div class="row between" style="margin-bottom:18px"><h2>우리의 시즌 기록</h2><select class="history-select" id="history" aria-label="시즌 선택">${room.history.map(s => '<option value="' + s.id + '" ' + (s.id === room.season.id ? 'selected' : '') + '>시즌 ' + s.number + ' · ' + dateLabel(s.start) + '</option>').join('')}</select></div>${s === 'finished' ? `<section class="results-hero"><div class="eyebrow">EVERY PROMISE COUNTS</div><h2>함께 지킨 ${room.total}번의 약속.</h2><p>완주 ${room.rankings.filter(r => r.complete).length}명 · 각자의 속도로 채운 일주일</p></section><div class="ranks">${room.rankings.map(r => `<div class="rank-row"><span class="rank-number">${room.rankings.filter(x => x.rank === r.rank).length > 1 ? '공동 ' : ''}${r.rank}위</span>${avatar(r, room.members.findIndex(m => m.id === r.id))}<div><strong>${esc(r.name)}</strong><p class="helper">${r.count}/4회 ${r.complete ? '· 100% 완주' : '· 다음 약속에서 다시 만나요'}</p></div><span class="score">${r.score}<small>점</small></span></div>`).join('')}</div><p class="helper">약속 이행 순위 · 노력의 크기를 비교하지 않습니다. 같은 점수는 공동 순위예요.</p>` : '<div class="empty">' + icon('flag') + '<h3>' + (s === 'review' ? '마지막 기록까지 확인하고 있어요.' : '지금은 서로의 실천에 집중해요.') + '</h3><p>' + (s === 'review' ? dateLabel(add(room.season.start, 8)) + ' 00:00 이후, 남은 검토 ' + room.pending + '건이 끝나면 결과가 확정됩니다.' : '요일이 달라도 공평하게. 약속 이행 순위는 시즌이 끝난 뒤 공개됩니다.') + '</p></div>'}${ended ? `<section class="card" style="margin-top:22px"><div class="section-head"><h2>한 주를 돌아보며</h2>${!archive() ? '<button class="btn small" data-action="reflection">' + (m.reflection ? '내 회고 수정' : '내 회고 남기기') + '</button>' : ''}</div>${room.members.filter(m => m.reflection).map(m => '<div class="reflection"><strong>' + esc(m.name) + '</strong><p>' + esc(m.reflection) + '</p></div>').join('') || '<p class="muted">잘된 점 하나, 다음 주에 바꿔 볼 점 하나면 충분해요.</p>'}</section>` : ''}${s === 'finished' && !archive() && room.owner === user.id ? '<div class="action-bar"><p>목표는 이어 가고, 일정은 새롭게 준비해요.</p><button id="next-season" class="btn primary" data-action="next">다음 주도 함께하기 ' + icon('arrow') + '</button></div>' : ''}`;
}
function render() { app.innerHTML = !user ? auth() : shell(!room ? roomList() : tab === 'today' ? dashboard() : tab === 'promises' ? promisesPage() : resultsPage()); }
function modal(title, description, content, formId = '') {
  dialog.innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p>${description}</p></div><button class="icon-btn" data-action="close" aria-label="닫기">${icon('close')}</button></div>${formId ? '<form id="' + formId + '" class="form-grid">' : ''}${content}${formId ? '<p class="error" role="alert"></p></form>' : ''}`;
  if (!dialog.open) dialog.showModal();
}
const submitButton = label => '<button type="submit" class="btn primary wide">' + label + '</button>';
function showGoal() {
  const g = mine().goal || { title: '', proof: '', reason: '', days: [], cutoff: '23:00', kind: 'note', minutes: 30 };
  modal('이번 주, 나의 약속', '무엇을 하면 완료인지 친구들도 알 수 있게 적어 주세요.', `<label>실천할 행동<input name="title" required minlength="2" maxlength="80" value="${esc(g.title)}" placeholder="예: 전공 문제 10개 풀기"></label><div><label>실천할 날짜 · 4일 선택</label><div class="day-select" style="margin-top:9px">${Array.from({ length: 7 }, (_, i) => { const d = add(room.season.start, i); return `<label class="day-option"><input type="checkbox" name="days" value="${i}" ${g.days.includes(i) ? 'checked' : ''}><span>${weekday(d)}<b>${dateLabel(d)}</b></span></label>`; }).join('')}</div></div><div class="form-row"><label>마감 시각 · 한국시간<input name="cutoff" type="time" required value="${g.cutoff}"></label><label>인증 방법<select name="kind"><option value="note" ${g.kind === 'note' ? 'selected' : ''}>실천 기록 한 줄</option><option value="timer" ${g.kind === 'timer' ? 'selected' : ''}>앱 타이머 + 실천 기록</option></select></label></div><label id="minutes-label" ${g.kind !== 'timer' ? 'hidden' : ''}>누적 타이머 시간 · 분<input type="number" name="minutes" min="1" max="240" value="${g.minutes || 30}"></label><label>완료 조건<textarea name="proof" required minlength="4" maxlength="240" placeholder="예: 푼 문제 번호와 배운 내용을 한 줄로 제출">${esc(g.proof)}</textarea></label><label>이 약속을 고른 이유 <small>선택</small><input name="reason" maxlength="240" value="${esc(g.reason)}" placeholder="친구들에게 들려주고 싶은 만큼만"></label><p class="helper">실천 기록은 자기신고입니다. 타이머는 경과 시간을 확인하며 실제 집중·수면 여부를 판정하지 않습니다.</p>${submitButton('약속 카드 저장')}`, 'goal-form');
}
function showRecord() {
  const m = mine(), g = m.goal;
  modal('오늘의 실천을 남겨요', g.title, `<div class="notice"><b>함께 정한 완료 조건</b><br>${esc(g.proof)}<br><small>오늘 ${g.cutoff}까지 · 한국시간</small></div>${g.kind === 'timer' ? '<div class="timer-box"><p>목표 ' + g.minutes + '분 · 오늘 누적</p><div class="timer-display" id="timer-display"></div><button type="button" class="btn small" data-action="timer" id="timer-toggle">' + (room.timer.running ? '일시정지' : '타이머 시작') + '</button><p>창을 닫아도 흐른 시간을 기록합니다.</p></div>' : ''}<label>어떻게 실천했나요?<textarea id="record-note" name="note" required minlength="4" maxlength="800" placeholder="한 줄이면 충분해요. 실천한 내용을 남겨 주세요."></textarea></label><label class="check"><input name="honest" type="checkbox" required>약속 카드의 조건대로 실천했어요. 이 기록을 친구방에 공유합니다.</label>${submitButton('오늘의 약속 인증하기')}`, 'record-form');
  updateTimer();
}
function updateTimer() {
  if (!$('#timer-display') || !room) return;
  const elapsed = room.timer.elapsed + (room.timer.running && !room.demo ? Math.floor((Date.now() - fetchedAt) / 1000) : 0);
  $('#timer-display').textContent = String(Math.floor(elapsed / 60)).padStart(2, '0') + ':' + String(elapsed % 60).padStart(2, '0');
}
const rules = '<ol class="rule-list"><li><div><b>7일, 1목표, 4번의 약속</b>2~10명이 함께해요. 각자 선택한 4일에 하루 최대 한 번, 한국시간 마감 전까지 인증합니다.</div></li><li><div><b>시작 전에 모두 확인해요</b>목표·일정·조건 변경이나 새 친구 참여 시 전원의 준비 완료가 해제돼요. 시작 후에는 잠깁니다.</div></li><li><div><b>기록은 신뢰를 바탕으로</b>실천한 내용과 선택한 앱 타이머를 공유해요. 실제 수행을 자동으로 증명하거나 사진으로 판정하지 않습니다.</div></li><li><div><b>확인 요청과 실패는 달라요</b>다른 친구 인증에 제출 후 24시간 이내 확인을 요청할 수 있어요. 방장이 잠긴 기준으로 검토하고, 방장 본인의 인증은 다른 참여자가 검토합니다. 검토 전에는 점수를 깎지 않습니다.</div></li><li><div><b>지나간 약속은 되돌리지 않아요</b>미달은 0점, 다음 약속은 그대로 25점이에요. 종료 후 24시간과 미해결 검토가 끝나면 공동 순위와 완주를 구분해 보여 드립니다.</div></li><li><div><b>다음 주도 함께하기</b>친구와 지난 기록을 유지하고 새 시즌을 준비합니다. 실제 친구방에 가상의 참가자를 추가하지 않습니다.</div></li></ol>';
async function action(name) {
  if (name === 'close') return dialog.close();
  if (name === 'rooms') { room = null; render(); return; }
  if (name === 'logout') { await api('/logout', {}); user = null; room = null; rooms = []; dialog.close(); render(); return; }
  if (name === 'rules') return modal('우리의 공통 약속', '좋아요와 인증 속도는 점수에 영향을 주지 않아요.', rules);
  if (name === 'create') return modal('함께할 친구방 만들기', '친구방은 초대받은 친구들만 볼 수 있어요.', '<label>친구방 이름<input name="name" required minlength="2" maxlength="50" placeholder="예: 조금씩, 꾸준히"></label><label>시즌 시작일<input type="date" name="start" required min="' + today + '" value="' + today + '"></label><p class="helper">시작일부터 7일. 방장이 시작하기 전까지 약속을 준비합니다.</p>' + submitButton('친구방 만들기'), 'create-form');
  if (name === 'join') return modal('친구의 초대장', '초대 링크 또는 64자리 초대 코드를 붙여 넣어 주세요.', '<label>초대 링크 또는 코드<input name="invite" required></label>' + submitButton('친구방 참여하기'), 'join-form');
  if (name === 'join-invite') { const r = await api('/join', { invite }); invite = ''; history.replaceState({}, '', '/'); setRoom(r.room); await refreshRooms(); tab = 'promises'; render(); return; }
  if (name === 'goal') return showGoal();
  if (name === 'record') return showRecord();
  if (name === 'ready') {
    if (mine().ready) { await mutate('ready', { ready: false, version: room.season.version }); return; }
    return modal('서로의 약속을 확인해 주세요', '이 카드의 일정과 조건으로 일주일을 함께합니다.', '<div class="promise-grid">' + room.members.map(promiseCard).join('') + '</div><label class="check"><input name="agree" required type="checkbox">모든 친구의 약속과 공통 규칙을 확인했어요.</label><input type="hidden" name="version" value="' + room.season.version + '">' + submitButton('준비 완료'), 'ready-form');
  }
  if (name === 'start') return modal('같은 일주일을 시작해요', '시작하면 약속과 일정이 잠깁니다.', '<div class="notice">' + dateLabel(room.season.start) + '부터 ' + dateLabel(add(room.season.start, 6)) + '까지 · 각자 4회<br>모두의 준비가 완료됐어요.</div>' + submitButton('약속 잠그고 시작'), 'start-form');
  if (name === 'date' || name === 'next') return modal(name === 'next' ? '다음 주도 함께하기' : '시작일 다시 정하기', name === 'next' ? '기존 목표를 가져옵니다. 일정을 바꾸고 모두 다시 확인해 주세요.' : '날짜가 바뀌면 전원의 준비 완료가 해제됩니다.', '<label>시작일<input name="start" type="date" required min="' + room.today + '" value="' + room.today + '"></label>' + submitButton(name === 'next' ? '새 시즌 준비하기' : '시작일 변경'), name + '-form');
  if (name === 'invite') return showInvite();
  if (name === 'copy') { try { await navigator.clipboard.writeText($('#invite-link').value); notify('초대 링크를 복사했어요.'); } catch { $('#invite-link').select(); notify('링크를 선택했어요. 복사해서 공유해 주세요.'); } return; }
  if (name === 'rotate') { await mutate('rotate-invite'); showInvite(); notify('이전 초대 링크가 무효화됐어요.'); return; }
  if (name === 'timer') {
    const note = $('#record-note').value, honest = dialog.querySelector('[name=honest]').checked;
    await mutate('timer', { running: !room.timer.running }); showRecord(); $('#record-note').value = note; dialog.querySelector('[name=honest]').checked = honest; return;
  }
  if (name === 'demo-day' || name === 'demo-ready') { await mutate(name); notify(name === 'demo-day' ? '가상 체험의 날짜를 하루 이동했어요.' : '가상 친구들이 준비됐어요.'); return; }
  if (name === 'reflection') return modal('한 주를 돌아보며', '잘된 점과 다음 주에 바꾸고 싶은 점을 적어 보세요.', '<label>나의 회고<textarea name="reflection" required minlength="4" maxlength="800">' + esc(mine().reflection) + '</textarea></label>' + submitButton('회고 저장'), 'reflection-form');
  if (name === 'current') { historyId = ''; setRoom((await api('/rooms/' + room.id)).room); render(); }
}
function showInvite() {
  modal('친구와 함께 시작해요', '링크를 받은 친구가 로그인하고 참여할 수 있어요.', '<label>초대 링크<input class="copy-input" id="invite-link" readonly value="' + esc(location.origin + '/?invite=' + room.invite) + '"></label><div class="dialog-actions"><button class="text-btn" data-action="rotate">링크 재발급</button><button class="btn primary" data-action="copy">' + icon('copy') + ' 링크 복사</button></div><p class="helper">현재 로컬 주소는 이 PC에서만 열립니다. 인터넷에서 친구와 사용하려면 서버 배포가 필요합니다.</p>');
}
function reportModal(id, resolve = false) {
  const record = room.records.find(r => r.id === id), member = room.members.find(m => m.id === record.user);
  modal(resolve ? '약속 기준으로 검토하기' : '함께 확인해 주세요', '확인 요청만으로 점수가 차감되지는 않습니다.', '<div class="notice"><b>잠긴 완료 조건</b><br>' + esc(member.goal.proof) + '<br><b>제출 기록</b><br>' + esc(record.note) + (record.reason ? '<br>요청 이유: ' + esc(record.reason) : '') + '</div><input type="hidden" name="recordId" value="' + id + '">' + (resolve ? '<label>검토 결과<select name="decision"><option value="accepted">조건 충족 · 인정</option><option value="rejected">조건 미충족 · 인정 안 됨</option></select></label>' : '') + '<label>' + (resolve ? '판정 근거' : '확인이 필요한 이유') + '<textarea name="reason" required minlength="4" maxlength="400"></textarea></label>' + submitButton(resolve ? '검토 결과 저장' : '확인 요청 보내기'), resolve ? 'resolve-form' : 'report-form');
}
document.addEventListener('click', async event => {
  const b = event.target.closest('button'); if (!b || b.disabled || busy) return;
  try {
    busy = true;
    if (b.dataset.auth) { authTab = b.dataset.auth; render(); }
    else if (b.id === 'demo') { b.disabled = true; const result = await api('/demo', {}); user = result.user; setRoom(result.room); tab = 'today'; await refreshRooms(); render(); }
    else if (b.dataset.tab) { if (!room) { notify('먼저 친구방을 선택해 주세요.'); return; } tab = b.dataset.tab; render(); }
    else if (b.dataset.room) await openRoom(b.dataset.room);
    else if (b.dataset.action) await action(b.dataset.action);
    else if (b.dataset.react) await mutate('react', { recordId: b.dataset.id, kind: b.dataset.react });
    else if (b.dataset.report) reportModal(b.dataset.report);
    else if (b.dataset.resolve) reportModal(b.dataset.resolve, true);
  } catch (e) { notify(e.message); } finally { busy = false; b.disabled = false; }
});
document.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return;
  const form = event.target, values = new FormData(form), data = Object.fromEntries(values), button = form.querySelector('[type=submit]'), error = form.querySelector('.error');
  try {
    busy = true; if (button) button.disabled = true; if (error) error.textContent = '';
    if (form.id === 'auth-form') { user = (await api(authTab === 'register' ? '/register' : '/login', data)).user; await refreshRooms(); room = null; if (rooms.some(r => r.id === lastRoom)) setRoom((await api('/rooms/' + lastRoom)).room); render(); return; }
    if (form.id === 'create-form') { setRoom((await api('/rooms', data)).room); await refreshRooms(); tab = 'promises'; }
    else if (form.id === 'join-form') { const code = data.invite.includes('://') ? new URL(data.invite).searchParams.get('invite') : data.invite.trim(); setRoom((await api('/join', { invite: code })).room); invite = ''; history.replaceState({}, '', '/'); await refreshRooms(); tab = 'promises'; }
    else if (form.id === 'goal-form') { await mutate('goal', { ...data, days: values.getAll('days').map(Number), minutes: Number(data.minutes) }); tab = 'promises'; notify('약속을 저장했어요. 친구들과 다시 확인해 주세요.'); }
    else if (form.id === 'ready-form') { await mutate('ready', { version: Number(data.version), ready: true }); notify('준비 완료! 친구들의 약속을 응원해요.'); }
    else if (form.id === 'start-form') { await mutate('start'); tab = 'today'; notify('우리의 일주일이 시작됐어요.'); }
    else if (form.id === 'record-form') { await mutate('record', { note: data.note }); notify('오늘의 약속을 남겼어요. 작은 실천 하나 더!'); }
    else if (form.id === 'date-form') { await mutate('date', data); await refreshRooms(); }
    else if (form.id === 'next-form') { await mutate('next', data); await refreshRooms(); tab = 'promises'; }
    else if (form.id === 'reflection-form') { await mutate('reflection', data); notify('이번 주의 마음을 저장했어요.'); }
    else if (form.id === 'report-form' || form.id === 'resolve-form') { await mutate(form.id.split('-')[0], data); notify('기록을 업데이트했어요.'); }
    dialog.close(); render();
  } catch (e) { if (error) error.textContent = e.message; else notify(e.message); }
  finally { busy = false; if (button) button.disabled = false; }
});
document.addEventListener('change', async event => {
  if (event.target.name === 'kind') $('#minutes-label').hidden = event.target.value !== 'timer';
  if (event.target.id === 'reminder') localStorage.setItem('promise-reminder-' + room.id, event.target.checked ? 'on' : 'off');
  if (event.target.id === 'history') { try { historyId = event.target.value; setRoom((await api('/rooms/' + room.id + '?season=' + historyId)).room); render(); } catch (e) { notify(e.message); } }
});
dialog.addEventListener('click', event => { if (event.target === dialog) { const r = dialog.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close(); } });
async function poll() {
  if (!user || !room || dialog.open || busy || document.hidden) return;
  const roomId = room.id, seasonId = historyId;
  try {
    const value = await api('/rooms/' + roomId + (seasonId ? '?season=' + seasonId : ''));
    if (room?.id === roomId && historyId === seasonId && !dialog.open && !busy) { setRoom(value.room); render(); }
  } catch { syncError = true; if (!dialog.open) render(); }
}
setInterval(poll, 5000); setInterval(updateTimer, 1000);
window.addEventListener('focus', poll);
try {
  const me = await api('/me'); user = me.user; today = me.today;
  if (user) { await refreshRooms(); if (rooms.some(r => r.id === lastRoom)) setRoom((await api('/rooms/' + lastRoom)).room); }
  render();
} catch { app.innerHTML = '<main class="empty"><h2>서버에 연결하지 못했어요.</h2><p>앱을 실행한 뒤 페이지를 새로고침해 주세요.</p></main>'; }
