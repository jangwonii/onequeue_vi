import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { evaluateRelease, releaseCategories } from '../src/release.mjs';
import { fixture, brief, finish } from './helpers.mjs';
import { fingerprint } from '../src/util.mjs';
const product = { policyVersion:3,capabilities:[],target: 'deployed', designBrief: 'Mobile social action feed', requirements: [{ id: 'R1', required: true,acceptance:['The expected operation completes.'] }] };
const conditions = releaseCategories.map(category => ({ id: category, required: true, requirementIds: ['R1'], category, stage: 'release', status: 'passed',verification:{kind:'check'},evidence:{kind:'check',detail:{report:{cases:[{id:'actual-case',status:'passed',tags:[]}]}}} }));
test('release status cannot promote trivial, omitted, unscoped or stale requirements', () => {
  assert.equal(evaluateRelease({}, [], null, 'hash').complete, false);
  const trivial = evaluateRelease({ policyVersion:3,target:'deployed' }, [{id:'one',required:true,status:'passed'}],null,'hash');
  assert.equal(trivial.localVerified,true); assert.equal(trivial.releaseReady,false);
  assert.equal(evaluateRelease(product, conditions, null, 'hash').releaseReady,true);
  assert.equal(evaluateRelease(product, conditions, null, 'hash').deployedVerified,false);
  const all = [...conditions,{id:'live',required:true,category:'production',stage:'production',status:'passed',covers:['production-smoke'],verification:{kind:'review'},evidence:{provenance:{environment:'production',identity:'none',actors:0,methods:['observed-browser']}}}];
  assert.equal(evaluateRelease(product,all,{status:'verified',sourceHash:'hash'},'hash').complete,true);
  assert.equal(evaluateRelease(product,all,{status:'verified',sourceHash:'old'},'hash').complete,false);
  assert.equal(evaluateRelease({...product,requirements:[{id:'R2',required:true}]},all,null,'hash').releaseReady,false);
  assert.equal(evaluateRelease({...product,requirements:[{id:'R1',required:true},{id:'R2',required:false}]},all,null,'hash').releaseReady,false);
  assert.equal(evaluateRelease({...product,target:'prototype'},conditions,null,'hash').complete,true);
});

test('deployment checks reject redirects, wrong build and changed source without recording secrets', async () => {
  const f=await fixture();
  f.config.projects[0].deploymentOrigins=['https://release.example'];
  f.config.projects[0].deploymentAuth={header:'OAI-Sites-Authorization',env:'ONEQUEUE_TEST_DEPLOY_TOKEN'};
  await writeFile(f.configPath,JSON.stringify(f.config));
  const app=await f.app(), originalFetch=globalThis.fetch;process.env.ONEQUEUE_TEST_DEPLOY_TOKEN='test-only-secret';
  try{
    const hash=(await fingerprint(app.get('fixture').project)).hash;
    const input={origin:'https://release.example',deploymentId:'deployment',versionId:'version',commitSha:'a'.repeat(40),sourceHash:hash,healthPath:'/api/health',expectedRelease:'2.0',expectedBuildHash:'b'.repeat(64)};
    globalThis.fetch=async(url,options)=>{assert.equal(options.redirect,'manual');assert.equal(options.headers['OAI-Sites-Authorization'],'Bearer test-only-secret');return new Response(null,{status:302,headers:{location:'https://elsewhere.example'}});};
    await assert.rejects(app.deployment('fixture',input),{code:'DEPLOYMENT_HEALTH_FAILED'});
    globalThis.fetch=async()=>Response.json({ok:true,release:'2.0',buildHash:'wrong'});
    await assert.rejects(app.deployment('fixture',input),{code:'DEPLOYMENT_RELEASE_MISMATCH'});
    globalThis.fetch=async()=>Response.json({ok:true,release:'2.0',buildHash:'b'.repeat(64)});
    await app.deployment('fixture',input);
    assert.ok(!JSON.stringify(app.get('fixture').store.state).includes('test-only-secret'));
    await writeFile(join(f.root,'src/new.mjs'),'changed source');
    await assert.rejects(app.deployment('fixture',input),{code:'DEPLOYMENT_SOURCE_CHANGED'});
    await assert.rejects(app.deployment('fixture',{...input,sourceHash:(await fingerprint(app.get('fixture').project)).hash,healthPath:'//other.example'}),{code:'DEPLOYMENT_PATH_NOT_ALLOWED'});
  }finally{globalThis.fetch=originalFetch;delete process.env.ONEQUEUE_TEST_DEPLOY_TOKEN;await app.close();await f.cleanup();}
});
test('review files are hashed, edits invalidate evidence, scope history survives, unknown mappings fail', async () => {
  const f=await fixture(),app=await f.app();
  try {
    const r={...brief,criteria:[{id:'review',description:'Visual inspection',required:true,verification:{kind:'review'}}]};
    await app.brief('fixture',r,0);
    await writeFile(join(f.root,'review.txt'),'Initial review evidence');
    await app.review('fixture',{criterionId:'review',passed:true,reviewer:'test reviewer',summary:'Inspected actual screenshots and interaction paths',artifactPaths:['review.txt']});
    assert.equal((await app.status('fixture')).localVerified,true);
    await writeFile(join(f.root,'review.txt'),'Changed evidence');
    assert.equal((await app.status('fixture')).criteria[0].status,'stale');
    await app.brief('fixture',r,1); assert.equal(app.get('fixture').store.state.briefHistory.length,1);
    await assert.rejects(app.brief('fixture',{...r,criteria:[{...r.criteria[0],requirementIds:['missing']}],scopeChanges:[{subject:'criterion',requirementId:'review',impact:'expansion',reason:'Connect an additional requirement for validation.'}]},2),{code:'UNKNOWN_REQUIREMENT'});
    await assert.rejects(app.review('fixture',{criterionId:'review',passed:true,reviewer:'test',summary:'Path escape',artifactPaths:['../escape']}),{code:'PATH_OUTSIDE_PROJECT'});
    await assert.rejects(app.deployment('fixture',{origin:'https://unregistered.example'}),{code:'DEPLOYMENT_ORIGIN_NOT_ALLOWED'});
  } finally {await app.close();await f.cleanup();}
});

test('required scope and delivery level cannot silently shrink to obtain a green status', async () => {
  const f=await fixture(), app=await f.app();
  try{
    await app.brief('fixture',{...brief,target:'deployed',requirements:[{id:'R-auth',description:'Independent users and authorization',required:true}]},0);
    await assert.rejects(app.brief('fixture',{...brief,target:'deployed'},1),{code:'SCOPE_CHANGE_REQUIRES_EVIDENCE'});
    await assert.rejects(app.brief('fixture',brief,1),{code:'DELIVERY_DOWNGRADE_REQUIRES_EVIDENCE'});
    await app.brief('fixture',{...brief,targetChangeEvidence:'User explicitly requested a local prototype instead.',scopeChanges:[{requirementId:'R-auth',reason:'The app is now a single-user offline prototype.',userEvidence:'User removed shared accounts in the changed scope.'}]},1);
    assert.equal(app.get('fixture').store.state.briefHistory.length,1);
  }finally{await app.close();await f.cleanup();}
});
