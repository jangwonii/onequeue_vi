import { z } from 'zod';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { coverageTag } from './config.mjs';
import { redact, safePath, requireThat } from './util.mjs';
const reportSchema=z.object({schemaVersion:z.literal(1),runId:z.string().uuid(),cases:z.array(z.object({
  id:z.string().min(1).max(150),tags:z.array(coverageTag),status:z.enum(['passed','failed','skipped']),
  detail:z.string().max(4000).optional()
}).strict()).min(1).max(500)}).strict();
export async function readCheckReport(project, path, runId) {
  const bytes=await readFile(await safePath(project.root,path));
  requireThat(bytes.length<=1024*1024,'CHECK_REPORT_LIMIT','실행 사례 보고서는 1 MiB 이하여야 합니다.');
  const report=reportSchema.parse(JSON.parse(bytes.toString('utf8')));
  requireThat(report.runId===runId,'CHECK_REPORT_STALE','이번 실행에서 생성된 보고서가 아닙니다.');
  requireThat(new Set(report.cases.map(c=>c.id)).size===report.cases.length,'DUPLICATE_CASE','검증 사례 ID가 중복됩니다.');
  requireThat(report.cases.every(c=>c.status==='passed'),'CHECK_CASES_INCOMPLETE','실패하거나 건너뛴 검증 사례가 있습니다.');
  return {report,reportArtifact:{path,sha256:createHash('sha256').update(bytes).digest('hex')}};
}
// Registered test code is trusted executable code. The report proves execution association, not the honesty of a test's assertions.
export function createCheckReport() {
  const report={schemaVersion:1,runId:process.env.ONEQUEUE_RUN_ID || randomUUID(),cases:[]};
  return {report,async case(id,tags,run){
    try{await run();report.cases.push({id,tags,status:'passed'});}
    catch(error){report.cases.push({id,tags,status:'failed',detail:redact(error.message).slice(0,4000)});}
  },async finish(path=process.env.ONEQUEUE_REPORT_PATH){
    requireThat(path,'REPORT_PATH_REQUIRED','보고서 저장 경로를 지정하세요.');
    reportSchema.parse(report);
    await mkdir(dirname(path),{recursive:true});await writeFile(path,JSON.stringify(report,null,2));
    if(report.cases.some(c=>c.status!=='passed'))process.exitCode=1;
    return report;
  }};
}
