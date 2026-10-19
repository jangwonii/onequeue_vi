import { env } from 'cloudflare:workers';
import { getChatGPTUser, chatGPTSignInPath, chatGPTSignOutPath } from '../../chatgpt-auth';
import { RELEASE, createRoom, changeRoom, snapshot, eraseUser, secret, text, fail } from '../../../lib/domain.mjs';
import { BUILD_HASH } from '../../../lib/build-info.mjs';
import { decodePhoto, photoKeys } from '../../../lib/photos.mjs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
type Row = { id: string; invite: string; document: string; version: number };
type Profile = { id: string; name: string; state: string };
async function body(request: Request, origin: string) {
  const reader = request.body?.getReader(), chunks: Uint8Array[] = []; let size = 0;
  const limit=/\/(record|extra)$/.test(new URL(request.url).pathname)?720000:16384;
  if (reader) while (true) { const c = await reader.read(); if (c.done) break; size += c.value.length; if (size > limit) { await reader.cancel(); fail(413, '요청 내용이 너무 큽니다.'); } chunks.push(c.value); }
  if (request.headers.get('sec-fetch-site') === 'cross-site' || (request.headers.get('origin') && request.headers.get('origin') !== origin)) fail(403, '다른 사이트의 변경 요청은 허용되지 않습니다.');
  if (!request.headers.get('content-type')?.startsWith('application/json')) fail(415, 'JSON 요청만 허용됩니다.');
  const bytes = new Uint8Array(size); let offset = 0; for (const c of chunks) { bytes.set(c, offset); offset += c.length; }
  try { const d = JSON.parse(new TextDecoder().decode(bytes) || '{}'); if (!d || Array.isArray(d) || typeof d !== 'object') throw new Error(); return d; } catch { fail(400, '올바르지 않은 요청입니다.'); }
}
async function handle(request: Request) {
  const requestId = crypto.randomUUID();
  let orphanPhotoKey: string | null = null;
  try {
    const url = new URL(request.url), path = url.pathname.slice(4), now = Date.now();
    if (!env.DB) fail(503, '저장소를 준비하고 있습니다.');
    const db = env.DB!.withSession('first-primary');
    if (path === '/health' && request.method === 'GET') {
      await db.prepare('SELECT id FROM profiles LIMIT 1').all();
      return json({ ok: true, release: RELEASE, buildHash: BUILD_HASH, schema: 1 });
    }
    const identity = await getChatGPTUser();
    let profile = identity ? await db.prepare('SELECT * FROM profiles WHERE id=?').bind(identity.userId).first<Profile>() : null;
    if (path === '/me' && request.method === 'GET') return json({
      user: identity ? { id: identity.userId, name: profile?.name || '', profilePending: !profile, deleting: profile?.state === 'deleting' } : null,
      signInUrl: chatGPTSignInPath(url.searchParams.get('returnTo') || '/'), signOutUrl: chatGPTSignOutPath('/'), release: RELEASE,
    });
    if (!identity) fail(401, 'ChatGPT 로그인이 필요합니다.');
    const id = identity!.userId, data = request.method === 'POST' ? await body(request, url.origin) : {};
    if (request.method === 'POST') {
      const limit = await db.prepare('INSERT INTO limits(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=CASE WHEN expires<? THEN 1 ELSE count+1 END,expires=CASE WHEN expires<? THEN ? ELSE expires END RETURNING count')
        .bind(id, now + 60000, now, now, now + 60000).first<{ count: number }>();
      if (limit!.count > 120) fail(429, '요청이 너무 많습니다. 1분 뒤 다시 시도해 주세요.');
    }
    if (profile?.state === 'deleting' && path !== '/account/delete') fail(409, '데이터 삭제를 마무리해 주세요.');
    if (path === '/profile' && request.method === 'POST') {
      const name = text(data.name, 1, 20, '표시 이름');
      await db.prepare("INSERT INTO profiles(id,name,created) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name WHERE profiles.state='active'").bind(id, name, now).run();
      // Names in past seasons are historical snapshots; current rendering uses the latest member name.
      const list = await db.prepare("SELECT * FROM rooms WHERE EXISTS(SELECT 1 FROM json_each(document,'$.members') WHERE json_extract(value,'$.id')=?)").bind(id).all<Row>();
      for (const initial of list.results) for (let n = 0; n < 8; n++) {
        const row = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(initial.id).first<Row>(); if (!row) break;
        const doc = JSON.parse(row.document);
        for (const m of doc.members) if (m.id === id) m.name = name;
        if (!doc.seasons.at(-1).started) for (const p of doc.seasons.at(-1).people) if (p.id === id) p.name = name;
        const changed = await db.prepare("UPDATE rooms SET document=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND state='active')").bind(JSON.stringify(doc), row.id, row.version, id).run();
        if (changed.meta.changes) break;
      }
      return json({ ok: true });
    }
    if (!profile) { if (path === '/rooms' && request.method === 'GET') return json({ rooms: [] }); fail(403, '먼저 친구들에게 보일 이름을 정해 주세요.'); }
    const user = { id, name: profile!.name };
    if (path === '/account/export' && request.method === 'GET') {
      const list = await db.prepare('SELECT document FROM rooms').all<{ document: string }>();
      const rooms = list.results.map(r => JSON.parse(r.document)).flatMap(r => {
        const seasons = r.seasons.filter((s: any) => s.people.some((p: any) => p.id === id)).map((s: any) => ({
          id: s.id, start: s.start, started: s.started, promise: s.people.find((p: any) => p.id === id)?.goal,
          records: s.records.filter((x: any) => x.userId === id).map((x: any) => ({ day: x.day, note: x.note, at: x.at, status: x.status, extra:!!x.extra, photoUrl:x.photoId?'/api/rooms/'+r.id+'/photo/'+x.photoId:null })),
          reflection: s.reflections[id] || null,
          trigger: s.trigger || null, triggerSuspended: !!s.triggerSuspended,
          triggerProgress: Object.fromEntries(Object.entries(s.triggerProgress || {}).filter(([key,value]:[string,any])=>key.includes(':'+id+':') || key.endsWith(':'+id) || value.confirmedBy===id)),
        }));
        return seasons.length ? [{ id: r.id, name: r.name, seasons }] : [];
      });
      return json({ format: 'our-promise-personal-v1', exportedAt: new Date(now).toISOString(), profile: { name: profile!.name }, rooms });
    }
    if (path === '/account/delete' && request.method === 'POST') {
      if (data.confirm !== '내 기록 삭제') fail(400, '확인 문구를 입력해 주세요.');
      await db.prepare("UPDATE profiles SET state='deleting' WHERE id=?").bind(id).run();
      // Tombstone prevents new writes by this account; CAS preserves concurrent friends' writes.
      const list = await db.prepare('SELECT id FROM rooms').all<{ id: string }>();
      for (const entry of list.results) {
        let done = false;
        for (let n = 0; n < 12; n++) {
          const row = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(entry.id).first<Row>(); if (!row) { done = true; break; }
          const previous = JSON.parse(row.document), next = eraseUser(previous, id), value = JSON.stringify(next);
          if (value === row.document) { done = true; break; }
          const keys=photoKeys(previous,id);if(keys.length && env.BUCKET)await env.BUCKET.delete(keys);
          const result = next.members.length ?
            await db.prepare('UPDATE rooms SET document=?,version=version+1 WHERE id=? AND version=?').bind(value, row.id, row.version).run() :
            await db.prepare('DELETE FROM rooms WHERE id=? AND version=?').bind(row.id, row.version).run();
          if (result.meta.changes) { done = true; break; }
        }
        if (!done) fail(409, '동시에 변경된 기록이 있습니다. 삭제를 다시 눌러 마무리해 주세요.');
      }
      await db.batch([db.prepare('DELETE FROM profiles WHERE id=?').bind(id), db.prepare('DELETE FROM limits WHERE id=?').bind(id)]);
      return json({ ok: true });
    }
    if (path === '/rooms' && request.method === 'GET') {
      const list = await db.prepare("SELECT * FROM rooms WHERE EXISTS(SELECT 1 FROM json_each(document,'$.members') WHERE json_extract(value,'$.id')=?) ORDER BY created DESC").bind(id).all<Row>();
      return json({ rooms: list.results.map(r => { const d = JSON.parse(r.document); return { id: r.id, name: d.name, count: d.members.length, archived: d.archived }; }) });
    }
    if (path === '/rooms' && request.method === 'POST') {
      const room = createRoom(user, data, now), invite = secret();
      const result = await db.prepare("INSERT INTO rooms(id,invite,document,version,created) SELECT ?,?,?,0,? WHERE (SELECT COUNT(*) FROM rooms WHERE json_extract(document,'$.ownerId')=?)<30 AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND state='active')")
        .bind(room.id, invite, JSON.stringify(room), now, id, id).run();
      if (!result.meta.changes) fail(409, '방은 최대 30개까지 만들 수 있습니다.');
      return json({ room: { ...snapshot(room, id, now), invite, version: 0 } }, 201);
    }
    const photoRoute=/^\/rooms\/([a-f0-9-]{36})\/photo\/([a-f0-9-]{36})$/.exec(path);
    if(photoRoute && request.method==='GET'){
      const row=await db.prepare('SELECT * FROM rooms WHERE id=?').bind(photoRoute[1]).first<Row>();
      if(!row)fail(404,'사진을 찾을 수 없습니다.');
      const room=snapshot(JSON.parse(row!.document),id,now);
      if(!room.seasons.some((s:any)=>s.records.some((r:any)=>r.photoId===photoRoute[2])))fail(404,'사진을 찾을 수 없습니다.');
      const object=await env.BUCKET?.get(photoRoute[1]+'/'+photoRoute[2]);if(!object)fail(404,'사진을 찾을 수 없습니다.');
      return new Response(object!.body,{headers:{...headers,'Content-Type':object!.httpMetadata?.contentType || 'image/jpeg','Content-Security-Policy':"default-src 'none'"}});
    }
    let roomId: string, op: string | undefined;
    if (path === '/join' && request.method === 'POST') {
      const invite = text(data.invite, 64, 64, '초대 코드');
      const row = await db.prepare('SELECT id FROM rooms WHERE invite=?').bind(invite).first<{ id: string }>();
      if (!row) fail(404, '만료되거나 잘못된 초대 링크입니다.'); roomId = row!.id; op = 'join';
    } else {
      const match = /^\/rooms\/([a-f0-9-]{36})(?:\/([a-z-]+))?$/.exec(path);
      if (!match) fail(404, '찾을 수 없습니다.'); [, roomId, op] = match!;
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      const row = await db.prepare('SELECT * FROM rooms WHERE id=?').bind(roomId!).first<Row>();
      if (!row) fail(404, '참여 중인 방을 찾을 수 없습니다.');
      const doc = JSON.parse(row!.document);
      if (request.method === 'GET' && !op) return json({ room: { ...snapshot(doc, id, now), invite: row!.invite, version: row!.version } });
      if (request.method !== 'POST' || !op) fail(405, '허용되지 않는 요청입니다.');
      if (op === 'delete') {
        if (doc.ownerId !== id) fail(403, '방장만 삭제할 수 있습니다.');
        if (data.confirm !== doc.name) fail(400, '방 이름을 정확히 입력해 주세요.');
        if (!doc.archived) fail(409, '방을 먼저 보관해 주세요.');
        const keys=photoKeys(doc);if(keys.length && env.BUCKET)await env.BUCKET.delete(keys);
        const result = await db.prepare('DELETE FROM rooms WHERE id=? AND version=?').bind(row!.id, row!.version).run();
        if (result.meta.changes) return json({ ok: true }); continue;
      }
      // Invite may have rotated since the first lookup.
      if (op === 'join' && row!.invite !== data.invite) fail(404, '만료된 초대 링크입니다.');
      // Never accept a caller-supplied storage key or another person's photo reference.
      delete data.photoId;
      let image: ReturnType<typeof decodePhoto> | undefined;
      if(['record','extra'].includes(op) && data.photo){
        if(!env.BUCKET)fail(503,'사진 저장소를 준비하고 있습니다.');
        image=decodePhoto(data.photo);orphanPhotoKey ||= row!.id+'/'+crypto.randomUUID();data.photoId=orphanPhotoKey.split('/')[1];
      }
      const next = changeRoom(doc, user, op, data, now), invite = op === 'rotate' ? secret() : row!.invite;
      const value = JSON.stringify(next); if (value.length > 1500000) fail(409, '방 저장 한도에 도달했습니다. 새 방을 만들어 주세요.');
      if(image && orphanPhotoKey)await env.BUCKET!.put(orphanPhotoKey,image.bytes,{httpMetadata:{contentType:image.type}});
      const result = await db.prepare("UPDATE rooms SET document=?,invite=?,version=version+1 WHERE id=? AND version=? AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND state='active')")
        .bind(value, invite, row!.id, row!.version, id).run();
      if (result.meta.changes) {orphanPhotoKey=null;return json(op === 'leave' ? { ok: true } : { room: { ...snapshot(next, id, now), invite, version: row!.version + 1 } });}
    }
    fail(409, '동시 변경이 있었습니다. 최신 화면에서 다시 시도해 주세요.');
  } catch (error) {
    if(orphanPhotoKey)try{await env.BUCKET?.delete(orphanPhotoKey);}catch{console.error(JSON.stringify({requestId,event:'photo_cleanup_failed'}));}
    const e = error as Error & { status?: number };
    if (!e.status) console.error(JSON.stringify({ requestId, event: 'request_failed', errorType: e.name }));
    return json({ error: e.status ? e.message : '저장 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.', requestId }, e.status || 503);
  }
}
export const GET = handle;
export const POST = handle;
