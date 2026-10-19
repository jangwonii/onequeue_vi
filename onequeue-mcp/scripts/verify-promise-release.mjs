import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const client=new Client({name:'codex-release-verifier',version:'2.0.0'});
const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../src/index.mjs',import.meta.url))],stderr:'inherit'});
const projectId='promise-release', root=resolve(import.meta.dirname,'../../sites/promise');
async function call(name,args={}){const reply=await client.callTool({name,arguments:{projectId,...args}});if(reply.isError)throw new Error(JSON.stringify(reply.structuredContent));return reply.structuredContent;}
try{
  await client.connect(transport);
  const previous=await call('get_project_status');
  if(process.argv[2]==='status'){console.log(JSON.stringify({status:previous.status,localVerified:previous.localVerified,releaseReady:previous.releaseReady,deployedVerified:previous.deployedVerified,blockers:previous.blockers},null,2));}
  else{
    const requirements=['로그인과 사용자 분리','초대·소유권·나가기','4회 약속과 전원 동의','서버 시각·타이머·인증','친구 현황·반응·알림','검토와 시간 제한','결과·회고·다음 시즌','데이터 내보내기·삭제','제품별 디자인·접근성·복구','마이그레이션·운영·복구','실제 배포와 접근 검증'].map((description,i)=>({id:'R'+String(i+1).padStart(2,'0'),description,required:true}));
    const check=(id,category,checkId,requirementIds,description)=>({id,category,stage:'release',required:true,requirementIds,description,verification:{kind:'check',checkId}});
    const review=(id,category,stage,requirementIds,description)=>({id,category,stage,required:true,requirementIds,description,verification:{kind:'review'}});
    const criteria=[
      check('domain','functional','domain',['R03','R04','R06','R07'],'날짜·4회·동의·타이머·검토·공동 순위·다음 시즌 경계'),
      check('journey','functional','integration',['R01','R02','R05','R08','R09'],'빌드된 Worker와 D1에서 독립된 두 로컬 신원의 실제 브라우저 여정'),
      check('security','security','integration',['R01','R02','R08'],'비회원·타인 접근 차단, CSRF, 초대 교체, 동시 제출·계정 삭제'),
      check('build','build','build',['R10','R11'],'배포 빌드와 배포 소스 해시 생성'),
      check('restore','operations','integration',['R10'],'실제 로컬 D1 저장소 백업을 별도 DB로 복원하고 읽기·쓰기 검증'),
      review('design','design','release',['R09'],'친구 중심 저널과 모바일 하단 탐색을 실제 스크린샷으로 검토'),
      review('accessibility','accessibility','release',['R09'],'320~1440px, 키보드·폼 복구·대비·라벨 검토; 독립 접근성 인증은 아님'),
      review('operations','operations','release',['R10'],'운영 명세와 스키마·오류 로그·복구 경계 검토'),
      review('production-smoke','production','production',['R11'],'실제 배포 URL의 UI·DB 상태·빌드 해시·비인증 경계 확인'),
      review('production-login','production','production',['R01','R11'],'실제 배포에서 ChatGPT 로그인 후 저장·다시 읽기 확인')
    ];
    await call('save_build_brief',{expectedVersion:previous.brief?.version || 0,brief:{target:'deployed',title:'우리의 약속 v2 출시 검증',objective:'사용자의 제품 개선·실제 배포 요청. 로컬 테스트와 실제 운영 로그인 검증을 구분한다.',designBrief:await readFile(resolve(root,'PRODUCT.md'),'utf8'),requirements,criteria}});
    const job=await call('run_checks',{requestKey:crypto.randomUUID(),checkIds:['domain','build','integration']});
    let cursor=0;
    for(;;){const j=await call('get_job_result',{jobId:job.id,cursor});cursor=j.nextCursor;if(j.logs)process.stdout.write(j.logs);if(j.status==='succeeded')break;if(['failed','cancelled','timed_out','interrupted'].includes(j.status))throw new Error('checks '+j.status);await new Promise(r=>setTimeout(r,500));}
    const reviews=[
      ['design','데스크톱 저널·친구 상태·한 가지 다음 행동·모바일 하단 탐색을 확인했습니다. 이전 앱의 히어로와 통계 카드 중심 구조를 바꾸었습니다.',['test-results/journal-desktop.png','test-results/journal-mobile.png','test-results/real-room-mobile.png']],
      ['accessibility','320·390·768·1440px 가로 넘침 없음, Escape 대화상자 닫기, 폼 라벨, 오류 후 입력 유지, 주요 버튼 44px, 본문 대비를 검토했습니다. 스크린리더 전체 인증은 수행하지 않았습니다.',['test-results/integration.json','test-results/real-room-mobile.png']],
      ['operations','마이그레이션과 실제 로컬 D1 백업 복원·데이터 삭제 재시도를 확인했습니다. 운영 DB 전체 자동 백업과 실제 운영 복원은 지원 도구 범위 밖이며 완료로 표시하지 않습니다. 운영 문서에 이 경계를 기록했습니다.',['OPERATIONS.md','test-results/integration.json']]
    ];
    for(const [criterionId,summary,artifactPaths] of reviews)await call('record_review',{criterionId,passed:true,reviewer:'Codex 구현자 검토',summary,artifactPaths});
    const status=await call('get_project_status');await writeFile(resolve(root,'test-results/onequeue-release.json'),JSON.stringify(status,null,2));
    console.log(JSON.stringify({status:status.status,localVerified:status.localVerified,releaseReady:status.releaseReady,deployedVerified:status.deployedVerified,blockers:status.blockers},null,2));
    if(!status.releaseReady)throw new Error('Release gates failed');
  }
}finally{await client.close();}
