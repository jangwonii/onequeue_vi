// Own the command's lifecycle even when the MCP host disappears unexpectedly.
import { spawn } from 'node:child_process';
if (!process.connected) process.exit(1);
const child = spawn(process.execPath, process.argv.slice(2), { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  if (child.exitCode === null && child.pid) {
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.once('error', () => { child.kill(); resolve(); }); killer.once('close', resolve);
      });
    } else {
      // The supervisor is the group leader; the command and descendants share this group.
      try { process.kill(-process.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }
  }
  process.exit(1);
}
process.on('disconnect', () => void stop());
process.on('SIGTERM', () => void stop());
child.once('error', error => { console.error(error.message); process.exit(1); });
child.once('close', code => { if (!stopping) process.exit(code ?? 1); });
