import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, basename } from 'node:path';
import { OneQueue } from '../src/app.mjs';
import { delay } from '../src/util.mjs';

export async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'onequeue-test-'));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', type: 'module', scripts: { test: 'node src/pass.mjs' } }));
  await writeFile(join(root, 'src/pass.mjs'), "console.log('pass'); console.log('api_key=sample-secret-value');");
  await writeFile(join(root, 'src/fail.mjs'), "console.error('expected test failure'); process.exit(2);");
  await writeFile(join(root, 'src/hang.mjs'), "setInterval(() => {}, 1000);");
  await writeFile(join(root, 'src/tree.mjs'), `import { spawn } from 'node:child_process'; import { writeFileSync } from 'node:fs'; const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true}); writeFileSync('descendant.pid',String(c.pid)); setInterval(()=>{},1000);`);
  const html = '<!doctype html><title>Fixture</title><h1>Ready</h1><input type="password"><button id="increment">Add</button><div id="count">0</div><script>document.querySelector("#count").textContent=localStorage.n||0;document.querySelector("button").onclick=()=>{localStorage.n=Number(localStorage.n||0)+1;document.querySelector("#count").textContent=localStorage.n}</script>';
  await writeFile(join(root, 'src/server.mjs'), `import http from 'node:http';import {writeFile} from 'node:fs/promises';export async function createApp({database}) { await writeFile(database,'isolated-db');return http.createServer((req,res)=>{ if(req.url==='/health'){res.end('ok')} else if(req.url==='/redirect'){res.writeHead(302,{Location:'http://127.0.0.1:9/'});res.end()}else {res.setHeader('content-type','text/html');res.end(${JSON.stringify(html)})}}) }`);
  const config = { projects: [{ id: 'fixture', name: 'Test project', root: '.', sources: ['package.json', 'src'], checks: {
    pass: { args: ['src/pass.mjs'], timeoutMs: 5000 }, fail: { args: ['src/fail.mjs'], timeoutMs: 5000 },
    timeout: { args: ['src/hang.mjs'], timeoutMs: 300 }, hang: { args: ['src/hang.mjs'], timeoutMs: 30000 },
    tree: { args: ['src/tree.mjs'], timeoutMs: 30000 }
  }, preview: { module: 'src/server.mjs', export: 'createApp', healthPath: '/health' }, browserChannel: 'msedge' }] };
  const configPath = join(root, 'projects.json'); await writeFile(configPath, JSON.stringify(config));
  return { root, config, configPath, async app() { return new OneQueue().init(configPath); }, async cleanup() {
    const actual = await realpath(root), parent = await realpath(tmpdir());
    if (dirname(actual).toLowerCase() !== parent.toLowerCase() || !basename(actual).startsWith('onequeue-test-')) throw new Error('Invalid test cleanup target');
    await rm(actual, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } };
}
export const brief = { target: 'prototype', title: 'Fixture brief', objective: 'Verify registered checks', criteria: [{ id: 'AC-1', description: 'Registered check passes', required: true, verification: { kind: 'check', checkId: 'pass' } }] };
export async function eventually(fn, predicate, timeout = 10000) {
  const deadline = Date.now() + timeout;
  let value;
  do { value = await fn(); if (predicate(value)) return value; await delay(50); } while (Date.now() < deadline);
  throw new Error(`Timed out: ${JSON.stringify(value)}`);
}
export function finish(jobs, id) { return eventually(() => jobs.view(jobs.get(id)), j => !['queued', 'running', 'starting', 'cancelling', 'stopping'].includes(j.status)); }
