import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture,brief,finish } from './helpers.mjs';
import { evaluateRelease,releaseCategories } from '../src/release.mjs';
const product={policyVersion:3,target:'deployed',maturity:'pilot',capabilities:[],designBrief:'Purpose-specific interaction',requirements:[{id:'R1',required:true,acceptance:['Observable outcome']}]};
const local=releaseCategories.map(category=>({id:category,category,stage:'release',required:true,requirementIds:['R1'],status:'passed',verification:{kind:'check'},evidence:{kind:'check',detail:{report:{cases:[{id:'flow',tags:[],status:'passed'}]}}}}));
const live={id:'live',category:'production',stage:'production',required:true,status:'passed',covers:['production-smoke','production-login'],verification:{kind:'review'},evidence:{provenance:{environment:'production',identity:'real',actors:1,methods:['user-confirmation','database-read'],limitations:['No multi-user production browser journey.']}}};
const receipt={status:'verified',sourceHash:'hash'};
test('manual-only categories, label-only coverage and local identity cannot pass release gates',()=>{
  const manual=local.map(c=>({...c,verification:{kind:'review'},evidence:{kind:'review'}}));
  assert.equal(evaluateRelease(product,[...manual,live],receipt,'hash').complete,false);
  const caps={...product,capabilities:['responsive','liveUpdates','timeDependent','exportsData']};
  const labels=local.map(c=>({...c,covers:['mobile-actions','contrast','keyboard','focus-retention','live-update','time-boundary','export-download']}));
  const status=evaluateRelease(caps,[...labels,live],receipt,'hash');
  assert.equal(status.complete,false);assert.ok(status.blockers.some(x=>x.includes('time-boundary')));
  assert.equal(evaluateRelease(product,[...local,{...live,evidence:{provenance:{environment:'local',identity:'synthetic',actors:2}}}],receipt,'hash').complete,false);
  assert.equal(evaluateRelease(product,[...local,live],receipt,'hash').complete,true);
  const mature=evaluateRelease({...product,maturity:'production',capabilities:['multiUser'],operatingEnvelope:'20 daily active users, restore within a day'},[...local,live],receipt,'hash');
  assert.ok(mature.blockers.some(x=>x.includes('실제 두 사용자')));assert.ok(mature.blockers.some(x=>x.includes('capacity')));
});

test('mobile export and deadline UI require combined cases, not unrelated passing labels',()=>{
  const caps={...product,capabilities:['responsive','exportsData','liveUpdates','timeDependent']};
  const tags=['mobile-actions','contrast','keyboard','export-download','focus-retention','live-update','time-boundary'];
  const checks=local.map(c=>({...c,covers:tags,evidence:{kind:'check',detail:{report:{cases:tags.map(tag=>({id:tag,tags:[tag],status:'passed'}))}}}}));
  let state=evaluateRelease(caps,[...checks,live],receipt,'hash');
  assert.equal(state.complete,false);
  assert.ok(state.blockers.some(x=>x.includes('mobile-export')));assert.ok(state.blockers.some(x=>x.includes('deadline-ui')));
  checks[0].evidence.detail.report.cases.push(
    {id:'mobile-export-combined',tags:['mobile-actions','export-download'],status:'passed'},
    {id:'deadline-combined',tags:['time-boundary','live-update'],status:'passed'});
  state=evaluateRelease(caps,[...checks,live],receipt,'hash');assert.equal(state.complete,true);
});
test('same-ID requirement/acceptance and criterion edits need a change reason; reductions need user evidence',async()=>{
  const f=await fixture(),app=await f.app();
  try{
    const value={...brief,requirements:[{id:'R1',description:'Two users join and see each other records',acceptance:['Independent sessions both read the saved record']}],criteria:[{...brief.criteria[0],requirementIds:['R1']}]};
    await app.brief('fixture',value,0);
    const weaker={...value,requirements:[{...value.requirements[0],description:'Home page appears'}]};
    await assert.rejects(app.brief('fixture',weaker,1),{code:'SCOPE_CHANGE_REQUIRES_EVIDENCE'});
    await assert.rejects(app.brief('fixture',{...value,requirements:[{...value.requirements[0],acceptance:[]}],scopeChanges:[{requirementId:'R1',impact:'refinement',reason:'Remove the observable acceptance condition.'}]},1),{code:'SCOPE_CHANGE_REQUIRES_EVIDENCE'});
    await assert.rejects(app.brief('fixture',{...value,criteria:[{...value.criteria[0],verification:{kind:'browser',assertion:{kind:'visible',selector:'body'}}}]},1),{code:'SCOPE_CHANGE_REQUIRES_EVIDENCE'});
    await app.brief('fixture',{...weaker,scopeChanges:[{requirementId:'R1',impact:'reduction',reason:'User changed the delivery to a landing page.',userEvidence:'User message: only the introductory page is required.'}]},1);
    assert.equal(app.get('fixture').store.state.briefHistory[0].requirements[0].description,value.requirements[0].description);
    assert.equal((await app.status('fixture')).criteria[0].status,'unverified');
  }finally{await app.close();await f.cleanup();}
});
test('structured check reports are bound to the current run; stale, skipped and empty reports fail',async()=>{
  const f=await fixture();f.config.projects[0].checks.pass.reportPath='test-results/report.json';await writeFile(f.configPath,JSON.stringify(f.config));
  const script=status=>`import {writeFile,mkdir} from 'node:fs/promises';await mkdir('test-results',{recursive:true});await writeFile(process.env.ONEQUEUE_REPORT_PATH,JSON.stringify({schemaVersion:1,runId:process.env.ONEQUEUE_RUN_ID,cases:${status==='empty'?'[]':JSON.stringify([{id:'mobile-export',tags:['mobile-actions','export-download'],status}])}}));`;
  const app=await f.app();
  try{
    await app.brief('fixture',brief,0);const {jobs}=app.get('fixture');
    for(const status of ['skipped','failed','empty','passed']){
      await writeFile(join(f.root,'src/pass.mjs'),script(status));const job=await jobs.create('checks',status,['pass']);
      assert.equal((await finish(jobs,job.id)).status,status==='passed'?'succeeded':'failed');
    }
    const valid=(await app.status('fixture')).criteria[0].evidence;assert.ok(valid.detail.reportArtifact.sha256);
    await writeFile(join(f.root,'src/pass.mjs'),"console.log('Reuse old report');");
    const stale=await jobs.create('checks','old-report',['pass']);assert.equal((await finish(jobs,stale.id)).status,'failed');
    assert.match(jobs.get(stale.id).logs,/이번 실행/);
    // Restore the checked source, then alter only its evidence artifact.
    await writeFile(join(f.root,'src/pass.mjs'),script('passed'));const fresh=await jobs.create('checks','fresh',['pass']);await finish(jobs,fresh.id);
    const path=join(f.root,'test-results/report.json');await writeFile(path,(await readFile(path,'utf8'))+' ');
    assert.equal((await app.status('fixture')).criteria[0].status,'stale');
  }finally{await app.close();await f.cleanup();}
});
test('major findings block completion until a new current-source recheck; legacy status is explicit',async()=>{
  const f=await fixture(),app=await f.app();
  try{
    await app.brief('fixture',brief,0);const p=app.get('fixture');let job=await p.jobs.create('checks','first',['pass']);await finish(p.jobs,job.id);
    await writeFile(join(f.root,'finding.txt'),'Keyboard focus disappears during polling.');
    await app.finding('fixture',{findingId:'focus-loss',criterionIds:['AC-1'],severity:'major',summary:'Keyboard focus is lost during background updates.',artifactPaths:['finding.txt']});
    assert.equal((await app.status('fixture')).verified,false);
    await assert.rejects(app.resolveFinding('fixture',{findingId:'focus-loss'}),{code:'FRESH_RECHECK_REQUIRED'});
    await writeFile(join(f.root,'src/fixed.mjs'),'export const fixed=true;');
    job=await p.jobs.create('checks','recheck',['pass']);await finish(p.jobs,job.id);await app.resolveFinding('fixture',{findingId:'focus-loss'});
    assert.equal((await app.status('fixture')).verified,true);
    delete p.store.state.brief.policyVersion;
    const legacy=await app.status('fixture');assert.equal(legacy.status,'migration_required');assert.equal(legacy.verified,false);
    assert.equal(p.store.state.evidence.length,2);
  }finally{await app.close();await f.cleanup();}
});

