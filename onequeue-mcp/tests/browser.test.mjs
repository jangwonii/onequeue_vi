import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, finish } from './helpers.mjs';

test('isolated preview, browser actions, canonical assertions, artifact and stale evidence', { timeout: 45000 }, async () => {
  const f = await fixture(), app = await f.app();
  try {
    const p = app.get('fixture');
    await app.brief('fixture', { target: 'prototype', title: 'Browser flow', objective: 'Save a count and reload', criteria: [
      { id: 'AC-count', description: 'One saved count appears', required: true, verification: { kind: 'browser', assertion: { kind: 'text', selector: '#count', expected: '1' } } },
      { id: 'AC-failure', description: 'Deliberately failing criterion', required: false, verification: { kind: 'browser', assertion: { kind: 'count', selector: 'h1', expected: 2 } } }
    ] }, 0);
    const preview = await p.jobs.create('preview', 'preview');
    const ready = await finish(p.jobs, preview.id); assert.equal(ready.status, 'ready');
    assert.match(ready.url, /^http:\/\/127\.0\.0\.1:\d+$/);
    assert.equal(await readFile(join(f.root, '.onequeue', `${preview.id}.sqlite`), 'utf8'), 'isolated-db');
    assert.equal((await p.jobs.create('preview', 'preview')).id, preview.id);
    await assert.rejects(p.jobs.create('preview', 'duplicate'), { code: 'PREVIEW_IN_USE' });
    const session = await p.browsers.action({ action: 'open', previewId: preview.id });
    const other = await p.browsers.action({ action: 'open', previewId: preview.id });
    const sessionId = session.sessionId;
    await p.browsers.action({ action: 'click', sessionId, selector: '#increment' });
    await p.browsers.action({ action: 'reload', sessionId });
    assert.equal((await p.browsers.assert({ sessionId, criterionId: 'AC-count' })).status, 'passed');
    assert.equal((await app.status('fixture')).verified, true);
    assert.equal(await p.browsers.session(other.sessionId).page.locator('#count').innerText(), '0');
    assert.equal((await p.browsers.assert({ sessionId, criterionId: 'AC-failure' })).status, 'failed');
    const snap = await p.browsers.action({ action: 'snapshot', sessionId });
    assert.ok((await readFile(snap.artifact.path)).length > 1000);
    assert.match(snap.accessibility, /Ready/);
    await assert.rejects(p.browsers.action({ action: 'navigate', sessionId, path: 'https://example.com' }), { code: 'URL_NOT_ALLOWED' });
    await assert.rejects(p.browsers.action({ action: 'navigate', sessionId, path: 'file:///C:/Windows/win.ini' }), { code: 'URL_NOT_ALLOWED' });
    // A redirect must not bypass the request-origin restriction.
    await assert.rejects(p.browsers.action({ action: 'navigate', sessionId, path: '/redirect' }));
    await p.browsers.action({ action: 'navigate', sessionId, path: '/' });
    await writeFile(join(f.root, 'src/new.mjs'), 'export default true;');
    assert.equal((await p.browsers.assert({ sessionId, criterionId: 'AC-count' })).effectiveStatus, 'stale');
    assert.equal((await app.status('fixture')).verified, false);
    await p.browsers.closePreview(preview.id);
    await p.jobs.cancel(preview.id, true);
    assert.equal((await finish(p.jobs, preview.id)).status, 'stopped');
    await assert.rejects(fetch(ready.url));
    assert.equal(p.browsers.sessions.size, 0);
  } finally { await app.close(); await f.cleanup(); }
});

test('immediate preview cancellation does not leave a listening process', { timeout: 10000 }, async () => {
  const f = await fixture(), app = await f.app();
  try {
    const { jobs } = app.get('fixture');
    const preview = await jobs.create('preview', 'cancel-before-ready');
    await jobs.cancel(preview.id);
    assert.equal((await finish(jobs, preview.id)).status, 'cancelled');
    assert.equal(jobs.children.size, 0);
  } finally { await app.close(); await f.cleanup(); }
});

test('saved journeys execute keyboard, mobile and contrast checks and derive observed coverage', {timeout:20000},async()=>{
  const f=await fixture(),app=await f.app();
  try{
    const p=app.get('fixture');await app.brief('fixture',{target:'prototype',title:'UI checks',objective:'Run actual steps',criteria:[{id:'journey',description:'Mobile reachable action with contrast and retained keyboard focus',verification:{kind:'journey',steps:[
      {action:'viewport',width:390,height:844},{action:'assert',assertion:{kind:'reachable',selector:'#increment'}},
      {action:'assert',assertion:{kind:'contrast',selector:'h1'}},{action:'focus',selector:'input'},
      {action:'press',key:'Tab'},{action:'assert',assertion:{kind:'focused',selector:'#increment'}},
      {action:'focus',selector:'#increment'},{action:'wait',ms:50},{action:'assert',assertion:{kind:'focused',selector:'#increment'}}
    ]}}]},0);
    const job=await p.jobs.create('preview','journey');await finish(p.jobs,job.id);const session=await p.browsers.action({action:'open',previewId:job.id});
    const result=await p.browsers.assert({sessionId:session.sessionId,criterionId:'journey'});
    assert.equal(result.status,'passed');assert.deepEqual(result.detail.coverage.sort(),['contrast','focus-retention','keyboard','mobile-actions']);
    assert.ok(!result.detail.coverage.includes('time-boundary'));
  }finally{await app.close();await f.cleanup();}
});

test('journeys cannot label a full-page navigation as a live update', {timeout:20000},async()=>{
  const f=await fixture(),app=await f.app();
  try{
    await writeFile(join(f.root,'src/server.mjs'),`import http from 'node:http';export function createApp(){return http.createServer((req,res)=>{res.setHeader('content-type','text/html');res.end('<div id="state">'+(req.url==='/after'?'after':'before')+'</div><a id="next" href="/after">Next</a>');});}`);
    const p=app.get('fixture');await app.brief('fixture',{target:'release',title:'Navigation boundary',objective:'Do not count navigation as a live update',criteria:[{id:'live',description:'Changes without navigation',covers:['live-update'],verification:{kind:'journey',steps:[
      {action:'assert',assertion:{kind:'text',selector:'#state',expected:'before'}},
      {action:'wait',ms:10},{action:'click',selector:'#next'},
      {action:'assert',assertion:{kind:'text',selector:'#state',expected:'after'}}
    ]}}]},0);
    const job=await p.jobs.create('preview','navigation');await finish(p.jobs,job.id);const session=await p.browsers.action({action:'open',previewId:job.id});
    const result=await p.browsers.assert({sessionId:session.sessionId,criterionId:'live'});
    assert.equal(result.status,'passed');assert.ok(!result.detail.coverage.includes('live-update'));
    assert.ok((await app.status('fixture')).blockers.some(x=>x.includes('실행되지 않은 검증 태그 live-update')));
  }finally{await app.close();await f.cleanup();}
});
