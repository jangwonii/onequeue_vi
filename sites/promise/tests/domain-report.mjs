import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createCheckReport } from '../../../onequeue-mcp/src/check-report.mjs';
const report=createCheckReport();
await report.case('promise-rules-and-new-features',[],()=>{
  const result=spawnSync(process.execPath,['--test','tests/domain.test.mjs'],{stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;assert.equal(result.status,0,'도메인 수락 검사 실패');
});
await report.finish(process.env.ONEQUEUE_REPORT_PATH || 'test-results/domain-cases.json');
