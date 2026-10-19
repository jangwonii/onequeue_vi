import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const client = new Client({ name: 'codex-bookmark-builder', version: '1.0.0' });
const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../src/index.mjs', import.meta.url))], stderr: 'inherit' });
const projectId = 'bookmark', key = randomUUID(); let previewId;
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
  await client.connect(transport); await client.readResource({ uri: 'onequeue://guide' });
  const info = await call('inspect_project'), previous = await call('get_project_status');
  const criteria = [
    { id: 'AC-api', description: '책·진행률·완독·별점·메모·저장 API 검증', verification: { kind: 'check', checkId: 'test' } },
    { id: 'AC-build', description: '독립 Node 실행 패키지 생성', verification: { kind: 'check', checkId: 'build' } },
    { id: 'AC-browser', description: '데스크톱 및 모바일 핵심 사용자 흐름 통과', verification: { kind: 'check', checkId: 'browser' } },
    { id: 'AC-persist', description: '새로고침 후 등록한 책 표시', verification: { kind: 'browser', assertion: { kind: 'text', selector: '.book-title', expected: '원큐로 채운 첫 책장' } } },
    { id: 'AC-progress', description: '읽은 페이지 100/200의 진행률 표시', verification: { kind: 'browser', assertion: { kind: 'text', selector: '#detail-percent', expected: '50%' } } },
    { id: 'AC-note', description: '저장한 독서 메모가 노트 화면에 표시', verification: { kind: 'browser', assertion: { kind: 'text', selector: '.note-content', expected: '한 페이지씩, 나의 속도로.' } } }
  ].map(c => ({ ...c, required: true }));
  if (previous.brief && previous.brief.title !== '책갈피 — 원큐 제작 검증') throw new Error('기존의 다른 제작 명세를 덮어쓰지 않습니다.');
  await call('save_build_brief', { expectedVersion: previous.brief?.version || 0, brief: { target: 'prototype', title: '책갈피 — 원큐 제작 검증', objective: '개인 독서 목록과 진행률, 별점과 메모를 저장하는 앱', criteria } });
  const checks = await call('run_checks', { requestKey: `${key}-checks`, checkIds: ['test', 'build', 'browser'] }); await wait(checks.id, 'succeeded');
  const preview = await call('start_preview', { requestKey: `${key}-preview` }); previewId = preview.id; await wait(previewId, 'ready');
  const { sessionId } = await call('browser_action', { action: 'open', previewId, width: 1440, height: 1100 });
  const action = (action, args = {}) => call('browser_action', { sessionId, action, ...args });
  await action('click', { selector: '#add-book' });
  await action('fill', { selector: '#book-title', value: '원큐로 채운 첫 책장' }); await action('fill', { selector: '#book-author', value: '검증용 가상 저자' }); await action('fill', { selector: '#book-total', value: '200' });
  await action('click', { selector: '#book-form button[type=submit]' }); await action('reload'); await call('browser_assert', { sessionId, criterionId: 'AC-persist' });
  await action('click', { selector: '.cover-stage' }); await action('fill', { selector: '#read-pages', value: '100' }); await action('click', { selector: '#progress-form button[type=submit]' }); await call('browser_assert', { sessionId, criterionId: 'AC-progress' });
  await action('select', { selector: '#rating', value: '4' }); await action('fill', { selector: '#book-note', value: '한 페이지씩, 나의 속도로.' }); await action('click', { selector: '#review-form button[type=submit]' }); await action('click', { selector: '[data-close="detail-dialog"]' });
  await action('reload'); await action('click', { selector: '[data-view=notes]' }); await call('browser_assert', { sessionId, criterionId: 'AC-note' });
  await action('click', { selector: '[data-view=library]' }); const desktop = await action('snapshot'); await action('viewport', { width: 390, height: 844 }); const mobile = await action('snapshot');
  await call('stop_preview', { previewId }); await wait(previewId, 'stopped'); previewId = undefined;
  const status = await call('get_project_status'); if (!status.verified) throw new Error(`완료 조건 불충족: ${JSON.stringify(status.criteria)}`);
  const report = { generatedAt: new Date().toISOString(), transport: 'stdio MCP', verified: true, criteria: status.criteria, screenshots: [desktop.artifact, mobile.artifact], previewStopped: true };
  const path = join(info.root, '.onequeue', 'verification.json'); await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`책갈피: 완료 조건 ${criteria.length}개 통과. 보고서: ${path}`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { if (previewId) await call('stop_preview', { previewId }).catch(() => {}); await client.close(); }
