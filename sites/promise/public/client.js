const $ = q => document.querySelector(q), app = $('#app'), modal = $('#modal');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const state = { user: null, rooms: [], room: null, tab: 'today', season: null, demo: false, signInUrl: '/signin-with-chatgpt?return_to=%2F', signOutUrl: '/signout-with-chatgpt?return_to=%2F', busy: false, offline: false };
const dayKey = ms => new Date(ms + 32400000).toISOString().slice(0, 10);
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const dateLabel = day => new Intl.DateTimeFormat('ko', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' }).format(new Date(day + 'T12:00:00+09:00'));
const weekday = day => ['일','월','화','수','목','금','토'][new Date(day + 'T12:00:00+09:00').getUTCDay()];
const timeLabel = ms => new Intl.DateTimeFormat('ko', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' }).format(ms);
const current = () => state.room?.seasons.at(-1);
const selected = () => state.room?.seasons.find(s => s.id === Number(state.season)) || current();
const mine = s => s?.people.find(p => p.id === state.user?.id);
const statusLabel = { rest: '쉬는 날', planned: '예정', done: '완료', missed: '미달', pending: '확인 중' };
const phaseLabel = { draft: '함께 준비 중', scheduled: '시작을 기다려요', active: '진행 중', review: '인증 검토 중', finished: '결과 확정' };
const btn = (label, action, extra = '', cls = '') => `<button type="button" data-action="${action}" ${extra} class="${cls}">${label}</button>`;
const brand = '<a href="/" class="brand"><img src="/icon.svg" alt="">우리의 약속<span class="small muted">.</span></a>';
const avatar = (name, index = 0) => `<span class="avatar" style="background:${['#e2e7da','#ece5d7','#e1e7f1','#eee1e7'][index % 4]}">${esc((name || '?').slice(0,1))}</span>`;
function toast(message) { $('#toast').textContent = message; $('#toast').classList.add('visible'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('visible'), 4500); }
async function api(path, data) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch('/api' + path, { method: data === undefined ? 'GET' : 'POST', headers: data === undefined ? {} : { 'Content-Type': 'application/json' }, body: data === undefined ? undefined : JSON.stringify(data), signal: controller.signal });
    let result; try { result = await response.json(); } catch { throw new Error('응답을 읽지 못했습니다. 잠시 후 다시 시도해 주세요.'); }
    if (!response.ok) throw new Error(result.error || '요청을 처리하지 못했습니다.');
    return result;
  } catch (e) { if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('연결이 불안정합니다. 입력은 유지됩니다. 잠시 후 다시 시도해 주세요.'); throw e; }
  finally { clearTimeout(timeout); }
}
function dialog(title, body) {
  modal.innerHTML = `<div class="dialog-head"><h2 id="modal-title">${title}</h2>${btn('✕','close','aria-label="닫기"','plain')}</div>${body}`;
  if (!modal.open) modal.showModal();
}
const field = (label, name, value = '', attrs = '') => `<label>${label}<input name="${name}" value="${esc(value)}" ${attrs}></label>`;
const submit = label => `<p class="form-error" role="alert"></p><button class="primary" type="submit">${label}</button>`;
const form = (name, content) => `<form data-form="${name}">${content}</form>`;
function week(p) {
  return `<div class="week">${p.days.map(d => `<div class="day ${d.status} ${d.day === state.room.today ? 'today' : ''}" title="${d.day} ${statusLabel[d.status]}"><span>${weekday(d.day)}</span><i aria-label="${d.day} ${statusLabel[d.status]}">${({ rest: '—', planned: '·', done: '✓', missed: '×', pending: '?' })[d.status]}</i></div>`).join('')}</div>`;
}
function welcome() {
  return `<div class="welcome"><header class="row between">${brand}<a class="button" href="${esc(state.signInUrl)}">로그인 ↗</a></header><main id="main"><div class="intro"><section><div class="eyebrow">A WEEK, TOGETHER</div><h1>미루지 못할 이유,<br><em>함께 걸어두세요.</em></h1><p class="lead">미션을 못 지키면 정해 둔 벌칙,<br>끝까지 해낸 친구에게는 상금.<br>사진으로 인증하고, 약속한 조건은 확실하게.</p><div class="actions"><a class="button primary" href="${esc(state.signInUrl)}">우리의 첫 약속 시작하기 ↗</a>${btn('먼저 둘러보기','demo','','plain')}</div><p class="small muted">ChatGPT 계정으로 시작해요 · 친구 초대형</p></section><section class="sample" aria-label="친구방 화면 예시"><div class="sample-head row between"><div><div class="eyebrow muted">EXAMPLE · 03 / 07</div><h2 style="margin-top:10px">친구들의 오늘</h2></div><span class="pill lime">사진 인증 · 실패 트리거</span></div>${[['민지','전공 공부 30분','완료 ✓'],['준호','퇴근 후 산책 20분','21:00 예정'],['서연','잠들기 전 책 읽기','쉬는 날']].map((x,i)=>`<div class="friend-line"><div class="row">${avatar(x[0],i)}<div><div class="friend-name">${x[0]}</div><div class="friend-goal">${x[1]}</div></div></div><span class="small">${x[2]}</span></div>`).join('')}<div class="sample-footer">“오늘은 한 정거장 더 걸었어.”<p class="muted small">오늘 미달하면 · 다음 모임 준비하기</p></div></section></div><section class="rules"><div><span>01 / PROMISE</span><strong>미션 4번, 사진으로 인증</strong><p>7일 동안 무엇을 할지 정하고<br>마감 전에 사진 한 장을 남겨요.</p></div><div><span>02 / TOGETHER</span><strong>실패했을 때의 조건부터</strong><p>벌칙 또는 완주 상금.<br>시작 전에 모두 동의하고 잠가요.</p></div><div><span>03 / AGAIN</span><strong>결과에 따라 실행하기</strong><p>미달과 완주 결과를 확인하고<br>벌칙 이행·상금 수령까지 기록해요.</p></div></section></main><footer><span>우리의 약속 · 함께 지키는 7일</span>${btn('이용 안내 · 개인정보','privacy','','plain small')}<span>한국시간 기준</span></footer></div>`;
}
function render() {
  const active=document.activeElement, data=active?.dataset?.action?{...active.dataset}:null, id=active?.id;
  renderPage();
  if(active?.isConnected)return;
  const replacement=data?[...document.querySelectorAll('[data-action]')].find(el=>el.getClientRects().length && Object.entries(data).every(([k,v])=>el.dataset[k]===v)):id?document.getElementById(id):null;
  replacement?.focus({preventScroll:true});
}
function renderPage() {
  if (!state.user) { app.innerHTML = welcome(); return; }
  const r = state.room, s = selected();
  app.innerHTML = `${state.demo ? '<div class="demo-banner"><span>둘러보기 · 예시 데이터이며 저장되지 않습니다.</span>' + btn('나가서 시작하기','exit-demo','','primary') + '</div>' : ''}${state.offline ? '<div class="offline" role="status">연결을 확인하고 있습니다. 마지막으로 받은 화면을 표시합니다.</div>' : ''}<div class="shell"><aside class="rail">${brand}<div><p class="label">OUR SMALL CIRCLES</p><nav class="rooms" aria-label="내 친구방">${state.rooms.map(x => `<button data-action="room" data-id="${x.id}" class="${r?.id === x.id ? 'selected' : ''}"><span class="room-letter">${esc(x.name.slice(0,1))}</span><span class="room-name">${esc(x.name)}</span>${x.archived ? '⌁' : ''}</button>`).join('')}</nav></div><div class="stack">${btn('＋ 새 친구방','create','','plain')}${btn('초대 코드로 참여','join','','plain small')}</div><div class="rail-bottom">${btn(avatar(state.user.name) + '<span>' + esc(state.user.name) + '</span>','account','','profile-button')}<p class="small muted">작은 실천, 함께 쌓는 일주일.</p></div></aside><div class="workspace"><header class="topbar"><span class="roomtitle">${esc(r?.name || '우리의 친구방')}</span><div class="mobile-brand">${brand}</div><div class="row"><span class="live">${state.demo ? '둘러보기' : '친구방 내부 공개'}</span>${btn('알림','notifications','','plain small')}${r ? btn('친구 초대 ↗','invite','','small') : btn('새 친구방','create','','small')}</div></header><main id="main" class="content">${r && s ? roomContent(s) : emptyHome()}</main></div></div><nav class="mobile-nav" aria-label="주요 메뉴">${[['◉','오늘','today'],['☷','미션·조건','promises'],['▤','결과·정산','results'],['⚙','설정','settings']].map(([icon,label,tab])=>`<button data-action="tab" data-tab="${tab}" class="${state.tab === tab ? 'active' : ''}" aria-current="${state.tab===tab?'page':'false'}"><span class="nav-icon" aria-hidden="true">${icon}</span>${label}</button>`).join('')}${btn('<span class="nav-icon">⊞</span>친구방','room-list')}</nav>`;
}
function emptyHome() {
  return `<div class="page-title"><div><div class="eyebrow muted">YOUR FIRST WEEK</div><h1>${esc(state.user.name)}님, 누구와 함께할까요?</h1></div></div><div class="empty"><h2>첫 약속은 함께할 사람부터.</h2><p>친구방을 만들고 초대 링크를 보내세요.<br>각자 약속을 정한 뒤 모두 준비되면 시작합니다.</p><div class="row wrap" style="justify-content:center">${btn('새 친구방 만들기','create','','primary')}${btn('초대 코드로 참여','join')}</div></div><p class="small muted">7일 동안 4회 · 방당 2~10명 · 시작 전 전원 동의</p>${btn('내 계정 설정','account','','plain')}`;
}
function roomContent(s) {
  const r = state.room, day = Math.min(7, Math.max(1, Math.floor((Date.parse(r.today) - Date.parse(s.start)) / 86400000) + 1));
  return `<div class="page-title"><div><div class="eyebrow muted">WEEK ${String(s.id).padStart(2,'0')} / ${esc(r.name)}</div><h1>${({ today: '우리의 오늘', promises: '미션과 실패 조건', results: '결과와 이행 확인', settings: '우리 방 관리' })[state.tab]}</h1></div><div style="text-align:right"><span class="pill ${s.phase === 'active' ? 'lime' : ''}">${phaseLabel[s.phase]}</span><p class="date">${s.phase === 'active' ? day + '일차 · ' : ''}${dateLabel(r.today)}</p></div></div><nav class="tabs" aria-label="친구방 메뉴">${[['today','오늘'],['promises','미션·조건'],['results','결과·정산'],['settings','방 관리']].map(([tab,label])=>`<button data-action="tab" data-tab="${tab}" class="${state.tab===tab?'active':''}" aria-current="${state.tab===tab?'page':'false'}">${label}</button>`).join('')}</nav>${state.tab==='today'?todayView(s):state.tab==='promises'?promiseView(s):state.tab==='results'?resultsView(s):settingsView(s)}`;
}
function promiseProgress(p) {
  const due=p.days.filter(d=>d.day<=state.room.today && d.status!=='rest'), done=due.filter(d=>['done','pending'].includes(d.status)).length;
  const next=p.nextPromise || p.days.find(d=>d.day>=state.room.today && d.status==='planned')?.day;
  return `<div class="promise-progress"><p>오늘까지 예정 ${p.dueCount ?? due.length}회 중 ${p.dueDone ?? done}회 이행 · 이번 주 ${p.count}/4</p><p class="muted">${next?'다음 약속 · '+dateLabel(next)+' '+esc(p.goal.cutoff)+'까지':'이번 시즌에 남은 예정 약속이 없어요.'}</p>${p.recovered?'<p class="recovery-note">다시 이어갔어요 · 미달 뒤 다음 약속을 지켰습니다. 가산점은 없어요.</p>':''}</div>`;
}
function todayView(s) {
  const r = state.room, me = mine(s), today = me?.days.find(d => d.day === r.today), historical = s.id !== current().id;
  let action;
  if (historical) action = '<p>이전 시즌의 기록을 보고 있습니다.</p>' + btn('이번 시즌으로','latest','','primary');
  else if (r.archived) action = '<p>보관된 친구방입니다. 방 관리에서 다시 열 수 있어요.</p>';
  else if (s.phase === 'draft') action = `<div class="eyebrow">BEFORE WE START</div><h2>${me?.goal ? '서로의 약속을 확인해요.' : '이번 주, 무엇을 지킬까요?'}</h2><p class="small muted">${s.people.filter(p=>p.ready).length}/${s.people.length}명 준비 완료 · ${dateLabel(s.start)} 시작</p>${btn(me?.goal?'약속 확인하러 가기':'내 약속 정하기',me?.goal?'show-promises':'goal','','primary')}`;
  else if (s.phase === 'scheduled') action = `<div class="eyebrow">COMING SOON</div><h2>${dateLabel(s.start)}에 만나요.</h2><p class="muted small">약속이 잠겼어요. 시작일이 되면 인증할 수 있습니다.</p>${btn('내 일정 캘린더에 담기','calendar','','primary')}`;
  else if (s.phase === 'review' || s.phase === 'finished') action = `<div class="eyebrow">OUR WEEK</div><h2>일주일을 함께 보냈어요.</h2><p class="small muted">${s.phase==='review'?'이의 제기 기간과 필요한 검토가 끝나면 결과가 확정됩니다.':'잘한 일과 다음 주에 바꿀 일을 돌아보세요.'}</p>${btn('결과와 회고 보기','show-results','','primary')}`;
  else if (!me?.goal) action = '<p>이 시즌의 참여 약속이 없습니다.</p>';
  else {
    const done = today?.status === 'done', planned = today?.status === 'planned', timer = s.timers[state.user.id + ':' + r.today];
    action = `<div class="row between"><span class="eyebrow">MY PROMISE / TODAY</span><span class="pill ${done?'lime':''}">${statusLabel[today?.status || 'rest']}</span></div><h2>${esc(me.goal.title)}</h2><p class="small muted">${planned ? esc(me.goal.cutoff)+'까지 · ' : ''}${esc(me.goal.proof)}</p>${week(me)}${promiseProgress(me)}${planned ? (me.goal.kind === 'timer' && !timer ? btn('타이머 시작 · ' + me.goal.minutes + '분','timer','','primary') : `${timer ? '<p class="small" id="timer-count" data-start="'+timer+'" data-minutes="'+me.goal.minutes+'">타이머가 진행 중입니다.</p>' : ''}${btn('사진으로 미션 인증 ↗','record','','primary')}`) : `<p class="small">${done?'오늘의 약속을 지켰어요. 친구에게도 응원을 보내볼까요?':today?.status==='missed'?'오늘은 놓쳤지만, 다음 약속은 그대로 기다려요.':today?.status==='pending'?'확인 중인 인증이 있어요. 피드에서 진행 상황을 확인하세요.':'오늘은 쉬는 날. 친구들의 실천을 둘러보세요.'}</p>`}`;
  }
  return `${triggerPanel(s)}<div class="columns"><section><div class="people-strip" aria-label="친구들의 오늘">${s.people.map((p,i)=>{const status=p.days.find(d=>d.day===r.today)?.status||'rest';return `<div class="person ${status}">${avatar(p.name,i)}<span class="person-name">${esc(p.name)}${p.id===state.user.id?' · 나':''}</span><span class="person-status">${statusLabel[status]}${status==='planned' && p.goal?' · '+esc(p.goal.cutoff):''}</span><span class="person-progress">이번 주 ${p.count}/4</span>${p.canNudge && !historical?btn('같이 하자','nudge',`data-member="${p.id}" aria-label="${esc(p.name)}님에게 약속 알림 보내기"`,'plain nudge'):''}</div>`;}).join('')}</div><section class="my-action">${action}${!historical && !r.archived && s.phase==='active'?btn('추가 실천 남기기 · 점수 제외','extra','','plain extra-action'):''}</section><div class="feed-heading"><h2>친구들의 실천</h2><span class="small muted">${s.records.length}개의 순간</span></div>${s.records.length ? [...s.records].reverse().map(r=>feedItem(r,s)).join('') : '<div class="empty" style="border:0"><h3>첫 번째 실천을 기다려요.</h3><p>오늘 무엇을 했는지 짧게 남겨요. 공식 미션은 사진 1장이 필수예요.</p></div>'}</section><aside class="side-notes"><div class="aside-block"><div class="aside-title"><h3>이번 주의 약속</h3><span class="small">각자 4번</span></div><p class="muted">${dateLabel(s.start)} — ${dateLabel(addDays(s.start,6))}</p>${s.people.map((p,i)=>`<div class="friend-line"><div><div class="friend-name">${esc(p.name)}</div><div class="friend-goal">${esc(p.goal?.title || '약속을 정하는 중')}</div></div><span class="count">${p.count}<small> / 4</small></span></div>`).join('')}</div><div class="aside-block"><div class="eyebrow">A NOTE TO OURSELVES</div><p>한 번 놓쳤다고<br>일주일이 사라지진 않으니까.</p><p class="muted">순위는 마지막에 확인해요.<br>지금은 오늘의 실천에 집중해요.</p></div><div class="aside-block">${btn('약속 일정 내보내기','calendar','','plain small')}<p class="muted">알람을 포함한 캘린더 파일.<br>앱을 닫아도 일정을 기억할 수 있게.</p></div></aside></div>`;
}
function feedItem(r,s) {
  const author = s.people.find(p=>p.id===r.userId), canReview = r.status==='pending' && r.userId!==state.user.id && r.report?.by!==state.user.id && (state.room.ownerId===state.user.id || r.userId===state.room.ownerId || r.report?.by===state.room.ownerId);
  const live = s.id === current().id && !state.room.archived;
  return `<article class="feed-item"><div class="feed-meta">${avatar(author?.name || '?')}<div class="meta"><strong class="small">${esc(author?.name || '탈퇴한 친구')}</strong><div class="note-meta">${dateLabel(r.day)} · ${timeLabel(r.at)}</div></div><span class="pill ${r.status==='accepted'?'lime':r.status==='pending'?'warn':'red'}">${r.extra?'추가 실천 · 점수 제외':({accepted:'약속 완료',pending:'확인 필요',rejected:'미인정'})[r.status]}</span></div><p class="record-goal">${esc(author?.goal?.title)}${r.minutes?' · '+r.minutes+'분 타이머':''}</p><p class="note">${esc(r.note)}</p>${r.photoId?`<figure class="proof-photo"><img src="/api/rooms/${state.room.id}/photo/${r.photoId}" alt="${esc(author?.name || '친구')}의 실천 사진" loading="lazy"><figcaption>친구방 참여자에게만 공개${r.userId===state.user.id?` · <a href="/api/rooms/${state.room.id}/photo/${r.photoId}" download="실천-사진.jpg">사진 저장</a>`:''}</figcaption></figure>`:''}${r.report?'<p class="small muted">이의 제기: '+esc(r.report.reason)+'</p>':''}${r.review?'<p class="small muted">처리: '+esc(r.review.reason)+'</p>':''}<div class="reactions">${['봤어요','잘했어요','같이 하자'].map((x,i)=>btn(['○','✦','↗'][i]+' '+x+' '+Object.values(r.reactions).filter(y=>y===x).length,'react',`data-record="${r.id}" data-reaction="${x}" ${live?'':'disabled'}`,r.reactions[state.user.id]===x?'chosen':'')).join('')}${live && !r.extra && r.userId!==state.user.id && !r.report && state.room.now<=r.at+86400000?btn('이의 제기','report',`data-record="${r.id}"`,'plain'):''}${live && canReview?btn('판정하기','review',`data-record="${r.id}"`):''}</div></article>`;
}
const money=value=>new Intl.NumberFormat('ko-KR').format(value)+'원';
function triggerSummary(s) {
  const t=s.trigger;
  return !t?'실패했을 때 실행할 조건을 정해 주세요.':t.mode==='penalty'?(t.when==='each-miss'?'미달 1회마다':'이번 주 4회 미완주 시')+' · '+t.task:'미완주자 1인당 '+money(t.amount)+' → 완주자에게 균등 분배';
}
function triggerPanel(s,details=false) {
  const t=s.trigger,o=s.triggerOutcome || {state:s.started?'legacy':'draft',items:[]},live=s.id===current().id;
  const names=id=>esc(s.people.find(p=>p.id===id)?.name || '탈퇴한 친구');
  const mineItems=o.items.filter(i=>(i.from===state.user.id || i.to===state.user.id) && i.progress.status!=='confirmed');
  return `<section class="trigger-panel ${!details && state.tab === 'today' ? 'compact' : ''}" aria-label="실패 트리거"><div class="row between wrap"><span class="eyebrow">AT STAKE / 우리가 건 조건</span><span class="pill">${t?.mode==='prize'?'완주 상금':t?'실패 벌칙':'조건 미설정'}</span></div><h2>${esc(triggerSummary(s))}</h2><p class="small">${t?.mode==='prize'?'결과 확정 후 미완주자가 완주자에게 직접 송금합니다. 전원 완주 또는 완주자 없음은 정산 없음.':'인증 검토 중인 미션은 미달로 확정하지 않습니다. 벌칙은 본인 이행 신고 후 다른 친구가 확인합니다.'}</p>${t?.mode==='prize'?'<p class="small muted">앱은 돈을 보관·결제하지 않습니다. 1원 단위 나머지는 시작할 때의 참여 순서대로 배분합니다.</p>':''}<div class="row wrap">${live && !s.started && state.room.ownerId===state.user.id?btn(t?'실패 조건 수정':'벌칙·상금 정하기','trigger','','primary'):''}${!details && s.started?btn('발동 내역 · '+mineItems.length+'건 확인','show-results','','small'):''}</div>${s.started?`<p class="trigger-status" role="status">${esc(o.reason || '이전 시즌에는 조건이 설정되지 않았습니다. 다음 시즌부터 정할 수 있어요.')}</p>`:''}${details?o.items.map(i=>`<article class="trigger-item"><div class="row between wrap"><strong>${i.kind==='prize'?names(i.from)+' → '+names(i.to):names(i.from)+' · '+(i.day==='season'?'시즌 미완주':i.day+' 미달')}</strong><span class="pill">${({pending:'이행 대기',claimed:'친구 확인 대기',confirmed:'확인 완료'})[i.progress.status]}</span></div><p>${i.kind==='prize'?money(i.amount)+' 직접 송금':esc(i.task)}</p><div class="row wrap">${i.progress.status==='pending' && i.from===state.user.id?btn(i.kind==='prize'?'송금했어요':'벌칙을 이행했어요','trigger-progress',`data-item="${esc(i.id)}" data-season="${s.id}" data-step="claim"`):''}${i.progress.status==='claimed' && i.from!==state.user.id && (i.kind==='penalty' || i.to===state.user.id)?btn(i.kind==='prize'?'받았어요 · 수령 확인':'벌칙 이행 확인','trigger-progress',`data-item="${esc(i.id)}" data-season="${s.id}" data-step="confirm"`,'primary'):''}</div></article>`).join(''):''}</section>`;
}
function triggerDialog() {
  const t=current().trigger || {mode:'penalty',when:'each-miss',task:'',amount:10000};
  dialog('우리가 걸 조건',form('trigger',`<label>동기부여 방식<select name="mode"><option value="penalty" ${t.mode==='penalty'?'selected':''}>실패하면 벌칙</option><option value="prize" ${t.mode==='prize'?'selected':''}>완주한 친구에게 상금</option></select></label><div data-trigger-fields="penalty" class="stack"><label>벌칙이 실행되는 때<select name="when"><option value="each-miss" ${t.when==='each-miss'?'selected':''}>미션을 못 지킬 때마다 1회</option><option value="season" ${t.when==='season'?'selected':''}>시즌 4회를 완주하지 못하면 1회</option></select></label>${field('함께 동의할 벌칙','task',t.task || '','required minlength="4" maxlength="240" placeholder="예: 다음 모임 장소 예약하고 준비하기"')}<p class="form-help">각자가 자발적으로 동의하고 실제로 이행할 수 있는 내용으로 정하세요.</p></div><div data-trigger-fields="prize" class="stack">${field('미완주자 1인당 약정액 · 원','amount',t.amount || 10000,'type="number" min="1000" max="1000000" step="1" required')}<p class="form-help">미완주자가 약정액을 4회 완주한 친구들에게 균등하게 나누어 직접 송금합니다. 완주자가 없거나 모두 완주하면 송금하지 않습니다. 앱 내 결제·예치·자동 출금은 없습니다.</p></div><p class="form-help">조건을 바꾸면 전원의 동의가 초기화됩니다. 시즌 시작 후에는 변경할 수 없습니다.</p>`+submit('조건 저장')));
  updateTriggerFields();
}
function updateTriggerFields(){const f=modal.querySelector('[data-form="trigger"]');if(!f)return;for(const group of f.querySelectorAll('[data-trigger-fields]')){group.hidden=group.dataset.triggerFields!==f.elements.mode.value;for(const input of group.querySelectorAll('input,select'))input.disabled=group.hidden;}}
function promiseView(s) {
  const me = mine(s), live = s.id===current().id && !state.room.archived;
  return `${triggerPanel(s)}<div class="draft-note">모두의 미션과 실패 조건을 확인하고 동의해 주세요. 목표·일정·실패 조건·참여자가 바뀌면 전원이 다시 확인합니다.<br><strong>7일 · 각자 4회 · 마감은 한국시간 · 시작 후 변경 불가</strong></div><div class="row wrap">${live && !s.started?btn(me?.goal?'내 약속 수정':'내 약속 작성','goal','','primary'):''}${live && !s.started?btn(me?.ready?'조건에 동의했어요 ✓':'미션·실패 조건에 동의','ready',me?.ready?'disabled':''):''}${live && !s.started && state.room.ownerId===state.user.id?btn('함께 시작하기','start','','dark'):''}</div><div class="promise-list">${s.people.map((p,i)=>`<article class="promise-entry"><div class="row between"><div class="row">${avatar(p.name,i)}<strong>${esc(p.name)}${p.id===state.user.id?' · 나':''}</strong></div><span class="pill">${s.started?'잠긴 약속':p.ready?'준비 완료 ✓':'작성 · 확인 중'}</span></div><h3>${esc(p.goal?.title || '아직 약속을 정하고 있어요.')}</h3>${p.goal?`<p>${esc(p.goal.proof)}</p><p class="muted small">마감 ${p.goal.cutoff} · ${p.goal.kind==='timer'?p.goal.minutes+'분 타이머 + 한 줄 기록':'한 줄 수행 기록'} · 사진 필수 · 기존에 저장한 기록은 유지</p>${week(p)}${p.goal.reason?'<p class="muted">“'+esc(p.goal.reason)+'”</p>':''}`:''}</article>`).join('')}</div><p class="small muted">인증은 친구 간 자기신고입니다. 타이머가 실제 집중이나 행동을 자동으로 증명하지는 않습니다.</p>`;
}
function resultsView(s) {
  const room = state.room, finished = s.phase==='finished', end = ['finished','review'].includes(s.phase), live=s.id===current().id;
  return `<label style="max-width:260px;margin-bottom:25px">시즌 기록<select id="season-select">${[...room.seasons].reverse().map(x=>`<option value="${x.id}" ${x.id===s.id?'selected':''}>시즌 ${x.id} · ${x.start}</option>`).join('')}</select></label>${triggerPanel(s,true)}<div class="columns"><section><div class="eyebrow">TOGETHER, WE DID</div><div class="results-number">${s.people.reduce((n,p)=>n+p.count,0)}<span style="font-size:24px;letter-spacing:-.04em">번의 실천</span></div><p class="muted">${finished?'우리의 일주일이 확정됐어요. 노력의 크기 대신, 미리 정한 약속을 얼마나 지켰는지 돌아봐요.':end?'인증 마감 후 이의 제기 기간과 검토가 끝나면 순위가 확정됩니다.':'지금은 각자의 요일에 실천하는 중. 순위는 마지막에 확인해요.'}</p>${finished?s.ranking.map(p=>`<div class="result-row"><span class="rank">${p.rank}</span><div><strong>${esc(p.name)}</strong><p class="small muted">${p.complete?'4번의 약속 모두 완주':'다음 약속에서 다시 만나요'}${s.people.find(x=>x.id===p.id)?.recovered?' · 다시 이어간 약속':''}</p></div><span class="count">${p.score}<small>점</small></span></div>`).join(''):''}<div style="margin-top:36px"><div class="row between"><h2>이번 주의 한 문장</h2>${end && live?btn('내 회고 남기기','reflection','','small'):''}</div>${Object.entries(s.reflections).length?Object.entries(s.reflections).map(([id,note])=>`<div class="reflection"><strong class="small">${esc(s.people.find(p=>p.id===id)?.name || '친구')}</strong><p>${esc(note)}</p></div>`).join(''):'<p class="muted small">일주일 뒤, 잘한 일 하나와 바꾸고 싶은 일 하나를 남겨요.</p>'}</div>${finished && live && room.ownerId===state.user.id && !room.archived?btn('다음 주도 함께하기 ↗','next','','primary'):''}</section><aside class="side-notes"><div class="aside-block"><h3>결과의 기준</h3><p>한 번의 약속은 25점.<br>같은 점수는 공동 순위.<br>100점인 친구는 모두 완주.</p><p class="muted">응원 수나 인증을 올린 순서는<br>순위를 바꾸지 않아요.</p></div><div class="aside-block"><h3>확인에 시간이 필요할 때</h3><p class="muted">인증 후 24시간 동안 이의를 제기할 수 있어요. 48시간 동안 판정되지 않으면 원래 인증을 유지하고 처리 이유를 남깁니다.</p></div></aside></div>`;
}
function settingsView(s) {
  const r=state.room, isOwner=r.ownerId===state.user.id, nudgesOn=r.members.find(m=>m.id===state.user.id)?.nudgesEnabled!==false;
  return `<div class="settings-grid"><section class="settings-block"><h2>함께하는 사람들</h2>${r.members.map((m,i)=>`<div class="friend-line"><div class="row">${avatar(m.name,i)}<span>${esc(m.name)}</span></div>${m.id===r.ownerId?'<span class="pill">방장</span>':isOwner?btn('방장 넘기기','transfer',`data-member="${m.id}"`,'small'):''}</div>`).join('')}<div class="row wrap">${btn('초대 링크','invite')}${isOwner?btn('초대 링크 재발급','rotate'):''}</div></section>${isOwner && !s.started?'<section class="settings-block"><h2>시작일</h2><p>'+dateLabel(s.start)+'</p>'+btn('시작일 바꾸기','date')+'</section>':''}<section class="settings-block"><h2>일정과 알림</h2><p class="small muted">앱 내 알림에서 오늘 할 일을 확인하세요. 캘린더 파일에는 시작 알림을 넣어 드립니다. 외부 푸시 알림은 보내지 않습니다.</p><div class="row wrap">${btn('캘린더 파일 받기','calendar')}${btn('앱 내 알림','notifications')}${btn(nudgesOn?'친구 알림 끄기':'친구 알림 켜기','nudge-settings',`aria-pressed="${nudgesOn}"`)}</div><p class="form-help">친구 알림은 수신자 기준 이 방에서 하루 최대 2회입니다. 끄면 서버에서도 발송을 막습니다.</p></section><section class="settings-block"><h2>방 보관과 나가기</h2><p class="small muted">보관한 방은 기록을 읽을 수 있고 새 인증은 받지 않습니다. 진행 중인 시즌은 먼저 마쳐 주세요.</p><div class="row wrap">${isOwner?btn(r.archived?'다시 열기':'방 보관하기','archive') : btn('이 방에서 나가기','leave','','danger')}${isOwner && r.archived?btn('방 영구 삭제','delete-room','','danger'):''}</div></section><section class="settings-block"><h2>내 계정</h2><p class="small muted">표시 이름 변경, 내 기록 내보내기, 개인정보 삭제</p>${btn('계정 설정','account')}${btn('이용 안내 · 개인정보','privacy','','plain')}</section></div>`;
}
function goalDialog() {
  const s=current(), g=mine(s)?.goal || { title:'', proof:'', reason:'', days:[0,1,3,5], cutoff:'23:00', kind:'note', minutes:30 };
  dialog('이번 주의 내 약속',form('goal',field('실천할 행동','title',g.title,'required minlength="2" maxlength="80" placeholder="예: 전공 공부 30분"')+field('무엇을 하면 완료인가요?','proof',g.proof,'required minlength="4" maxlength="240" placeholder="예: 문제 10개를 풀고 배운 내용 한 줄 남기기"')+`<div><p class="small">실천일 4일을 선택해 주세요.</p><div class="day-choices">${Array.from({length:7},(_,i)=>`<label>${weekday(addDays(s.start,i))}<span>${addDays(s.start,i).slice(5)}</span><input type="checkbox" name="days" value="${i}" ${g.days.includes(i)?'checked':''}></label>`).join('')}</div></div>`+field('마감 시각 · 한국시간','cutoff',g.cutoff,'type="time" required')+`<label>사진 인증 방식<select name="kind"><option value="note" ${g.kind==='note'?'selected':''}>사진 + 한 줄 설명</option><option value="timer" ${g.kind==='timer'?'selected':''}>타이머 + 사진 + 한 줄 설명</option></select></label>`+field('타이머를 쓸 경우 · 분','minutes',g.minutes||30,'type="number" min="1" max="240"')+`<p class="photo-required-note">모든 미션 인증에는 사진 1장이 필요합니다.</p><p class="form-help">얼굴·집 내부·위치 등 불필요한 개인정보는 담지 마세요. 사진도 실제 행동 전체를 증명하지는 않습니다.</p>`+field('이 약속을 고른 이유 · 선택','reason',g.reason,'maxlength="240"')+'<p class="form-help">변경하면 모두의 준비 완료가 해제됩니다. 시작 후에는 바꿀 수 없습니다.</p>'+submit('약속 저장')));
}
function accountDialog() {
  dialog('내 계정',form('profile',field('친구들에게 보일 이름','name',state.user.name,'required maxlength="20"')+submit('이름 저장'))+`<hr style="border:0;border-top:1px solid #d8dece;margin:24px 0"><div class="stack">${btn('내 기록 JSON 내보내기','export')}${btn('내 계정 데이터 삭제','delete-account','','danger')}<a class="button" href="${esc(state.signOutUrl)}">로그아웃</a></div><p class="form-help">ChatGPT 계정 자체는 삭제하지 않습니다. 이 서비스에 남긴 이름과 기록만 관리합니다.</p>`);
}
function privacy() {
  dialog('이용 안내 · 개인정보',`<div class="privacy"><p>각자의 목표를 7일 동안 4번 실천하는 친구 초대형 서비스입니다. 모든 날짜와 마감은 한국시간 기준입니다.</p><h3>누가 내 기록을 보나요?</h3><p>방 이름·약속·이유·인증·반응·회고는 같은 방 참여자만 볼 수 있습니다. 초대 링크를 가진 로그인 사용자는 시작 전 방에 참여할 수 있으니 필요한 친구에게만 보내세요.</p><h3>어떤 정보를 저장하나요?</h3><p>ChatGPT 로그인 식별자, 표시 이름, 약속·기록·알림과 시각을 DB에, 선택한 사진을 비공개 파일 저장소에 저장합니다. 사진은 업로드 전에 축소하고 위치 정보를 제거합니다. 이메일은 로그인 확인에만 사용하며 별도로 저장하지 않습니다. 광고나 외부 분석 도구를 사용하지 않습니다.</p><h3>삭제와 내보내기</h3><p>계정 설정에서 본인 기록을 내려받거나 삭제할 수 있습니다. 삭제하면 모든 시즌의 본인 목표·인증·사진·알림·회고·반응이 제거됩니다. 점수도 다시 계산되며 방장 권한은 남은 첫 참여자에게 넘어갑니다. 아무도 남지 않으면 방도 삭제됩니다. 직접 내려받은 파일은 삭제 대상에 포함되지 않습니다.</p><h3>인증과 이의 제기</h3><p>새 공식 인증은 사진 1장과 설명이 필수입니다. 타이머는 실천 시간의 기록을 돕습니다. 실제 행동을 자동으로 증명하지 않습니다. 제출 후 24시간 이내 이의를 제기할 수 있습니다. 작성자와 신고자는 판정할 수 없습니다. 이해관계가 없는 방장 또는 다른 참여자가 판단합니다. 48시간 미처리 시 원래 인증을 유지합니다.</p><h3>운영과 문의</h3><p>친구 초대형 초기 버전입니다. 문제가 생기면 방장에게 알려 주세요. 저장 오류에는 요청 번호가 남으며 운영자가 배포 로그에서 확인할 수 있습니다. 벌칙과 상금 약정·정산 상태를 기록합니다. 실제 돈은 친구끼리 직접 송금하며 앱이 결제·예치·출금하지 않습니다. 참여자 기록 삭제 시 해당 시즌 자동 정산은 중단됩니다.</p></div>`);
}
async function loadRooms(preferred) {
  const list=await api('/rooms'); state.rooms=list.rooms;
  const id=preferred || state.room?.id || list.rooms.find(r=>!r.archived)?.id || list.rooms[0]?.id;
  state.room=id && list.rooms.some(r=>r.id===id)?(await api('/rooms/'+id)).room:null; state.season=null; render();
}
async function operation(op,data={}) {
  if(state.demo){toast('둘러보기 화면입니다. 로그인해서 친구들과 시작해 주세요.');return;}
  const result=await api('/rooms/'+state.room.id+'/'+op,data);
  if(result.room)state.room=result.room;
  else await loadRooms();
  render(); return result;
}
function download(name, data, type='application/json') {
  const url=URL.createObjectURL(new Blob([typeof data==='string'?data:JSON.stringify(data,null,2)],{type})), a=document.createElement('a');
  a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function calendar() {
  const s=selected(), me=mine(s); if(!me?.goal){toast('먼저 내 약속을 정해 주세요.');return;}
  const clean=x=>x.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/,/g,'\\,').replace(/;/g,'\\;');
  const stamp=ms=>new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//OurPromise//KO','CALSCALE:GREGORIAN'];
  for(const i of me.goal.days){const day=addDays(s.start,i), end=Date.parse(day+'T'+me.goal.cutoff+':00+09:00'), start=end-Math.max(me.goal.minutes,15)*60000;
    lines.push('BEGIN:VEVENT','UID:'+state.room.id+'-'+s.id+'-'+i+'@our-promise','DTSTAMP:'+stamp(Date.now()),'DTSTART:'+stamp(start),'DTEND:'+stamp(end),'SUMMARY:'+clean(me.goal.title),'DESCRIPTION:'+clean(me.goal.proof+'\n우리의 약속에서 실천 기록을 남겨 주세요.'),'BEGIN:VALARM','TRIGGER:-PT10M','ACTION:DISPLAY','DESCRIPTION:약속을 시작할 시간이에요','END:VALARM','END:VEVENT');}
  lines.push('END:VCALENDAR');download('우리의-약속.ics',lines.join('\r\n')+'\r\n','text/calendar;charset=utf-8');toast('캘린더 앱에서 파일을 열어 일정을 추가해 주세요.');
}
function demo() {
  state.demo=true;state.user={id:'demo-me',name:'장원'};const start=addDays(dayKey(Date.now()),-2), today=addDays(start,2), now=Date.parse(today+'T19:20:00+09:00');
  const people=[['demo-me','장원','전공 공부 30분',[0,2,4,6],1],['demo-min','민지','책 20쪽 읽기',[0,1,2,4],3],['demo-jun','준호','퇴근 후 산책 20분',[0,2,4,6],1],['demo-seo','서연','잠들기 전 스트레칭',[1,3,5,6],1]].map(([id,name,title,days,count])=>({id,name,goal:{title,proof:'실천한 내용과 오늘 느낀 점 한 줄 남기기',reason:'나를 위한 시간을 조금씩 늘려 보고 싶어서.',days,cutoff:'23:00',kind:'note',minutes:0},ready:true,count,days:Array.from({length:7},(_,i)=>({index:i,day:addDays(start,i),status:!days.includes(i)?'rest':i<2 || (id==='demo-min'&&i===2)?'done':'planned'}))}));
  const records=[{id:'demo-r1',userId:'demo-seo',day:addDays(start,1),at:now-20*3600000,note:'10분만 하려고 했는데, 굳어 있던 어깨가 풀리는 느낌이라 조금 더 했어.',status:'accepted',reactions:{'demo-min':'봤어요'},minutes:0},{id:'demo-r2',userId:'demo-min',day:today,at:now-3600000,note:'점심시간에 휴대폰 대신 책을 펼쳤어.\n좋아하는 문장을 발견해서 오늘은 5쪽 더 읽었다.',status:'accepted',reactions:{'demo-seo':'잘했어요','demo-jun':'같이 하자'},minutes:0}];
  state.room={id:'demo',name:'조금씩, 꾸준히',ownerId:'demo-me',members:people.map(p=>({id:p.id,name:p.name})),today,now,archived:false,seasons:[{id:1,start,started:true,phase:'active',trigger:{mode:'penalty',when:'each-miss',task:'다음 모임 장소 예약하고 준비하기'},triggerOutcome:{state:'clear',items:[],reason:'현재 발동한 벌칙이 없어요. 오늘도 사진으로 인증하세요.'},people,records,timers:{},reflections:{},ranking:[]}]};state.rooms=[{id:'demo',name:'조금씩, 꾸준히',count:4}];state.tab='today';state.season=null;render();
}
async function action(el) {
  const a=el.dataset.action;
  if(a==='close'){modal.close();return;}
  if(a==='privacy'){privacy();return;}
  if(a==='demo'){demo();return;}
  if(a==='exit-demo'){location.href='/';return;}
  if(a==='tab'){state.tab=el.dataset.tab;render();return;}
  if(a==='show-promises' || a==='show-results'){state.tab=a==='show-promises'?'promises':'results';render();return;}
  if(a==='latest'){state.season=null;state.tab='today';render();return;}
  if(a==='calendar'){calendar();return;}
  if(a==='room-list'){dialog('내 친구방',`<div class="stack">${state.rooms.map(r=>btn(esc(r.name),'room',`data-id="${r.id}"`)).join('')}${btn('새 친구방 만들기','create','','primary')}${btn('초대 코드로 참여','join')}${btn('계정 설정','account')}</div>`);return;}
  if(a==='notifications'){
    const unread=current()?.nudges?.filter(n=>!n.readAt)||[];
    if(unread.length && !state.demo)await operation('read-nudges');
    const s=current(), p=mine(s), d=p?.days.find(d=>d.day===state.room?.today), pending=s?.records.filter(r=>r.status==='pending')||[];
    dialog('나를 위한 알림',`${(s?.nudges||[]).slice().reverse().map(n=>`<div class="notification"><strong>${esc(state.room.members.find(m=>m.id===n.from)?.name||'친구')}님이 같이 하자고 했어요.</strong><p>${dateLabel(dayKey(n.at))} ${timeLabel(n.at)} · ${n.readAt?'읽음':'새 알림'}</p></div>`).join('')}<div class="notification"><strong>${d?.status==='planned'?'오늘의 약속이 기다려요.':d?.status==='done'?'오늘의 약속을 지켰어요.':'오늘의 상태를 확인해요.'}</strong><p>${esc(p?.goal?.title || '친구방에서 약속을 정해 주세요.')}${d?.status==='planned'?' · '+p.goal.cutoff+'까지':''}</p></div>${pending.map(r=>'<div class="notification"><strong>확인이 필요한 인증</strong><p>'+esc(r.report.reason)+'</p></div>').join('')}<p class="form-help">앱에서 확인하는 알림입니다. 마감 전 알림은 캘린더 파일을 추가해 이용할 수 있어요.</p>${btn('일정 파일 받기','calendar')}`);return;
  }
  if(state.demo){toast('둘러보기 화면입니다. 나가서 로그인하면 실제로 사용할 수 있어요.');return;}
  if(a==='room'){modal.close();state.tab='today';await loadRooms(el.dataset.id);}
  else if(a==='create')dialog('새 친구방',form('create',field('친구방 이름','name','','required minlength="2" maxlength="60" placeholder="예: 조금씩, 꾸준히"')+field('함께 시작할 날','start',dayKey(Date.now()),'type="date" required')+'<p class="form-help">시작 전에 모두 약속을 작성하고 확인합니다. 방은 2~10명이 함께해요.</p>'+submit('친구방 만들기')));
  else if(a==='join')dialog('초대받은 방에 참여',form('join',field('초대 링크 또는 코드','invite',new URL(location.href).searchParams.get('invite')||'','required autocomplete="off"')+submit('참여하기')));
  else if(a==='goal')goalDialog();
  else if(a==='trigger')triggerDialog();
  else if(a==='ready')dialog('미션과 실패 조건에 동의',form('ready','<p>'+esc(triggerSummary(current()))+'</p><p class="form-help">7일 동안 4회, 사진 필수. 시작 후 목표·마감·실패 조건은 바뀌지 않습니다.</p><label class="check-row"><input type="hidden" name="agreementVersion" value="'+(current().agreementVersion || 0)+'"><input type="checkbox" name="acceptTrigger" required>모두의 미션과 실패 조건을 확인하고 동의합니다.</label>'+submit('동의하고 준비 완료')));
  else if(a==='trigger-progress'){const s=state.room.seasons.find(s=>s.id===Number(el.dataset.season)),item=s.triggerOutcome.items.find(i=>i.id===el.dataset.item);dialog(el.dataset.step==='claim'?'이행·송금 신고':'친구의 이행 확인',form('trigger-progress',`<input type="hidden" name="seasonId" value="${s.id}"><input type="hidden" name="itemId" value="${esc(item.id)}"><input type="hidden" name="step" value="${el.dataset.step}"><p>${item.kind==='prize'?money(item.amount)+' 직접 송금':esc(item.task)}</p><p class="form-help">실제로 ${el.dataset.step==='claim'?'이행하거나 송금한':'이행을 확인하거나 돈을 받은'} 경우에만 확인하세요. 이 버튼은 결제를 실행하지 않습니다.</p>`+submit('확인하여 기록')));}
  else if(a==='start')dialog('함께 시작할까요?',form('start','<p>시작하면 이번 시즌의 목표·일정·완료 조건이 잠깁니다. 모두의 약속을 확인해 주세요.</p>'+submit('약속 잠그고 시작')));
  else if(a==='timer'){await operation('timer');toast('서버에 시작 시각을 저장했어요. 화면을 닫아도 타이머는 유지됩니다.');}
  else if(a==='record' || a==='extra'){state.photo=null;state.photoPending=null;dialog(a==='extra'?'추가 실천 · 점수 제외':'오늘의 실천',form(a,'<p class="form-help">'+esc(mine(current())?.goal?.proof)+'</p><label>오늘 무엇을 했나요?<textarea name="note" required minlength="4" maxlength="600" placeholder="실천한 내용과 느낀 점을 한 줄로 남겨 주세요."></textarea></label><label>실천 사진 · '+(a==='record'?'필수':'선택')+'<input type="file" name="photo" accept="image/jpeg,image/png,image/webp" '+(a==='record'?'required':'')+'></label><img id="photo-preview" class="photo-preview" alt="선택한 사진 미리보기" hidden><p id="photo-status" class="form-help"></p><p class="form-help">사진은 크기를 줄이고 위치 정보를 제거해 저장합니다. 같은 방 친구들에게만 공개됩니다. '+(a==='extra'?'추가 실천은 점수와 놓친 약속을 바꾸지 않습니다.':'제출 후 내용을 바꿀 수 없습니다.')+'</p>'+submit(a==='extra'?'추가 실천 저장':'오늘의 약속 인증')));}
  else if(a==='nudge'){await operation('nudge',{memberId:el.dataset.member});toast('같이 하자는 알림을 보냈어요.');}
  else if(a==='nudge-settings'){await operation('nudge-settings',{enabled:state.room.members.find(m=>m.id===state.user.id)?.nudgesEnabled===false});toast('친구 알림 설정을 저장했어요.');}
  else if(a==='react')await operation('react',{recordId:el.dataset.record,reaction:el.dataset.reaction});
  else if(a==='report' || a==='review')dialog(a==='report'?'확인이 필요한 이유':'인증 판정',form(a,`<input type="hidden" name="recordId" value="${el.dataset.record}">${a==='review'?'<label>판정<select name="decision"><option value="accepted">원래 인증 인정</option><option value="rejected">조건 미충족 · 미인정</option></select></label>':''}<label>시작 전에 정한 기준에 따라 이유를 남겨 주세요.<textarea name="reason" required minlength="4" maxlength="400"></textarea></label><p class="form-help">48시간 동안 미처리되면 원래 인증을 유지합니다.</p>`+submit(a==='report'?'이의 제기 제출':'판정 저장')));
  else if(a==='reflection')dialog('이번 주의 한 문장',form('reflection',`<label>잘한 일 하나, 바꿔 보고 싶은 일 하나<textarea name="note" required minlength="4" maxlength="600">${esc(current().reflections[state.user.id]||'')}</textarea></label>`+submit('회고 저장')));
  else if(a==='date' || a==='next')dialog(a==='date'?'시작일 바꾸기':'다음 주도 함께',form(a,field('시작일','start',dayKey(Date.now()),'type="date" required')+'<p class="form-help">각자의 약속과 일정을 다시 확인하고 전원이 준비 완료를 눌러야 시작됩니다.</p>'+submit('날짜 저장')));
  else if(a==='invite'){dialog('친구 초대',`<p>시작 전인 방에 참여할 수 있는 링크입니다.<br>함께할 친구에게만 보내 주세요.</p>${field('초대 링크','invite-url',location.origin+'/?invite='+state.room.invite,'readonly')}<div class="row" style="margin-top:16px">${btn('링크 복사','copy-invite','','primary')}</div><p class="form-help">친구도 ChatGPT 계정으로 로그인해야 합니다.</p>`);}
  else if(a==='copy-invite'){try{await navigator.clipboard.writeText(location.origin+'/?invite='+state.room.invite);toast('초대 링크를 복사했어요.');}catch{modal.querySelector('input').select();toast('주소를 선택했어요. 복사해 주세요.');}}
  else if(a==='rotate')dialog('초대 링크 재발급',form('rotate','<p>지금까지 보낸 링크는 더 이상 사용할 수 없습니다. 기존 참여자는 그대로 남아요.</p>'+submit('새 링크 만들기')));
  else if(a==='transfer')dialog('방장 넘기기',form('transfer',`<input type="hidden" name="memberId" value="${el.dataset.member}"><p>${esc(state.room.members.find(m=>m.id===el.dataset.member).name)}님에게 방 관리와 인증 판정 권한을 넘깁니다.</p>`+submit('방장 넘기기')));
  else if(a==='archive'){await operation('archive',{archived:!state.room.archived});await loadRooms();toast('방 상태를 저장했어요.');}
  else if(a==='leave')dialog('방에서 나가기',form('leave','<p>과거 시즌 기록은 방에 남습니다. 본인 기록을 모두 삭제하려면 계정 설정에서 삭제해 주세요.</p>'+submit('이 방에서 나가기')));
  else if(a==='delete-room')dialog('친구방 영구 삭제',form('delete-room','<p>모든 참여자의 약속과 인증 기록이 삭제됩니다. 되돌릴 수 없습니다.</p>'+field('확인을 위해 방 이름 입력','confirm','','required')+submit('방 영구 삭제')));
  else if(a==='account')accountDialog();
  else if(a==='export'){download('우리의-약속-내기록.json',await api('/account/export'));toast('내 기록을 내려받았어요.');}
  else if(a==='delete-account')dialog('내 데이터 영구 삭제',form('delete-account','<p>모든 시즌의 내 목표·인증·회고·반응이 삭제됩니다. 점수는 다시 계산되고 방장은 남은 첫 참여자에게 넘어갑니다. 되돌릴 수 없습니다.</p><p>ChatGPT 계정 자체는 삭제하지 않습니다.</p>'+field('확인 문구: 내 기록 삭제','confirm','','required')+submit('내 데이터 삭제')));
}
document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el || state.busy)return;
  state.busy=true;
  try{await action(el);}catch(error){toast(error.message);}finally{state.busy=false;}
});
modal.addEventListener('submit',async e=>{
  e.preventDefault();if(state.busy)return;state.busy=true;
  const f=e.target, data=Object.fromEntries(new FormData(f)), name=f.dataset.form, button=f.querySelector('[type=submit]');
  button.disabled=true;f.querySelector('.form-error').textContent='';
  try{
    if(name==='profile'){await api('/profile',data);state.user.name=data.name;state.user.profilePending=false;await loadRooms();}
    else if(name==='create'){const result=await api('/rooms',data);state.room=result.room;state.tab='promises';await loadRooms(result.room.id);}
    else if(name==='join'){try{data.invite=new URL(data.invite).searchParams.get('invite')||data.invite;}catch{}const result=await api('/join',data);history.replaceState({},'','/');state.tab='promises';await loadRooms(result.room.id);}
    else if(name==='delete-account'){await api('/account/delete',data);modal.close();location.href='/';return;}
    else {if(name==='ready'){data.agreementVersion=Number(data.agreementVersion);data.acceptTrigger=new FormData(f).has('acceptTrigger');}if(name==='trigger')data.amount=Number(data.amount);if(name==='trigger-progress')data.seasonId=Number(data.seasonId);if(name==='goal'){data.days=new FormData(f).getAll('days').map(Number);data.minutes=Number(data.minutes);data.photoRequired=true;}if(name==='record' || name==='extra'){await state.photoPending;delete data.photo;if(state.photo)data.photo=state.photo;}await operation(name==='delete-room'?'delete':name,data);if(name==='next'){state.season=null;state.tab='promises';render();}if(name==='rotate')toast('초대 링크를 새로 만들었어요.');}
    modal.close();toast('저장했어요.');
    if(name==='profile' && new URL(location.href).searchParams.has('invite'))await action({dataset:{action:'join'}});
  }catch(error){f.querySelector('.form-error').textContent=error.message;}
  finally{state.busy=false;button.disabled=false;}
});
async function preparePhoto(file,input) {
  if(!file)return null;
  if(file.size>10*1024*1024 || !['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('10MB 이하의 JPEG·PNG·WebP 사진을 선택해 주세요.');
  const bitmap=await createImageBitmap(file);if(bitmap.width*bitmap.height>24000000){bitmap.close();throw new Error('사진 크기가 너무 큽니다. 작은 사진을 선택해 주세요.');}
  const scale=Math.min(1,1280/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);
  const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
  let blob;for(const quality of [.82,.65,.45]){blob=await new Promise(r=>canvas.toBlob(r,'image/jpeg',quality));if(blob && blob.size<=512*1024)break;}
  if(!blob || blob.size>512*1024)throw new Error('사진을 충분히 줄이지 못했습니다. 다른 사진을 선택해 주세요.');
  let binary='';for(const b of new Uint8Array(await blob.arrayBuffer()))binary+=String.fromCharCode(b);
  const photo={type:'image/jpeg',data:btoa(binary)};
  if(input.isConnected){const preview=$('#photo-preview');preview.src='data:image/jpeg;base64,'+photo.data;preview.hidden=false;$('#photo-status').textContent='사진 준비 완료 · '+Math.ceil(blob.size/1024)+'KB';state.photo=photo;}
  return photo;
}
document.addEventListener('change',e=>{if(e.target.name!=='photo')return;state.photo=null;$('#photo-preview').hidden=true;$('#photo-status').textContent='사진을 준비하고 있어요…';
  state.photoPending=preparePhoto(e.target.files[0],e.target).catch(error=>{if(e.target.isConnected){$('#photo-status').textContent=error.message;e.target.value='';}throw error;});state.photoPending.catch(()=>{});
});
document.addEventListener('change',e=>{if(e.target.id==='season-select'){state.season=Number(e.target.value);render();}});
async function boot(){
  try{
    const me=await api('/me?returnTo='+encodeURIComponent(location.pathname+location.search));Object.assign(state,me);
    if(!state.user){render();return;}
    if(state.user.deleting){render();await action({dataset:{action:'delete-account'}});return;}
    if(state.user.profilePending){render();dialog('친구들에게 어떻게 불릴까요?',form('profile',field('표시 이름','name','','required maxlength="20" placeholder="예: 장원"')+'<p class="form-help">이름은 같은 방 친구들에게 공개됩니다.</p>'+submit('이 이름으로 시작')));return;}
    await loadRooms();
    if(new URL(location.href).searchParams.has('invite'))await action({dataset:{action:'join'}});
  }catch(error){app.innerHTML='<main id="main" class="loading"><h1>잠시 연결이 끊겼어요.</h1><p>'+esc(error.message)+'</p><a class="button" href="/">다시 시도</a></main>';}
}
function viewSignature(room){const {now,...view}=room;return JSON.stringify(view);}
setInterval(async()=>{
  if(document.hidden || state.demo || !state.room || modal.open || state.busy || ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;
  try{const result=await api('/rooms/'+state.room.id), prev=state.room, offline=state.offline;state.offline=false;state.room=result.room;if(offline || viewSignature(prev)!==viewSignature(result.room)){
    const active=document.activeElement, key=active?.dataset?.action, data=key?{...active.dataset}:null;render();
    if(data){const replacement=[...document.querySelectorAll('[data-action]')].find(el=>el.getClientRects().length && Object.entries(data).every(([k,v])=>el.dataset[k]===v));replacement?.focus({preventScroll:true});}
  }}
  catch{if(!state.offline){state.offline=true;render();}}
},15000);
setInterval(()=>{const el=$('#timer-count');if(!el)return;const remaining=Math.max(0,Number(el.dataset.start)+Number(el.dataset.minutes)*60000-Date.now());el.textContent=remaining?'남은 시간 '+Math.floor(remaining/60000)+'분 '+Math.floor(remaining%60000/1000)+'초':'정한 시간이 지났어요. 실천 내용을 남겨 주세요.';},1000);
window.addEventListener('online',()=>{if(!state.demo)boot();});
boot();

document.addEventListener('change',e=>{if(e.target.name==='mode')updateTriggerFields();});
