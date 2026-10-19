import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture, eventually } from './helpers.mjs';

test('command supervisor kills descendants after losing the MCP connection', { timeout: 10000 }, async () => {
  const f = await fixture();
  const child = spawn(process.execPath, [fileURLToPath(new URL('../src/check-worker.mjs', import.meta.url)), 'src/tree.mjs'], {
    cwd: f.root, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  });
  const closed = new Promise(resolve => child.once('exit', resolve));
  try {
    const pid = await eventually(async () => { try { return Number(await readFile(join(f.root, 'descendant.pid'), 'utf8')); } catch { return null; } }, Boolean);
    child.disconnect();
    await closed;
    await eventually(() => { try { process.kill(pid, 0); return false; } catch { return true; } }, Boolean);
  } finally { if (child.connected) child.disconnect(); await closed; await f.cleanup(); }
});
