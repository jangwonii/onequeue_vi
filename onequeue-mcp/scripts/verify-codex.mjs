import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const command = process.argv[2] || 'codex';
const child = spawn(command, ['app-server', '--listen', 'stdio://'], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
const pending = new Map(); let nextId = 1;
child.stderr.on('data', () => {});
createInterface({ input: child.stdout }).on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  const item = pending.get(msg.id);
  if (item) { pending.delete(msg.id); clearTimeout(item.timer); msg.error ? item.reject(new Error(JSON.stringify(msg.error))) : item.resolve(msg.result); }
});
function rpc(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 45000);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
try {
  const init = await rpc('initialize', { clientInfo: { name: 'onequeue-connection-check', version: '0.1.0' }, capabilities: { experimentalApi: true } });
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized', params: {} })}\n`);
  const status = await rpc('mcpServerStatus/list', { serverName: 'onequeue', detail: 'full' });
  const entry = status.data?.find(s => s.name === 'onequeue');
  if (!entry || Object.keys(entry.tools || {}).length !== 10) throw new Error(`OneQueue tool discovery failed: ${JSON.stringify(status)}`);
  const proof = { checkedAt: new Date().toISOString(), method: 'Codex app-server mcpServerStatus/list', server: 'onequeue', tools: Object.keys(entry.tools), authStatus: entry.authStatus, client: init.userAgent };
  const output = fileURLToPath(new URL('../../.onequeue/codex-connection.json', import.meta.url));
  await writeFile(output, `${JSON.stringify(proof, null, 2)}\n`);
  console.log(JSON.stringify(proof, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  child.stdin.end();
  await new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    const timer = setTimeout(() => {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('close', resolve); killer.on('error', resolve);
      } else { child.kill(); resolve(); }
    }, 2000);
    child.once('close', () => { clearTimeout(timer); resolve(); });
  });
}
