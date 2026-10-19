import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const client = new Client({ name: 'onequeue-demo', version: '0.1.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], stderr: 'inherit' });
const projectId = 'seven', run = randomUUID(); let previewId;
async function call(name, args = {}) {
  const reply = await client.callTool({ name, arguments: { projectId, ...args } });
  if (reply.isError) throw new Error(JSON.stringify(reply.structuredContent || reply.content));
  return reply.structuredContent;
}
async function wait(jobId, statuses) {
  const deadline = Date.now() + 180000; let cursor = 0;
  while (Date.now() < deadline) {
    const job = await call('get_job_result', { jobId, cursor }); cursor = job.nextCursor;
    if (job.logs) process.stdout.write(job.logs);
    if (statuses.includes(job.status)) return job;
    if (['failed', 'cancelled', 'timed_out', 'stopped', 'interrupted'].includes(job.status)) throw new Error(`Job ended: ${job.status}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('Demo timed out');
}
try {
  await client.connect(transport);
  const info = await call('inspect_project');
  const previous = await call('get_project_status');
  if (previous.brief && previous.brief.title !== '원큐 MCP 첫 제품 검증') throw new Error('다른 제작 명세가 이미 있습니다. 데모가 기존 명세를 덮어쓰지 않습니다.');
  const brief = {
    target: 'prototype',
    title: '원큐 MCP 첫 제품 검증', objective: 'SEVEN의 기존 기능과 격리된 회원가입 화면을 실제 MCP 호출로 검증한다.',
    criteria: [
      { id: 'AC-tests', description: '기존 모델 및 API 테스트가 통과한다', required: true, verification: { kind: 'check', checkId: 'test' } },
      { id: 'AC-build', description: '배포용 Node 파일 구성이 생성된다', required: true, verification: { kind: 'check', checkId: 'build' } },
      { id: 'AC-flow', description: '두 계정의 초대·공동 시작·인증·모바일 화면 테스트가 통과한다', required: true, verification: { kind: 'check', checkId: 'browser' } },
      { id: 'AC-signup', description: '격리된 미리보기에서 회원가입 후 앱 본문이 보인다', required: true, verification: { kind: 'browser', assertion: { kind: 'visible', selector: '.main-shell' } } }
    ]
  };
  await call('save_build_brief', { expectedVersion: previous.brief?.version || 0, brief });
  const checks = await call('run_checks', { requestKey: `${run}-checks`, checkIds: ['test', 'build', 'browser'] });
  console.log('SEVEN 테스트·빌드·브라우저 통합 검증 실행 중…');
  await wait(checks.id, ['succeeded']);
  const preview = await call('start_preview', { requestKey: `${run}-preview` }); previewId = preview.id;
  const ready = await wait(preview.id, ['ready']);
  const session = await call('browser_action', { action: 'open', previewId });
  const sessionId = session.sessionId;
  const act = (action, options = {}) => call('browser_action', { sessionId, action, ...options });
  await act('click', { selector: 'role=button[name="회원가입"]' });
  await act('fill', { selector: '[name="name"]', value: '원큐 검증' });
  await act('fill', { selector: '[name="username"]', value: 'onequeue_demo' });
  await act('fill', { selector: '[name="password"]', value: `demo-only-${run}` });
  await act('fill', { selector: '[name="confirmation"]', value: `demo-only-${run}` });
  await act('click', { selector: '#auth-form button[type="submit"]' });
  const assertion = await call('browser_assert', { sessionId, criterionId: 'AC-signup' });
  if (assertion.effectiveStatus !== 'passed') throw new Error('Signup assertion failed');
  await act('reload');
  const persistence = await call('browser_assert', { sessionId, criterionId: 'AC-signup' });
  if (persistence.effectiveStatus !== 'passed') throw new Error('Session reload assertion failed');
  const screenshot = await act('snapshot');
  await call('stop_preview', { previewId });
  await wait(previewId, ['stopped']); previewId = undefined;
  const status = await call('get_project_status');
  if (!status.verified) throw new Error('Required criteria are not verified');
  const report = { generatedAt: new Date().toISOString(), transport: 'real stdio MCP client', verified: true, criteria: status.criteria, screenshot: screenshot.artifact, previewStopped: true, note: '합성 계정·별도 DB를 사용한 로컬 검증입니다. 실제 서비스 계정이나 운영 DB를 사용하지 않았습니다.' };
  const output = join(info.root, '.onequeue', 'demo-report.json');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\n필수 완료 조건 ${status.criteria.length}개 통과. 검증용 서버 종료 완료.\n보고서: ${output}\n화면: ${screenshot.artifact.path}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (previewId) await call('stop_preview', { previewId }).catch(() => {});
  await client.close();
}
