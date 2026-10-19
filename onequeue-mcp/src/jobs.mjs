import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { resolve } from 'node:path';
import { readCheckReport } from './check-report.mjs';
import { fingerprint, now, redact, requireThat, childEnvironment, delay, safePath } from './util.mjs';

const workerPath = fileURLToPath(new URL('./preview-worker.mjs', import.meta.url));
const checkWorkerPath = fileURLToPath(new URL('./check-worker.mjs', import.meta.url));
const playwrightPath = fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const active = new Set(['queued', 'running', 'starting', 'ready', 'cancelling', 'stopping']);
export class Jobs {
  constructor(project, store) {
    this.project = project; this.store = store; this.children = new Map(); this.tasks = new Set(); this.closing = false;
  }
  get(id) {
    const job = this.store.state.jobs.find(j => j.id === id);
    requireThat(job, 'JOB_NOT_FOUND', '작업을 찾을 수 없습니다.'); return job;
  }
  view(job, cursor = 0) {
    const { logs, ...rest } = job;
    const start = Math.max(cursor, job.logOffset || 0);
    return { ...rest, logs: logs.slice(start - job.logOffset), nextCursor: job.logOffset + logs.length, truncated: cursor < job.logOffset };
  }
  append(job, value) {
    job.logs += `${redact(value)}\n`;
    if (job.logs.length > 65536) { const cut = job.logs.length - 65536; job.logs = job.logs.slice(cut); job.logOffset += cut; }
  }
  connectLog(job, stream) {
    const decoder = new StringDecoder('utf8'); let pending = '', dropped = false;
    const consume = chunk => {
      for (const [i, piece] of chunk.split('\n').entries()) {
        if (i) { this.append(job, dropped ? '[너무 긴 로그 행 생략]' : pending); pending = ''; dropped = false; }
        if (!dropped) { pending += piece; if (pending.length > 65536) { dropped = true; pending = ''; } }
      }
    };
    stream.on('data', chunk => consume(decoder.write(chunk)));
    stream.on('end', () => { consume(decoder.end()); if (pending || dropped) this.append(job, dropped ? '[너무 긴 로그 행 생략]' : pending); });
  }
  launch(job, args, ipc = false, extraEnv = {}) {
    const child = spawn(process.execPath, args, {
      cwd: this.project.root, shell: false, windowsHide: true, detached: process.platform !== 'win32',
      stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
      env: childEnvironment({ PLAYWRIGHT_MODULE: playwrightPath, BROWSER_CHANNEL: this.project.browserChannel, DATABASE_PATH: resolve(this.store.dir, `${job.id}.sqlite`), PUBLIC_ORIGIN: '', HOST: '127.0.0.1', ...extraEnv })
    });
    this.children.set(job.id, child);
    this.connectLog(job, child.stdout); this.connectLog(job, child.stderr);
    const completion = new Promise(resolve => {
      child.once('error', error => { this.append(job, error.message); resolve({ exitCode: null, error: error.message }); });
      child.once('close', (code, signal) => resolve({ exitCode: code, signal }));
    });
    child.completion = completion;
    return child;
  }
  track(promise) {
    this.tasks.add(promise);
    promise.finally(() => this.tasks.delete(promise)).catch(() => {});
    return promise;
  }
  async create(kind, requestKey, checkIds = []) {
    requireThat(!this.closing, 'SHUTTING_DOWN', '원큐 서버 종료 중입니다.');
    const signature = JSON.stringify({ kind, checkIds });
    const prior = this.store.state.jobs.find(j => j.requestKey === requestKey);
    if (prior) { requireThat(prior.signature === signature, 'REQUEST_KEY_CONFLICT', '같은 요청 키에 다른 작업을 사용할 수 없습니다.'); return this.view(prior); }
    if (kind === 'checks') {
      requireThat(checkIds.length > 0 && new Set(checkIds).size === checkIds.length, 'INVALID_CHECKS', '검증 ID는 중복 없이 하나 이상 지정하세요.');
      for (const id of checkIds) requireThat(this.project.checks[id], 'UNKNOWN_CHECK', `등록되지 않은 검증입니다: ${id}`);
    } else {
      requireThat(this.project.preview, 'PREVIEW_UNAVAILABLE', '이 프로젝트에는 미리보기 어댑터가 없습니다.');
      requireThat(!this.store.state.jobs.some(j => j.kind === 'preview' && active.has(j.status)), 'PREVIEW_IN_USE', '기존 미리보기를 종료한 뒤 새로 시작하세요.');
    }
    const job = { id: randomUUID(), kind, requestKey, signature, checkIds, status: 'queued', createdAt: now(),
      briefVersion: this.store.state.brief?.version || 0, fingerprint: (await fingerprint(this.project)).hash,
      logs: '', logOffset: 0, results: [] };
    this.store.state.jobs.push(job); await this.store.save();
    if (kind === 'preview') this.track(this.runPreview(job)); else this.pump();
    return this.view(job);
  }
  pump() {
    if (this.pumping || this.closing) return;
    this.pumping = true;
    this.track((async () => {
      try {
        let job;
        while (!this.closing && (job = this.store.state.jobs.find(j => j.kind === 'checks' && j.status === 'queued'))) await this.runChecks(job);
      } finally { this.pumping = false; }
    })());
  }
  async runChecks(job) {
    try {
      job.status = 'running'; job.startedAt = now();
      job.fingerprint = (await fingerprint(this.project)).hash;
      await this.store.save();
      for (const checkId of job.checkIds) {
        if (job.stopReason) break;
        const check = this.project.checks[checkId];
        this.append(job, `검증 시작: ${checkId}`);
        const runId=randomUUID(), reportPath=check.reportPath?await safePath(this.project.root,check.reportPath,{missing:true}):null;
        const child = this.launch(job, [checkWorkerPath, ...check.args], true, {ONEQUEUE_RUN_ID:runId,...(reportPath?{ONEQUEUE_REPORT_PATH:reportPath}:{})});
        const timer = setTimeout(() => { job.stopReason ||= 'timed_out'; void this.kill(job); }, check.timeoutMs);
        const result = await child.completion;
        clearTimeout(timer); this.children.delete(job.id);
        if(result.exitCode===0 && !job.stopReason && check.reportPath) {
          try { Object.assign(result,await readCheckReport(this.project,check.reportPath,runId)); }
          catch(error) { result.exitCode=1;result.error=redact(error.message).slice(0,2000);this.append(job,result.error); }
        }
        job.results.push({ checkId, status: job.stopReason || (result.exitCode === 0 ? 'passed' : 'failed'), ...result });
        if (job.stopReason) break;
      }
      job.endFingerprint = (await fingerprint(this.project)).hash;
      job.status = job.stopReason || (job.results.every(r => r.status === 'passed') ? 'succeeded' : 'failed');
      job.sourceChanged = job.fingerprint !== job.endFingerprint;
      for (const result of job.results) this.store.state.evidence.push({
        id: randomUUID(), kind: 'check', checkId: result.checkId, jobId: job.id,
        briefVersion: job.briefVersion, fingerprint: job.fingerprint,
        sourceChanged: job.sourceChanged, status: result.status === 'passed' ? 'passed' : 'failed',
        detail: result, provenance:{environment:'local',identity:'synthetic',actors:0,methods:['automated-run'],limitations:['등록된 로컬 실행입니다. 운영 로그인 증거가 아닙니다.']}, createdAt: now()
      });
    } catch (error) { job.status = job.stopReason || 'failed'; this.append(job, error.message); }
    finally { job.finishedAt = now(); this.children.delete(job.id); await this.store.save(); }
  }
  async runPreview(job) {
    let timer;
    try {
      job.status = 'starting'; job.startedAt = now(); await this.store.save();
      if (job.stopReason) { job.status = job.stopReason; return; }
      const module = await safePath(this.project.root, this.project.preview.module);
      const database = await safePath(this.project.root, `.onequeue/${job.id}.sqlite`, { missing: true });
      if (job.stopReason) { job.status = job.stopReason; return; }
      const child = this.launch(job, [workerPath, module, this.project.preview.export, database], true);
      timer = setTimeout(() => { job.stopReason ||= 'timed_out'; void this.kill(job); }, 20000);
      const ready = await Promise.race([
        new Promise(resolve => child.on('message', value => { if (value?.type === 'ready') resolve(value); })),
        child.completion.then(() => null)
      ]);
      if (ready && !job.stopReason) {
        requireThat(Number.isInteger(ready.port) && ready.port > 0 && ready.port < 65536, 'INVALID_PORT', '미리보기 포트가 잘못되었습니다.');
        job.url = `http://127.0.0.1:${ready.port}`;
        const response = await fetch(`${job.url}${this.project.preview.healthPath}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
        await response.body?.cancel();
        requireThat(response.ok, 'HEALTH_FAILED', '미리보기 상태 확인에 실패했습니다.');
        if (!job.stopReason) { job.status = 'ready'; job.readyAt = now(); await this.store.save(); }
      }
      clearTimeout(timer);
      const result = await child.completion;
      job.status = job.stopReason || 'failed'; job.exitCode = result.exitCode;
      if (!job.stopReason) this.append(job, '미리보기 프로세스가 예기치 않게 종료되었습니다.');
    } catch (error) { job.status = job.stopReason || 'failed'; this.append(job, error.message); await this.kill(job); }
    finally { clearTimeout(timer); job.finishedAt = now(); this.children.delete(job.id); await this.store.save(); }
  }
  async kill(job) {
    const child = this.children.get(job.id);
    if (!child || child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      await new Promise(resolve => {
        const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false, stdio: 'ignore' });
        killer.once('error', () => { child.kill(); resolve(); }); killer.once('close', resolve);
      });
    } else {
      try { process.kill(-child.pid, 'SIGKILL'); } catch (e) { if (e.code !== 'ESRCH') throw e; }
    }
  }
  async cancel(id, stopped = false) {
    const job = this.get(id);
    if (!active.has(job.status)) return this.view(job);
    job.stopReason = stopped && job.kind === 'preview' ? 'stopped' : 'cancelled';
    if (job.status === 'queued') { job.status = job.stopReason; job.finishedAt = now(); }
    else { job.status = stopped && job.kind === 'preview' ? 'stopping' : 'cancelling'; await this.kill(job); }
    await this.store.save();
    return this.view(job);
  }
  async close() {
    this.closing = true;
    for (const job of this.store.state.jobs) if (active.has(job.status)) await this.cancel(job.id, true);
    await Promise.allSettled([...this.tasks]);
  }
}