test('the supplied reporter records real assertions, exits on failure and enables a covered release',async()=>{
  const f=await fixture();f.config.projects[0].checks.pass.reportPath='test-results/report.json';await writeFile(f.configPath,JSON.stringify(f.config));
  const reporter=new URL('../src/check-report.mjs',import.meta.url).href;
  const script=ok=>`import assert from 'node:assert/strict';import {createCheckReport} from ${JSON.stringify(reporter)};const r=createCheckReport();await r.case('responsive-controls',['mobile-actions','contrast','keyboard'],async()=>{assert.equal(1,${ok?1:2});});await r.finish();`;
  const app=await f.app();
  try{
    const value={...brief,target:'release',maturity:'pilot',capabilities:['responsive'],designBrief:'Responsive workspace with direct actions',requirements:[{id:'R1',description:'Responsive controls meet the expected result',acceptance:['Mobile actions, contrast and keyboard checks pass']}],criteria:releaseCategories.map(category=>({id:category,description:'Expected '+category+' result',category,requirementIds:['R1'],covers:category==='accessibility'?['mobile-actions','contrast','keyboard']:[],verification:{kind:'check',checkId:'pass'}}))};
    await app.brief('fixture',value,0);const {jobs}=app.get('fixture');
    await writeFile(join(f.root,'src/pass.mjs'),script(false));let job=await jobs.create('checks','reporter-fail',['pass']);assert.equal((await finish(jobs,job.id)).status,'failed');
    assert.equal(JSON.parse(await readFile(join(f.root,'test-results/report.json'),'utf8')).cases[0].status,'failed');
    assert.equal((await app.status('fixture')).verified,false);
    await writeFile(join(f.root,'finding.txt'),'An observed mobile controls regression.');
    await app.finding('fixture',{findingId:'mobile-controls',criterionIds:['accessibility'],severity:'major',summary:'Mobile controls fail an expected result.',artifactPaths:['finding.txt']});
    await writeFile(join(f.root,'src/pass.mjs'),script(true));job=await jobs.create('checks','reporter-pass',['pass']);assert.equal((await finish(jobs,job.id)).status,'succeeded');
    assert.equal((await app.status('fixture')).verified,false);
    await app.resolveFinding('fixture',{findingId:'mobile-controls'});
    const state=await app.status('fixture');assert.equal(state.verified,true);assert.equal(state.status,'release_ready');
    assert.deepEqual(state.requiredCoverage,['mobile-actions','contrast','keyboard']);
  }finally{await app.close();await f.cleanup();}
});
