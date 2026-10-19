export const POLICY_VERSION = 3;
export const capabilityChecks = {
  responsive: ['mobile-actions','contrast','keyboard'], liveUpdates: ['focus-retention','live-update'],
  timeDependent: ['time-boundary'], persistence: ['reload-persistence','recovery'],
  accounts: ['authorization','account-lifecycle'], multiUser: ['multi-user','authorization'], exportsData: ['export-download']
};
export function requiredCoverage(brief) {
  return [...new Set([...(brief?.capabilities || []).flatMap(c=>capabilityChecks[c] || []),
    ...(brief?.maturity === 'production' ? ['capacity'] : [])])];
}
export function observedCoverage(criterion) {
  const e=criterion.evidence;
  if(criterion.status !== 'passed') return [];
  if(e?.kind==='check') return [...new Set((e.detail?.report?.cases || []).filter(c=>c.status==='passed').flatMap(c=>c.tags))];
  if(e?.kind==='journey') return e.detail?.coverage || [];
  return [];
}
export function requiredScenarios(brief) {
  const has=c=>brief?.capabilities?.includes(c),scenarios=[];
  if(has('responsive') && has('exportsData'))scenarios.push({id:'mobile-export',tags:['mobile-actions','export-download']});
  if(has('liveUpdates') && has('timeDependent'))scenarios.push({id:'deadline-ui',tags:['time-boundary','live-update']});
  return scenarios;
}
export function observedScenario(criterion,tags) {
  if(criterion.status!=='passed' || !tags.every(tag=>criterion.covers?.includes(tag)))return false;
  // A desktop export and an unrelated mobile button do not prove mobile export works.
  return criterion.evidence?.kind==='check' && criterion.evidence.detail?.report?.cases?.some(c=>c.status==='passed' && tags.every(tag=>c.tags.includes(tag)));
}
export function evidenceIssues(c) {
  const issues=[], kind=c.verification?.kind;
  const allowed={functional:['check','journey'],security:['check','journey'],build:['check']};
  if(allowed[c.category] && !allowed[c.category].includes(kind)) issues.push(c.id+': 실행 근거가 필요한 영역입니다 ('+c.category+')');
  if(kind==='check' && c.category!=='build' && c.status==='passed' && !c.evidence?.detail?.report?.cases?.some(x=>x.status==='passed')) issues.push(c.id+': 실행 사례 보고서가 없습니다');
  for(const tag of c.covers || []) if(!tag.startsWith('production-') && c.status==='passed' && !observedCoverage(c).includes(tag)) issues.push(c.id+': 실행되지 않은 검증 태그 '+tag);
  if(c.stage==='production' && c.status==='passed') {
    const p=c.evidence?.provenance;
    if(p?.environment!=='production') issues.push(c.id+': 실제 운영 환경의 출처가 없습니다');
    if((c.covers || []).includes('production-login') && (p?.identity!=='real' || p?.actors<1 ||
      !(p?.methods?.includes('observed-browser') || (p?.methods?.includes('user-confirmation') && p?.methods?.includes('database-read'))))) issues.push(c.id+': 실제 로그인 사용자와 저장 확인 근거가 필요합니다');
  }
  return issues;
}
