import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const client = new Client({ name: 'codex-promise-builder', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], stderr: 'inherit' });
const projectId = 'promise', key = randomUUID(); let previewId;
async function call(name, args = {}) {
  const reply = await client.callTool({ name, arguments: { projectId, ...args } });
  if (reply.isError) throw new Error(JSON.stringify(reply.structuredContent || reply.content));
  return reply.structuredContent;
}
async function wait(id, target) {
  const until = Date.now() + 150000; let cursor = 0;
  while (Date.now() < until) {
    const job = await call('get_job_result', { jobId: id, cursor }); cursor = job.nextCursor;
    if (job.logs) process.stdout.write(job.logs);
    if (job.status === target) return job;
    if (['failed','cancelled','timed_out','interrupted'].includes(job.status)) throw new Error('검증 실패: ' + JSON.stringify(job.results));
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error('검증 시간 초과');
}
try {
  await client.connect(transport); await client.readResource({ uri: 'onequeue://guide' });
  const info = await call('inspect_project'), previous = await call('get_project_status');
  const criteria = [
    { id: 'AC-api', description: '계정·권한·약속 4회·마감·타이머·검토·순위·다음 시즌·저장 규칙 검증', verification: { kind: 'check', checkId: 'test' } },
    { id: 'AC-build', description: '독립 Node 실행 패키지 생성', verification: { kind: 'check', checkId: 'build' } },
    { id: 'AC-browser', description: '독립된 두 계정의 전체 흐름 및 가상 시즌·모바일 화면 검증', verification: { kind: 'check', checkId: 'browser' } },
    { id: 'AC-friends', description: '분리된 가상 체험에서 네 사람의 오늘 현황 표시', verification: { kind: 'browser', assertion: { kind: 'count', selector: '.friend', expected: 4 } } },
    { id: 'AC-persist', description: '실천 기록 후 새로고침해도 내 인증 횟수 2/4 유지', verification: { kind: 'browser', assertion: { kind: 'text', selector: '#my-count', expected: '2' } } },
    { id: 'AC-feed', description: '저장한 실천 내용이 친구 피드에 표시', verification: { kind: 'browser', assertion: { kind: 'text', selector: '.feed-card:first-child .feed-note', expected: '원큐 검증: 오늘 10쪽을 읽고 한 문장을 남겼어요.' } } }
  ].map(c => ({ ...c, required: true }));
  if (previous.brief && previous.brief.title !== '우리의 약속 — 원큐 제작 검증') throw new Error('기존의 다른 제작 명세를 덮어쓰지 않습니다.');
  await call('save_build_brief', { expectedVersion: previous.brief?.version || 0, brief: { target: 'prototype', title: '우리의 약속 — 원큐 제작 검증', objective: '사용자 제공 친구방 기획: 7일·1목표·동일 4회·잠긴 약속·신뢰 기반 기록·공동 순위·회고·다음 시즌을 로컬 앱으로 완성', criteria } });
  const checks = await call('run_checks', { requestKey: key + '-checks', checkIds: ['test','build','browser'] }); await wait(checks.id, 'succeeded');
  const preview = await call('start_preview', { requestKey: key + '-preview' }); previewId = preview.id; await wait(previewId, 'ready');
  const { sessionId } = await call('browser_action', { action: 'open', previewId, width: 1440, height: 1100 });
  const action = (action, args = {}) => call('browser_action', { sessionId, action, ...args });
  await action('click', { selector: '#demo' }); await call('browser_assert', { sessionId, criterionId: 'AC-friends' });
  await action('click', { selector: '#record-today' }); await action('fill', { selector: '#record-note', value: '원큐 검증: 오늘 10쪽을 읽고 한 문장을 남겼어요.' });
  await action('check', { selector: '#record-form [name=honest]', checked: true });
  await action('click', { selector: '#record-form [type=submit]' }); await action('reload');
  await call('browser_assert', { sessionId, criterionId: 'AC-persist' }); await call('browser_assert', { sessionId, criterionId: 'AC-feed' });
  const desktop = await action('snapshot'); await action('viewport', { width: 390, height: 844 }); const mobile = await action('snapshot');
  await call('stop_preview', { previewId }); await wait(previewId, 'stopped'); previewId = undefined;
  const status = await call('get_project_status'); if (!status.verified) throw new Error('완료 조건 불충족: ' + JSON.stringify(status.criteria));
  const report = { generatedAt: new Date().toISOString(), transport: 'stdio MCP', verified: true, criteria: status.criteria, screenshots: [desktop.artifact, mobile.artifact], previewStopped: true };
  const path = join(info.root, '.onequeue', 'verification.json'); await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log('우리의 약속: 완료 조건 ' + criteria.length + '개 통과. 보고서: ' + path);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (previewId) await call('stop_preview', { previewId }).catch(() => {}); await client.close(); }
