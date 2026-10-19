import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { evaluateRelease } from './release.mjs';
import { loadConfig, briefSchema } from './config.mjs';
import { POLICY_VERSION, capabilityChecks, evidenceIssues } from './policy.mjs';
import { Store } from './store.mjs';
import { Jobs } from './jobs.mjs';
import { Browsers } from './browser.mjs';
import { fingerprint, requireThat, now, safePath } from './util.mjs';

export class OneQueue {
  constructor() { this.projects = new Map(); }
  async init(configPath, {readOnly=false}={}) {
    try {
      for (const project of await loadConfig(configPath)) {
        const store = await new Store(project).init({readOnly});
        const jobs = new Jobs(project, store);
        this.projects.set(project.id, { project, store, jobs, browsers: new Browsers(project, store, jobs), tail: Promise.resolve() });
      }
      return this;
    } catch (error) { await this.close(); throw error; }
  }
  get(id) { const item = this.projects.get(id); requireThat(item, 'PROJECT_NOT_FOUND', '등록된 프로젝트 ID를 지정하세요.'); return item; }
  serial(id, fn) {
    const p = this.get(id), promise = p.tail.then(() => fn(p));
    p.tail = promise.catch(() => {}); return promise;
  }
  list() { return [...this.projects.values()].map(({ project }) => ({ id: project.id, name: project.name, root: project.root, lineage:project.lineage })); }
  async inspect(id) {
    if (!id) return { projects: this.list() };
    const { project } = this.get(id);
    const packagePath = await safePath(project.root, 'package.json');
    const pkg = JSON.parse(await readFile(packagePath, 'utf8'));
    return { ...project, package: { name: pkg.name, engines: pkg.engines, scripts: pkg.scripts }, fingerprint: await fingerprint(project),
      runtime: process.version, serverVersion:'0.3.0', policyVersion:POLICY_VERSION, capabilityChecks,
      support:{qualityChecks:fileURLToPath(new URL('./quality-checks.mjs',import.meta.url)),checkReport:fileURLToPath(new URL('./check-report.mjs',import.meta.url))},
      limits: { browserLocalOnly: true, deploymentOriginAllowlist: true, arbitraryShell: false, browserSessions: 6, sandboxed: false, productionBrowserAdapter:false },
      note: 'sources에 포함된 파일만 지문에 반영합니다. 등록 명령은 현재 사용자 권한으로 실행됩니다.' };
  }
  async brief(id, value, expectedVersion) {
    const { store, project } = this.get(id), prior = store.state.brief;
    requireThat((prior?.version || 0) === expectedVersion, 'BRIEF_VERSION_CONFLICT', '명세가 변경되었습니다. 최신 명세를 읽고 다시 저장하세요.');
    const brief = briefSchema.parse(value);
    const levels = { prototype: 0, release: 1, deployed: 2 };
    if (prior?.target && levels[brief.target] < levels[prior.target]) requireThat(brief.targetChangeEvidence, 'DELIVERY_DOWNGRADE_REQUIRES_EVIDENCE', '납품 수준을 낮추려면 사용자의 변경 요청 근거가 필요합니다.');
    const acknowledge=(subject,key,reduction)=>{
      const change=brief.scopeChanges.find(c=>c.subject===subject && c.requirementId===key);
      requireThat(change,'SCOPE_CHANGE_REQUIRES_EVIDENCE','명세 내용 변경의 사유를 기록하세요: '+subject+'/'+key);
      if(reduction || change.impact==='reduction')requireThat(change.impact==='reduction' && change.userEvidence,'SCOPE_CHANGE_REQUIRES_EVIDENCE','범위 축소에는 사용자 변경 요청 근거가 필요합니다: '+key);
    };
    for(const r of prior?.requirements || []) {
      const next=brief.requirements.find(x=>x.id===r.id);
      if(!next || (r.required && !next.required)) {acknowledge('requirement',r.id,true);continue;}
      if(r.description!==next.description || JSON.stringify(r.acceptance || [])!==JSON.stringify(next.acceptance))
        acknowledge('requirement',r.id,(r.acceptance || []).some(a=>!next.acceptance.includes(a)));
    }
    for(const c of prior?.criteria || []) {
      const next=brief.criteria.find(x=>x.id===c.id);
      if(!next || (c.required && !next.required)){acknowledge('criterion',c.id,true);continue;}
      const normalized=x=>({description:x.description,category:x.category || 'functional',stage:x.stage || 'local',verification:x.verification,requirementIds:x.requirementIds || [],covers:x.covers || []});
      if(JSON.stringify(normalized(c))!==JSON.stringify(normalized(next)))acknowledge('criterion',c.id,
        (c.verification.kind!=='review' && next.verification.kind==='review') || (c.stage!=='production' && next.stage==='production') ||
        (c.requirementIds || []).some(id=>!next.requirementIds.includes(id)) || (c.covers || []).some(tag=>!next.covers.includes(tag)));
    }
    if(prior?.capabilities && prior.capabilities.some(c=>!brief.capabilities.includes(c)))acknowledge('capabilities','profile',true);
    if(prior?.maturity==='production' && brief.maturity!=='production')acknowledge('maturity','profile',true);
    requireThat(new Set(brief.criteria.map(c => c.id)).size === brief.criteria.length, 'DUPLICATE_CRITERION', '완료 조건 ID는 중복될 수 없습니다.');
    requireThat(new Set(brief.requirements.map(r => r.id)).size === brief.requirements.length, 'DUPLICATE_REQUIREMENT', '요구사항 ID는 중복될 수 없습니다.');
    for (const c of brief.criteria) for (const rid of c.requirementIds) requireThat(brief.requirements.some(r => r.id === rid), 'UNKNOWN_REQUIREMENT', '등록되지 않은 요구사항: ' + rid);
    requireThat(brief.criteria.some(c => c.required), 'REQUIRED_CRITERION', '필수 완료 조건이 하나 이상 필요합니다.');
    for (const criterion of brief.criteria) if (criterion.verification.kind === 'check') requireThat(project.checks[criterion.verification.checkId], 'UNKNOWN_CHECK', '등록되지 않은 검증 ID입니다.');
    for(const c of brief.criteria) if(c.verification.kind==='journey') {
      requireThat(c.verification.steps.some(s=>s.action==='assert'),'JOURNEY_ASSERTION_REQUIRED','시나리오에는 결과 검사가 필요합니다.');
      requireThat(c.verification.steps.reduce((n,s)=>n+(s.action==='wait'?s.ms:0),0)<=30000,'JOURNEY_WAIT_LIMIT','시나리오의 대기 합계는 30초 이하여야 합니다.');
    }
    store.state.briefHistory ||= [];
    if (prior) store.state.briefHistory.push(prior);
    store.state.brief = { ...brief, policyVersion:POLICY_VERSION, version: expectedVersion + 1, savedAt: now() };
    await store.save(); return store.state.brief;
  }
  async status(id, detail='full') {
    const { project, store } = this.get(id), current = await fingerprint(project), brief = store.state.brief;
    const criteria = await Promise.all((brief?.criteria || []).map(async criterion => {
      const candidates = store.state.evidence.filter(e => e.briefVersion === brief.version &&
        (criterion.verification.kind === 'check' ? e.kind === 'check' && e.checkId === criterion.verification.checkId : e.kind === criterion.verification.kind && e.criterionId === criterion.id));
      const latest = candidates.at(-1);
      let state = !latest ? 'unverified' : latest.sourceChanged || latest.fingerprint !== current.hash ? 'stale' : latest.status;
      for (const artifact of [...(latest?.artifacts || []),...(latest?.detail?.reportArtifact?[latest.detail.reportArtifact]:[])]) {
        try { if (createHash('sha256').update(await readFile(await safePath(project.root, artifact.path))).digest('hex') !== artifact.sha256) state = 'stale'; }
        catch { state = 'stale'; }
      }
      return { ...criterion, status: state, evidence: latest || null };
    }));
    const release = evaluateRelease(brief, criteria, store.state.deployment, current.hash, store.state.findings || []);
    const response={ projectId: id, serverVersion:'0.3.0',fingerprint: current, brief, criteria,
      verified: release.complete, ...release, deployment: store.state.deployment || null,
      jobs: store.state.jobs.slice(-30).map(({ logs, signature, ...job }) => job),
      note: 'verified는 선택한 납품 수준의 완료 여부입니다. localVerified만으로 출시·배포 완료를 뜻하지 않습니다. 수동 검토는 검토자의 판단 근거이며 독립 감사 인증이 아닙니다.' };
    if(detail==='summary'){response.brief=brief?{title:brief.title,version:brief.version}:null;response.criteria=criteria.map(({id,status,evidence})=>({id,status,evidenceId:evidence?.id || null}));delete response.jobs;}
    return response;
  }
  async artifacts(id,paths) {
    const {project}=this.get(id),artifacts=[];
    for(const path of paths){const bytes=await readFile(await safePath(project.root,path));requireThat(bytes.length<=10*1024*1024,'REVIEW_ARTIFACT_LIMIT','검토 자료는 파일당 10 MiB 이하여야 합니다.');artifacts.push({path,sha256:createHash('sha256').update(bytes).digest('hex')});}
    return artifacts;
  }
  async review(id, { criterionId, passed, reviewer, summary, artifactPaths, provenance }) {
    const { project, store } = this.get(id), brief = store.state.brief;
    const c = brief?.criteria.find(c => c.id === criterionId);
    requireThat(c?.verification.kind === 'review', 'REVIEW_CRITERION_REQUIRED', '검토형 완료 조건을 지정하세요.');
    if(brief.target!=='prototype') {
      requireThat(!['functional','security','build'].includes(c.category),'EXECUTABLE_EVIDENCE_REQUIRED','기능·보안·빌드는 수동 승인으로 통과할 수 없습니다.');
      requireThat(provenance,'REVIEW_PROVENANCE_REQUIRED','검토 환경·방법·사용자 수·한계를 기록하세요.');
    }
    const artifacts=await this.artifacts(id,artifactPaths);
    const evidence = { id:randomUUID(),kind: 'review', criterionId, reviewer, summary, artifacts, provenance,briefVersion: brief.version, fingerprint: (await fingerprint(project)).hash, status: passed ? 'passed' : 'failed', createdAt: now() };
    store.state.evidence.push(evidence); await store.save(); return evidence;
  }
  async finding(id,{findingId,criterionIds,severity,summary,artifactPaths}) {
    const {store,project}=this.get(id);store.state.findings ||= [];
    requireThat(!store.state.findings.some(f=>f.id===findingId),'FINDING_EXISTS','이미 기록된 결함 ID입니다.');
    for(const cid of criterionIds)requireThat(store.state.brief?.criteria.some(c=>c.id===cid),'UNKNOWN_CRITERION','등록되지 않은 완료 조건: '+cid);
    const finding={id:findingId,criterionIds,severity,summary,status:'open',createdAt:now(),fingerprint:(await fingerprint(project)).hash,evidenceOffset:store.state.evidence.length,artifacts:await this.artifacts(id,artifactPaths)};
    store.state.findings.push(finding);await store.save();return finding;
  }
  async resolveFinding(id,{findingId}) {
    const {store}=this.get(id),f=store.state.findings?.find(f=>f.id===findingId);
    requireThat(f && f.status==='open','OPEN_FINDING_REQUIRED','열린 결함을 지정하세요.');
    const status=await this.status(id),evidenceIds=[];
    for(const cid of f.criterionIds){const c=status.criteria.find(c=>c.id===cid),e=c?.evidence;
      requireThat(!status.migrationRequired && c?.status==='passed' && e?.id && e.kind!=='review' && store.state.evidence.indexOf(e)>=f.evidenceOffset &&
        (status.target==='prototype' || evidenceIssues(c).length===0),'FRESH_RECHECK_REQUIRED','결함 기록 이후 현재 정책·소스의 실행 검사를 통과해야 합니다: '+cid);
      evidenceIds.push(e.id);
    }
    f.status='resolved';f.resolvedAt=now();f.resolution={fingerprint:status.fingerprint.hash,briefVersion:status.brief.version,evidenceIds};await store.save();return f;
  }
  async deployment(id, { origin, deploymentId, versionId, commitSha, sourceHash, healthPath, expectedRelease, expectedBuildHash }) {
    const { project, store } = this.get(id), current = await fingerprint(project);
    requireThat(project.deploymentOrigins.includes(origin), 'DEPLOYMENT_ORIGIN_NOT_ALLOWED', '호스트 설정에 등록한 배포 주소만 검증할 수 있습니다.');
    requireThat(current.hash === sourceHash, 'DEPLOYMENT_SOURCE_CHANGED', '배포 소스와 현재 소스가 다릅니다.');
    const url = new URL(healthPath, origin);
    requireThat(url.origin === origin && !url.username && !url.password, 'DEPLOYMENT_PATH_NOT_ALLOWED', '동일 origin의 상태 경로를 사용하세요.');
    const headers = { Accept: 'application/json' };
    if (project.deploymentAuth) {
      const value = process.env[project.deploymentAuth.env];
      requireThat(value, 'DEPLOYMENT_AUTH_MISSING', '호스트의 배포 확인용 인증 환경변수가 필요합니다.');
      headers[project.deploymentAuth.header] = 'Bearer ' + value;
    }
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15000), headers });
    requireThat(response.status === 200, 'DEPLOYMENT_HEALTH_FAILED', '배포 환경 상태 확인 실패: HTTP ' + response.status);
    const body = await response.json();
    requireThat(body.ok === true && body.release === expectedRelease && body.buildHash === expectedBuildHash, 'DEPLOYMENT_RELEASE_MISMATCH', '배포된 릴리스 또는 빌드 소스 식별자가 일치하지 않습니다.');
    requireThat((await fingerprint(project)).hash === sourceHash, 'DEPLOYMENT_SOURCE_CHANGED', '배포 확인 중 소스가 바뀌었습니다.');
    store.state.deployment = { origin, deploymentId, versionId, commitSha, sourceHash, expectedRelease, expectedBuildHash, checkedAt: now(), status: 'verified' };
    await store.save(); return store.state.deployment;
  }
  async close() {
    for (const p of this.projects.values()) {
      if(p.store.readOnly){await p.store.close();continue;}
      await p.tail; await p.browsers.close(); await p.jobs.close(); await p.store.close();
    }
    this.projects.clear();
  }
}
