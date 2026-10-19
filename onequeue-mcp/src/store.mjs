import { mkdir, readFile, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { safePath, atomicJson, requireThat, now } from './util.mjs';

export class Store {
  constructor(project) { this.project = project; this.tail = Promise.resolve(); }
  async init({readOnly=false}={}) {
    this.readOnly=readOnly;
    this.dir = await safePath(this.project.root, '.onequeue', { missing: true });
    if(readOnly){
      this.path=await safePath(this.project.root,'.onequeue/state.json',{missing:true});
      try{this.state=JSON.parse(await readFile(this.path,'utf8'));}
      catch(e){if(e.code!=='ENOENT')throw e;this.state={version:1,brief:null,jobs:[],evidence:[]};}
      requireThat(this.state.version===1 && Array.isArray(this.state.jobs) && Array.isArray(this.state.evidence),'INVALID_STATE','지원하지 않거나 손상된 상태 파일입니다.');
      return this;
    }
    await mkdir(this.dir, { recursive: true });
    this.lockPath = await safePath(this.project.root, '.onequeue/owner.json', { missing: true });
    this.owner = { pid: process.pid, token: randomUUID() };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const file = await open(this.lockPath, 'wx', 0o600);
        await file.writeFile(JSON.stringify(this.owner)); await file.close(); break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        let prior;
        try { prior = JSON.parse(await readFile(this.lockPath, 'utf8')); }
        catch { throw new Error('원큐 잠금 파일을 읽을 수 없습니다. 실행 중인 서버를 확인하세요.'); }
        let alive = true;
        try { process.kill(prior.pid, 0); } catch (e) { alive = e.code !== 'ESRCH'; }
        requireThat(!alive && attempt === 0, 'PROJECT_IN_USE', '다른 원큐 서버가 이 프로젝트를 사용 중입니다.');
        await unlink(this.lockPath);
      }
    }
    try {
      this.path = await safePath(this.project.root, '.onequeue/state.json', { missing: true });
      try { this.state = JSON.parse(await readFile(this.path, 'utf8')); }
      catch (e) { if (e.code !== 'ENOENT') throw e; this.state = { version: 1, brief: null, jobs: [], evidence: [] }; }
      requireThat(this.state.version === 1 && Array.isArray(this.state.jobs) && Array.isArray(this.state.evidence), 'INVALID_STATE', '지원하지 않거나 손상된 상태 파일입니다.');
      for (const j of this.state.jobs) if (['queued', 'running', 'starting', 'ready', 'cancelling', 'stopping'].includes(j.status)) {
        j.status = 'interrupted'; j.finishedAt = now(); j.reason = 'MCP 서버 재시작으로 중단되었습니다.';
      }
      await this.save();
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  save() {
    requireThat(!this.readOnly,'READ_ONLY_STORE','읽기 전용 상태 조회는 기록을 변경할 수 없습니다.');
    const snapshot = structuredClone(this.state);
    const write = this.tail.then(async () => {
      await safePath(this.project.root, '.onequeue/state.json', { missing: true });
      await atomicJson(this.path, snapshot);
    });
    this.tail = write.catch(() => {});
    return write;
  }
  async artifactPath(name) {
    const path = await safePath(this.project.root, `.onequeue/artifacts/${name}`, { missing: true });
    await mkdir(join(this.dir, 'artifacts'), { recursive: true });
    return path;
  }
  async close() {
    if(this.readOnly)return;
    await this.tail;
    try {
      const owner = JSON.parse(await readFile(this.lockPath, 'utf8'));
      if (owner.token === this.owner.token) await unlink(this.lockPath);
    } catch (e) { if (e.code !== 'ENOENT') throw e; }
  }
}
