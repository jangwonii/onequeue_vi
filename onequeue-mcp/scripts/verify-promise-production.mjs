import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { chromium } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { BUILD_HASH } from '../../sites/promise/lib/build-info.mjs';
import { RELEASE } from '../../sites/promise/lib/domain.mjs';
const root=resolve(import.meta.dirname,'../../sites/promise'),projectId='promise-release';
const receipt=JSON.parse(await readFile(resolve(root,'test-results/deployment.json'),'utf8')),origin=receipt.url;
assert.equal(origin,'https://our-promise-week.weun2002.chatgpt.site');assert.equal(receipt.status,'succeeded');
const client=new Client({name:'codex-production-verifier',version:'2.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/index.mjs',import.meta.url))],stderr:'inherit'});
async function call(name,args={}){const r=await client.callTool({name,arguments:{projectId,...args}});if(r.isError)throw new Error(JSON.stringify(r.structuredContent));return r.structuredContent;}
let browser;
try{
  await client.connect(transport);
  const info=await call('inspect_project');
  await call('verify_deployment',{origin,deploymentId:receipt.id,versionId:receipt.version_id,commitSha:receipt.commit_sha,sourceHash:info.fingerprint.hash,healthPath:'/api/health',expectedRelease:RELEASE,expectedBuildHash:BUILD_HASH});
  const health=await(await fetch(origin+'/api/health')).json();assert.equal(health.buildHash,BUILD_HASH);
  const anon=await(await fetch(origin+'/api/me')).json();assert.equal(anon.user,null);
  const forged=await(await fetch(origin+'/api/me',{headers:{'oai-authenticated-user-id':'forged-test-identity','oai-authenticated-user-email':'forged@invalid.example'}})).json();assert.equal(forged.user,null,'gateway must strip visitor-supplied identity headers');
  const rooms=await fetch(origin+'/api/rooms');assert.equal(rooms.status,401);
  const signIn=await fetch(origin+anon.signInUrl,{redirect:'manual'});assert.equal(signIn.status,302);assert.equal(new URL(signIn.headers.get('location')).origin,'https://auth.openai.com');
  browser=await chromium.launch({channel:'msedge',headless:true});
  const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('heading',{name:/할 일은 달라도/}).waitFor();
  await page.screenshot({path:resolve(root,'test-results/live-welcome.png'),fullPage:true});
  await page.getByRole('button',{name:'먼저 둘러보기'}).click();await page.getByRole('heading',{name:'우리의 오늘',exact:true}).waitFor();await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:resolve(root,'test-results/live-mobile.png'),fullPage:true});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  const evidence={at:new Date().toISOString(),origin,release:RELEASE,buildHash:BUILD_HASH,deploymentId:receipt.id,commitSha:receipt.commit_sha,
    checks:['D1 health 200','build hash matches reviewed local source','anonymous me has null user','unauthenticated room access 401','visitor-supplied identity headers stripped by gateway','sign-in redirects to official OAuth endpoint','actual hosted desktop/mobile UI loads without JS errors'],
    limitations:['No real human ChatGPT login session was used by this script. Demo UI is a read-only sample, not a real friend room.']};
  await writeFile(resolve(root,'test-results/production-smoke.json'),JSON.stringify(evidence,null,2));
  await call('record_review',{criterionId:'production-smoke',passed:true,reviewer:'Codex 실제 배포 응답 및 브라우저 검토',summary:'공개 운영 URL에서 D1·빌드 해시·비인증 401·위조 신원 헤더 제거·정상 OAuth 리다이렉트·화면을 확인했습니다. 실제 사람 로그인 후 저장은 별도 조건으로 남겼습니다.',artifactPaths:['test-results/deployment.json','test-results/production-smoke.json','test-results/live-welcome.png','test-results/live-mobile.png']});
  const status=await call('get_project_status');await writeFile(resolve(root,'test-results/onequeue-release.json'),JSON.stringify(status,null,2));
  console.log(JSON.stringify({status:status.status,localVerified:status.localVerified,releaseReady:status.releaseReady,deployedVerified:status.deployedVerified,blockers:status.blockers},null,2));
}finally{await browser?.close();await client.close();}
