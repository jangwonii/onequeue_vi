import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const client = new Client({ name: 'codex-hankan-builder', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], stderr: 'inherit' });
const projectId = 'hankan', key = randomUUID(); let previewId;
async function call(name, args = {}) {
  const reply = await client.callTool({ name, arguments: { projectId, ...args } });
  if (reply.isError) throw new Error(JSON.stringify(reply.structuredContent || reply.content));
  return reply.structuredContent;
}
async function wait(id, target) {
  const deadline = Date.now() + 150000; let cursor = 0;
  while (Date.now() < deadline) {
    const job = await call('get_job_result', { jobId: id, cursor }); cursor = job.nextCursor;
    if (job.logs) process.stdout.write(job.logs);
    if (job.status === target) return job;
    if (['failed', 'cancelled', 'timed_out', 'interrupted'].includes(job.status)) throw new Error(`검증 실패: ${JSON.stringify(job.results)}`);
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('검증 시간 초과');
}
try {
  await client.connect(transport);
  await client.readResource({ uri: 'onequeue://guide' });
  const info = await call('inspect_project'), previous = await call('get_project_status');
  const criteria = [
    { id: 'AC-api', description: '할 일·타이머·서버 재시작·입력 검증 통합 테스트 통과', verification: { kind: 'check', checkId: 'test' } },
    { id: 'AC-build', description: '독립 실행 패키지 생성', verification: { kind: 'check', checkId: 'build' } },
    { id: 'AC-browser', description: '데스크톱·모바일에서 핵심 사용자 흐름 통과', verification: { kind: 'check', checkId: 'browser' } },
    { id: 'AC-persistence', description: '새로고침 후 저장한 할 일이 보인다', verification: { kind: 'browser', assertion: { kind: 'text', selector: '.task-name', expected: '원큐 MCP로 만든 첫 앱' } } },
    { id: 'AC-pause', description: '새로고침 후 타이머 일시정지 상태가 유지된다', verification: { kind: 'browser', assertion: { kind: 'text', selector: '#timer-label', expected: '잠시 숨을 고르는 중' } } },
    { id: 'AC-complete', description: '할 일 완료 상태가 화면에 반영된다', verification: { kind: 'browser', assertion: { kind: 'count', selector: '.task-row.done', expected: 1 } } }
  ].map(c => ({ ...c, required: true }));
  if (previous.brief && previous.brief.title !== '한 칸 — 원큐 제작 검증') throw new Error('다른 명세가 이미 있어 자동 덮어쓰기를 중단합니다.');
  await call('save_build_brief', { expectedVersion: previous.brief?.version || 0, brief: { target: 'prototype', title: '한 칸 — 원큐 제작 검증', objective: '개인 할 일과 집중 타이머를 로컬에서 저장하고 활용하는 앱', criteria } });
  const job = await call('run_checks', { requestKey: `${key}-checks`, checkIds: ['test', 'build', 'browser'] });
  await wait(job.id, 'succeeded');
  const preview = await call('start_preview', { requestKey: `${key}-preview` }); previewId = preview.id;
  await wait(previewId, 'ready');
  const { sessionId } = await call('browser_action', { action: 'open', previewId, width: 1440, height: 1040 });
  const action = (action, args = {}) => call('browser_action', { sessionId, action, ...args });
  await action('fill', { selector: '#task-title', value: '원큐 MCP로 만든 첫 앱' });
  await action('select', { selector: '#task-priority', value: 'important' });
  await action('click', { selector: '#task-form button[type=submit]' });
  await action('reload');
  await call('browser_assert', { sessionId, criterionId: 'AC-persistence' });
  await action('click', { selector: '#timer-primary' });
  await action('click', { selector: '#timer-primary' });
  await action('reload');
  await call('browser_assert', { sessionId, criterionId: 'AC-pause' });
  await action('check', { selector: '.task-check', checked: true });
  await call('browser_assert', { sessionId, criterionId: 'AC-complete' });
  const desktop = await action('snapshot');
  await action('viewport', { width: 390, height: 844 });
  const mobile = await action('snapshot');
  await call('stop_preview', { previewId }); await wait(previewId, 'stopped'); previewId = undefined;
  const status = await call('get_project_status');
  if (!status.verified) throw new Error(`완료 조건 불충족: ${JSON.stringify(status.criteria)}`);
  const report = { generatedAt: new Date().toISOString(), transport: 'stdio MCP', criteria: status.criteria, verified: status.verified, screenshots: [desktop.artifact, mobile.artifact], previewStopped: true };
  const path = join(info.root, '.onequeue', 'verification.json'); await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`한 칸: 완료 조건 ${criteria.length}개 통과. 보고서: ${path}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (previewId) await call('stop_preview', { previewId }).catch(() => {}); await client.close(); }
