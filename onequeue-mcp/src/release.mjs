import { POLICY_VERSION, requiredCoverage, observedCoverage, requiredScenarios, observedScenario, evidenceIssues } from './policy.mjs';
export const releaseCategories = ['functional','design','accessibility','security','build','operations'];
export function evaluateRelease(brief, criteria, deployment, sourceHash, findings=[]) {
  const blockers=[], required=criteria.filter(c=>c.required), target=brief?.target || 'unscoped';
  const migrationRequired=!!brief && brief.policyVersion!==POLICY_VERSION;
  const local=required.filter(c=>c.stage!=='production'), production=required.filter(c=>c.stage==='production');
  const openFindings=findings.filter(f=>f.status!=='resolved');
  if(migrationRequired) blockers.push('검증 정책 전환 필요: 기존 명세와 증거는 보존되며 v3 기준으로 자동 승격되지 않습니다.');
  for(const f of openFindings) if(['blocking','major'].includes(f.severity)) blockers.push('미해결 결함 '+f.id+': '+f.summary);
  const localVerified=!migrationRequired && local.length>0 && local.every(c=>c.status==='passed');
  if(target!=='prototype') {
    if(!brief?.requirements?.length) blockers.push('제품 요구사항이 등록되지 않았습니다.');
    if(!brief?.designBrief?.trim()) blockers.push('제품별 디자인 명세가 없습니다.');
    for(const r of brief?.requirements || []) {
      if(!r.required && !r.scopeEvidence?.trim()) blockers.push('제외 근거 없음: '+r.id);
      if(r.required && !r.acceptance?.length) blockers.push('구체적인 수락 조건 없음: '+r.id);
      if(r.required && !required.some(c=>c.requirementIds?.includes(r.id))) blockers.push('검증에 연결되지 않은 요구사항: '+r.id);
    }
    for(const category of releaseCategories) if(!local.some(c=>c.category===category)) blockers.push('필수 검증 영역 누락: '+category);
    for(const c of local) blockers.push(...evidenceIssues(c));
    for(const tag of requiredCoverage(brief)) if(!local.some(c=>c.covers?.includes(tag) && observedCoverage(c).includes(tag))) blockers.push('필수 사용 시나리오 미검증: '+tag);
    for(const scenario of requiredScenarios(brief)) if(!local.some(c=>observedScenario(c,scenario.tags))) blockers.push('동일 실행 사례에서 확인할 시나리오 미검증: '+scenario.id);
    if(brief?.maturity==='production' && !brief.operatingEnvelope?.trim()) blockers.push('운영 규모와 복구 목표가 없습니다.');
  }
  for(const c of local) if(c.status!=='passed') blockers.push(c.id+': '+c.status);
  const releaseReady=target!=='prototype' && localVerified && blockers.length===0;
  const productionBlockers=[];
  if(!production.some(c=>c.covers?.includes('production-smoke'))) productionBlockers.push('운영 화면·접근 경계 확인 조건이 없습니다.');
  if(brief?.capabilities?.includes('accounts') && !production.some(c=>c.covers?.includes('production-login'))) productionBlockers.push('운영 로그인 조건이 없습니다.');
  for(const c of production) { if(c.status!=='passed') productionBlockers.push(c.id+': '+c.status); productionBlockers.push(...evidenceIssues(c)); }
  if(brief?.maturity==='production' && brief?.capabilities?.includes('multiUser') && !production.some(c=>c.status==='passed' && c.covers?.includes('production-login') && c.evidence?.provenance?.identity==='real' && c.evidence?.provenance?.actors>=2 && c.evidence?.provenance?.methods?.includes('observed-browser'))) productionBlockers.push('운영 단계의 실제 두 사용자 흐름이 미검증입니다.');
  if(!deployment || deployment.sourceHash!==sourceHash || deployment.status!=='verified') productionBlockers.push('현재 소스에 대응하는 배포 확인 근거가 없습니다.');
  const deployedVerified=releaseReady && productionBlockers.length===0;
  if(target==='deployed') blockers.push(...productionBlockers);
  const complete=target==='prototype' ? localVerified && blockers.length===0 : target==='release' ? releaseReady : target==='deployed' ? deployedVerified : false;
  return {policyVersion:POLICY_VERSION,migrationRequired,target,maturity:brief?.maturity || 'unspecified',localVerified,releaseReady,deployedVerified,complete,
    status:migrationRequired?'migration_required':deployedVerified?'deployed_verified':releaseReady?'release_ready':localVerified?'local_verified':'incomplete',blockers,
    openFindings:openFindings.map(({id,severity,summary,criterionIds})=>({id,severity,summary,criterionIds})),requiredCoverage:requiredCoverage(brief),requiredScenarios:requiredScenarios(brief)};
}
