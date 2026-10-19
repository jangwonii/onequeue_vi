import { readFile, writeFile, copyFile } from 'node:fs/promises';
const target = 'sites/seven';
for (const file of ['styles.css', 'model.js']) await copyFile(file, `${target}/public/${file}`);
await copyFile('model.js', `${target}/lib/model.js`);
let source = await readFile('app.js', 'utf8');
source = source.replace("let toastTimer, refreshVersion = 0;", "let toastTimer, refreshVersion = 0;\nlet signInUrl = '/signin-with-chatgpt?return_to=%2F', signOutUrl = '/signout-with-chatgpt?return_to=%2F';\ntry { invitation ||= sessionStorage.getItem('seven-invitation') || ''; if (invitation) sessionStorage.setItem('seven-invitation', invitation); } catch {};");
source = source.replace('if (!user) return renderAuth();', 'if (!user) return renderAuth();\n  if (user.profilePending) return renderProfile();');
const authStart = source.indexOf('function renderAuth() {');
const authEnd = source.indexOf('function lobby() {', authStart);
source = source.slice(0, authStart) + `function renderAuth() {
  root.innerHTML = '<main class="auth-layout"><section class="auth-intro"><a class="brand" href="/"><span class="brand-mark">7</span>seven<span class="brand-dot">.</span></a><p class="eyebrow">A LITTLE BETTER, TOGETHER</p><h1>각자의 목표로,<br>함께하는 7일.</h1><p>친구를 초대하고, 서로의 약속을 확인하고.<br>오늘의 작은 실천을 함께 쌓아보세요.</p><div class="auth-seven" aria-hidden="true">7<span>DAYS</span></div><span class="pill">다른 목표 · 같은 기간 · 같은 달성률 기준</span></section><section class="card auth-card"><p class="eyebrow">YOUR ROUTINE CLUB</p><h2>우리의 7일을 시작해요</h2><p class="modal-description">' + (invitation ? '친구의 초대가 도착했어요. 로그인한 뒤 참여해 주세요.' : 'ChatGPT 계정으로 어느 기기에서나 기록을 이어가세요.') + '</p><a class="button primary full" href="' + esc(signInUrl) + '" target="_top">ChatGPT로 로그인 ↗</a><p class="field-hint">친구도 ChatGPT 로그인이 필요합니다. 로그인 후 친구들에게 보일 이름을 정할 수 있어요. 목표와 인증 기록은 참여한 방의 구성원에게만 표시됩니다.</p></section></main>';
}
function renderProfile() {
  root.innerHTML = '<main class="auth-layout"><section class="auth-intro"><span class="brand">seven.</span><h1>친구들에게<br>어떤 이름으로 보일까요?</h1><p>이름은 참여한 친구방에 표시됩니다.<br>이메일은 친구들에게 공개하지 않아요.</p></section><section class="card auth-card"><h2>내 이름 정하기</h2><form><label>친구들에게 보일 이름<input name="name" minlength="1" maxlength="20" autocomplete="nickname" required placeholder="예: 민지"></label><p class="form-error" role="alert"></p><button class="button primary full" type="submit">이 이름으로 시작하기</button></form><p class="field-hint">현재 버전에서는 한 번 정한 이름을 변경할 수 없습니다.</p></section></main>';
  formHandler(root.querySelector('form'), async values => { user = (await api('/profile', values)).user; rooms = (await api('/rooms')).rooms; render(); });
}
` + source.slice(authEnd);
source = source.replace("if (action === 'logout') { await api('/logout', {}); ++refreshVersion; user = null; room = null; rooms = []; render(); }", "if (action === 'logout') { window.top.location.href = signOutUrl; return; }");
source = source.replace("invitation = ''; history.replaceState", "invitation = ''; try { sessionStorage.removeItem('seven-invitation'); } catch {} history.replaceState");
source = source.replace("user = (await api('/me')).user;", "const identity = await api('/me'); user = identity.user; signInUrl = identity.signInUrl; signOutUrl = identity.signOutUrl;");
source = source.replace("초대받은 방 참여하기</button>", "초대받은 방 참여하기</button>");
await writeFile(`${target}/public/client-app.js`, source);
const html = (await readFile('index.html', 'utf8')).replace('/app.js', '/client-app.js');
await writeFile(`${target}/app/route.ts`, `export const dynamic = 'force-dynamic';\nexport function GET() { return new Response(${JSON.stringify(html)}, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'" } }); }\n`);
console.log('Hosted UI prepared with ChatGPT authentication.');
