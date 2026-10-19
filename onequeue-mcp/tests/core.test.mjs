import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, symlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fixture, brief, finish, eventually } from './helpers.mjs';
import { safePath, fingerprint } from '../src/util.mjs';

test('brief versioning, idempotency, evidence and source invalidation', async () => {
  const f = await fixture(); const app = await f.app();
  try {
    const p = app.get('fixture');
    assert.equal((await app.status('fixture')).verified, false);
    await app.brief('fixture', brief, 0);
    await assert.rejects(app.brief('fixture', brief, 0), { code: 'BRIEF_VERSION_CONFLICT' });
    const job = await p.jobs.create('checks', 'unique-key', ['pass']);
    assert.equal((await p.jobs.create('checks', 'unique-key', ['pass'])).id, job.id);
    await assert.rejects(p.jobs.create('checks', 'unique-key', ['fail']), { code: 'REQUEST_KEY_CONFLICT' });
    const done = await finish(p.jobs, job.id);
    assert.equal(done.status, 'succeeded'); assert.match(done.logs, /REDACTED/); assert.doesNotMatch(done.logs, /sample-secret-value/);
    assert.equal((await app.status('fixture')).verified, true);
    assert.equal(p.jobs.view(p.jobs.get(job.id), done.nextCursor).logs, '');
    await writeFile(join(f.root, 'src/new-untracked.mjs'), 'export const value = 1;');
    assert.equal((await app.status('fixture')).criteria[0].status, 'stale');
    await app.brief('fixture', brief, 1);
    assert.equal((await app.status('fixture')).criteria[0].status, 'unverified');
    await assert.rejects(p.jobs.create('checks', 'unknown', ['not-registered']), { code: 'UNKNOWN_CHECK' });
    await assert.rejects(app.inspect('../elsewhere'), { code: 'PROJECT_NOT_FOUND' });
  } finally { await app.close(); await f.cleanup(); }
});

test('failed checks, timeout, sequential queue and cancellation remain distinct', async () => {
  const f = await fixture(), app = await f.app();
  try {
    const { jobs } = app.get('fixture');
    const failed = await jobs.create('checks', 'failure', ['fail']);
    assert.equal((await finish(jobs, failed.id)).status, 'failed');
    const timeout = await jobs.create('checks', 'timeout', ['timeout']);
    assert.equal((await finish(jobs, timeout.id)).status, 'timed_out');
    const hang = await jobs.create('checks', 'hang', ['hang']);
    const next = await jobs.create('checks', 'next', ['pass']);
    assert.equal(jobs.get(next.id).status, 'queued');
    await jobs.cancel(next.id); assert.equal(jobs.get(next.id).status, 'cancelled');
    await jobs.cancel(hang.id); assert.equal((await finish(jobs, hang.id)).status, 'cancelled');
    const last = await jobs.create('checks', 'last', ['pass']);
    assert.equal((await finish(jobs, last.id)).status, 'succeeded');
  } finally { await app.close(); await f.cleanup(); }
});

test('cancelling a running job terminates its descendant process', async () => {
  const f = await fixture(), app = await f.app();
  try {
    const { jobs } = app.get('fixture');
    const job = await jobs.create('checks', 'tree', ['tree']);
    const pid = await eventually(async () => { try { return Number(await readFile(join(f.root, 'descendant.pid'), 'utf8')); } catch { return null; } }, Boolean);
    process.kill(pid, 0);
    await jobs.cancel(job.id); await finish(jobs, job.id);
    await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, Boolean);
  } finally { await app.close(); await f.cleanup(); }
});

test('project path containment rejects traversal and directory junctions', async () => {
  const f = await fixture(), outside = await fixture();
  try {
    await assert.rejects(safePath(f.root, '../escape'), { code: 'PATH_OUTSIDE_PROJECT' });
    await symlink(outside.root, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(safePath(f.root, 'linked/package.json'), { code: 'SYMLINK_NOT_ALLOWED' });
  } finally { await f.cleanup(); await outside.cleanup(); }
});

test('state survives restart, live owner prevents a second server, interrupted jobs are not rerun', async () => {
  const f = await fixture(); let app = await f.app();
  try {
    await app.brief('fixture', brief, 0);
    await assert.rejects(f.app(), { code: 'PROJECT_IN_USE' });
    await app.close();
    const path = join(f.root, '.onequeue/state.json');
    const state = JSON.parse(await readFile(path, 'utf8'));
    state.jobs.push({ id: 'prior-job', kind: 'checks', status: 'running', logs: '', logOffset: 0 });
    await writeFile(path, JSON.stringify(state));
    app = await f.app();
    assert.equal(app.get('fixture').store.state.brief.version, 1);
    assert.equal(app.get('fixture').jobs.get('prior-job').status, 'interrupted');
  } finally { await app.close(); await f.cleanup(); }
});

test('source changes during an executing check invalidate its evidence', async () => {
  const f = await fixture(), app = await f.app();
  try {
    const p = app.get('fixture');
    await writeFile(join(f.root, 'src/pass.mjs'), 'setTimeout(()=>process.exit(0),500);');
    await app.brief('fixture', brief, 0);
    const job = await p.jobs.create('checks', 'changing', ['pass']);
    await eventually(() => p.jobs.children.has(job.id), Boolean);
    await writeFile(join(f.root, 'src/changed.mjs'), 'export default 2;');
    const result = await finish(p.jobs, job.id);
    assert.equal(result.status, 'succeeded'); assert.equal(result.sourceChanged, true);
    assert.equal((await app.status('fixture')).criteria[0].status, 'stale');
  } finally { await app.close(); await f.cleanup(); }
});

test('bounded log cursor and split-chunk redaction do not leak values', async () => {
  const f = await fixture(), app = await f.app();
  try {
    await writeFile(join(f.root, 'src/pass.mjs'), "process.stdout.write('api_key=');setTimeout(()=>{console.log('split-value');console.log('x'.repeat(70000));console.log('last');},20);");
    const { jobs } = app.get('fixture'), job = await jobs.create('checks', 'logs', ['pass']);
    const result = await finish(jobs, job.id);
    assert.doesNotMatch(result.logs, /split-value/); assert.match(result.logs, /REDACTED/); assert.match(result.logs, /last/); assert.ok(result.logs.length < 65536);
  } finally { await app.close(); await f.cleanup(); }
});

test('read-only status coexists with the owning server and does not rewrite jobs or its lock',async()=>{
  const f=await fixture(),app=await f.app();let reader;
  try{
    await app.brief('fixture',brief,0);
    const lock=await readFile(join(f.root,'.onequeue/owner.json'),'utf8'),state=await readFile(join(f.root,'.onequeue/state.json'),'utf8');
    reader=await new (app.constructor)().init(f.configPath,{readOnly:true});
    assert.equal((await reader.status('fixture')).brief.version,1);
    assert.throws(()=>reader.get('fixture').store.save(),{code:'READ_ONLY_STORE'});
    await reader.close();
    assert.equal(await readFile(join(f.root,'.onequeue/owner.json'),'utf8'),lock);
    assert.equal(await readFile(join(f.root,'.onequeue/state.json'),'utf8'),state);
  }finally{await reader?.close();await app.close();await f.cleanup();}
});
