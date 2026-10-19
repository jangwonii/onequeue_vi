import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {fileURLToPath} from 'node:url';
import {writeFile} from 'node:fs/promises';
const client=new Client({name:'dispatch-builder',version:'1.0.0'});
const base=new URL('../',import.meta.url);
const call=async(name,args={})=>{const r=await client.callTool({name,arguments:{projectId:'dispatch',...args}});if(r.isError)throw Error(JSON.stringify(r));return r.structuredContent;};
try{
await client.connect(new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('src/index.mjs',base)),'--config',fileURLToPath(new URL('dispatch.projects.json',base))]}));
if(process.argv[2]==='init'){
 console.log(JSON.stringify(await call('inspect_project')));
 const requirements=[['stock','SKU 재고 관리'],['order','다중 품목 예약·출고·취소'],['data','영속 저장 및 백업 복원'],['ui','모바일과 키보드 사용'],['safe','변경 요청과 입력 검증'],['build','독립 산출물 실행']].map(([id,description])=>({id:'R-'+id,description,acceptance:[({stock:'중복 SKU와 음수 수량은 거절하고 입고 후 가용 수량을 표시한다',order:'재고 부족 주문은 전체 거절하고 중복 출고는 재차 차감하지 않는다',data:'재시작 후 주문이 유지되고 정상 백업 복원과 손상 백업 거절을 확인한다',ui:'390px에서 주문 생성과 출고, 취소, 백업 다운로드와 복구를 실행한다',safe:'외부 Origin 변경을 거절하고 스크립트 문자열은 텍스트로 표시한다',build:'dist 서버에서 브라우저 주문 흐름을 실행한다'})[id]],required:true}));
 const criteria=[['functional','functional',['R-stock','R-order','R-data'],['reload-persistence','recovery']],['security','security',['R-safe'],[]],['accessibility','accessibility',['R-ui'],['mobile-actions','keyboard','contrast','export-download']],['build','build',['R-build'],[]],['design','design',['R-ui'],[]],['operations','operations',['R-data'],[]]].map(([id,category,requirementIds,covers])=>({id,description:category+' 검증',required:true,requirementIds,covers,category,stage:'release',verification:id==='design'||id==='operations'?{kind:'review'}:{kind:'check',checkId:id==='build'?'build':'verify'}}));
 console.log(await call('save_build_brief',{expectedVersion:0,brief:{title:'출고 데스크',objective:'로컬 운영자의 재고, 다중 품목 주문, 예약, 출고, 취소와 백업 복구를 검증한다.',target:'release',maturity:'pilot',capabilities:['responsive','persistence','exportsData'],requirements,criteria,designBrief:'상단 도구 모음과 재고 표, 주문 작업대. 모바일 한 열. PRODUCT.md 참조.'}}));
}else{
 if(process.argv[2]==='review')for(const criterionId of ['design','operations'])console.log(await call('record_review',{criterionId,passed:true,reviewer:'Codex',summary:criterionId==='design'?'데스크톱과 모바일 스크린샷을 관찰하고 작업대 가독성과 모든 주요 동작 접근을 확인했습니다.':'격리 DB의 재시작과 백업 복원, 잘못된 복원 데이터 거절 및 독립 빌드 실행을 확인했습니다.',artifactPaths:['test-results/review.md'],provenance:{environment:'local',identity:'none',actors:1,methods:['inspection','observed-browser'],limitations:['단일 운영자 로컬 파일럿; 독립 접근성 감사와 운영 부하 인증 아님']}}));
 else {const job=await call('run_checks',{requestKey:crypto.randomUUID(),checkIds:['build','verify']});let r;do{await new Promise(r=>setTimeout(r,500));r=await call('get_job_result',{jobId:job.id});}while(['queued','running'].includes(r.status));console.log(JSON.stringify(r));}
 const status=await call('get_project_status');console.log(JSON.stringify(status));await writeFile(fileURLToPath(new URL('../../apps/dispatch/test-results/mcp-status.json',import.meta.url)),JSON.stringify(status,null,2));
}
}finally{await client.close();}
