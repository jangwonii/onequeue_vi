import { env } from 'cloudflare:workers';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '../../chatgpt-auth';
import { snapshot, changeRoom, member, secret, text, fail, type RoomRow, type Document } from '../../../lib/challenge';
export const dynamic = 'force-dynamic';
const securityHeaders = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
function json(data: unknown, status = 200) { return Response.json(data, { status, headers: securityHeaders }); }
async function handle(request: Request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.slice(4);
    const db = env.DB;
    if (!db) fail(503, '데이터베이스 연결을 준비하고 있습니다.');
    // Primary sessions keep a user's polling reads current after a write on any instance.
    const store = db.withSession('first-primary');
    if (path === '/health' && request.method === 'GET') { await store.prepare('SELECT id FROM profiles LIMIT 1').all(); return json({ ok: true }); }
    const identity = await getChatGPTUser();
    if (path === '/me' && request.method === 'GET') {
      const profile = identity ? await store.prepare('SELECT name FROM profiles WHERE id=?').bind(identity.userId).first<{ name: string }>() : null;
      return json({ user: identity ? { id: identity.userId, name: profile?.name || '친구', username: 'ChatGPT', profilePending: !profile } : null, signInUrl: chatGPTSignInPath('/'), signOutUrl: chatGPTSignOutPath('/') });
    }
    if (!identity) fail(401, 'ChatGPT 로그인이 필요합니다.');
    let data: Record<string, unknown> = {};
    if (request.method === 'POST') {
      if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== url.origin)) fail(403, '다른 사이트의 변경 요청은 허용되지 않습니다.');
      if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON 요청만 허용됩니다.');
      if (Number(request.headers.get('content-length') || 0) > 16384) fail(413, '요청 내용이 너무 큽니다.');
      const reader = request.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
      if (reader) while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 16384) { await reader.cancel(); fail(413, '요청 내용이 너무 큽니다.'); } chunks.push(chunk.value); }
      const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { data = JSON.parse(new TextDecoder().decode(bytes) || '{}'); if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error(); } catch { fail(400, '올바르지 않은 요청입니다.'); }
      const now = Date.now();
      const limit = await store.prepare('INSERT INTO limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END, expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING count').bind(identity.userId, now + 60000, now, now, now + 60000).first<{ count: number }>();
      if (limit!.count > 150) fail(429, '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.');
    }
    if (path === '/profile' && request.method === 'POST') {
      const name = text(data.name, 1, 20, '이름');
      await store.prepare('INSERT INTO profiles(id,name) VALUES(?,?) ON CONFLICT(id) DO NOTHING').bind(identity.userId, name).run();
      const profile = await store.prepare('SELECT name FROM profiles WHERE id=?').bind(identity.userId).first<{ name: string }>();
      return json({ user: { id: identity.userId, name: profile!.name, username: 'ChatGPT', profilePending: false } });
    }
    const profile = await store.prepare('SELECT name FROM profiles WHERE id=?').bind(identity.userId).first<{ name: string }>();
    if (!profile) { if (path === '/rooms' && request.method === 'GET') return json({ rooms: [] }); fail(403, '먼저 친구들에게 보일 이름을 정해 주세요.'); }
    const user = { id: identity.userId, name: profile.name };
    if (path === '/rooms' && request.method === 'GET') {
      const result = await store.prepare("SELECT id,name,owner_id,document FROM challenges WHERE EXISTS (SELECT 1 FROM json_each(challenges.document,'$.members') WHERE json_extract(value,'$.id')=?) ORDER BY created DESC").bind(user.id).all<RoomRow>();
      return json({ rooms: result.results.map(row => { const doc = JSON.parse(row.document) as Document; return { id: row.id, name: row.name, ownerId: row.owner_id, start: doc.start, end: doc.end, count: doc.members.length }; }) });
    }
    if (path === '/rooms' && request.method === 'POST') {
      const row: RoomRow = { id: crypto.randomUUID(), name: text(data.name, 2, 60, '친구방 이름'), owner_id: user.id, invite: secret(), document: JSON.stringify({ start: null, end: null, members: [member(user.id, user.name)] }), version: 0, created: Date.now() };
      const result = await store.prepare('INSERT INTO challenges(id,name,owner_id,invite,document,version,created) SELECT ?,?,?,?,?,0,? WHERE (SELECT COUNT(*) FROM challenges WHERE owner_id=?)<30').bind(row.id, row.name, row.owner_id, row.invite, row.document, row.created, user.id).run();
      if (!result.meta.changes) fail(400, '계정당 최대 30개의 방을 만들 수 있습니다.');
      return json({ room: snapshot(row, user.id) }, 201);
    }
    let id: string, operation: string | undefined;
    if (path === '/join' && request.method === 'POST') {
      const invite = text(data.invite, 64, 64, '초대 코드');
      const row = await store.prepare('SELECT id FROM challenges WHERE invite=?').bind(invite).first<{ id: string }>();
      if (!row) fail(404, '유효하지 않은 초대 링크입니다.');
      id = row.id; operation = 'join';
    } else {
      const match = /^\/rooms\/([a-f0-9-]{36})(?:\/(goal|approve|start|record|cheer|rotate-invite))?$/.exec(path);
      if (!match) fail(404, '찾을 수 없습니다.');
      [, id, operation] = match;
    }
    for (let attempt = 0; attempt < 8; attempt++) {
      const row = await store.prepare('SELECT * FROM challenges WHERE id=?').bind(id).first<RoomRow>();
      if (!row) fail(404, '참여 중인 방을 찾을 수 없습니다.');
      if (request.method === 'GET' && !operation) return json({ room: snapshot(row, user.id) });
      if (request.method !== 'POST' || !operation) fail(405, '허용되지 않는 요청입니다.');
      const next = changeRoom(row, user, operation, data);
      const result = await store.prepare('UPDATE challenges SET document=?,invite=?,version=version+1 WHERE id=? AND version=?').bind(next.document, next.invite, row.id, row.version).run();
      if (result.meta.changes) return json({ room: snapshot(next, user.id) });
    }
    fail(409, '친구들이 동시에 기록을 변경했습니다. 최신 화면에서 다시 시도해 주세요.');
  } catch (error) {
    const e = error as Error & { status?: number };
    if (!e.status && /D1_|SQLITE|database/i.test(e.message)) return json({ error: '저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.' }, 503);
    return json({ error: e.message || '요청을 처리하지 못했습니다.' }, e.status || 400);
  }
}
export const GET = handle;
export const POST = handle;
