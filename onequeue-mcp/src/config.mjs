import { readFile, realpath } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { z } from 'zod';
import { safePath, requireThat } from './util.mjs';

export const id = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
export const assertion = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('visible'), selector: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('text'), selector: z.string().min(1).max(512), expected: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal('count'), selector: z.string().min(1).max(512), expected: z.number().int().min(0).max(10000) }).strict(),
  z.object({ kind: z.literal('reachable'), selector: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('focused'), selector: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('contrast'), selector: z.string().min(1).max(512) }).strict(),
  z.object({ kind: z.literal('no_overflow') }).strict(),
  z.object({ kind: z.literal('url'), expected: z.string().startsWith('/').max(2048) }).strict()
]);
export const coverageTag = z.enum(['mobile-actions','contrast','keyboard','focus-retention','live-update','time-boundary','reload-persistence','recovery','authorization','account-lifecycle','multi-user','export-download','capacity','production-smoke','production-login']);
export const provenanceSchema = z.object({
  environment: z.enum(['local','production']), identity: z.enum(['none','synthetic','real']), actors: z.number().int().min(0).max(100),
  methods: z.array(z.enum(['inspection','user-confirmation','database-read','observed-browser'])).min(1),
  limitations: z.array(z.string().min(1).max(1000)).max(20).default([])
}).strict();
const step = z.discriminatedUnion('action', [
  z.object({action:z.literal('assert'),assertion}).strict(),
  z.object({action:z.literal('viewport'),width:z.number().int().min(320).max(1920),height:z.number().int().min(240).max(1200)}).strict(),
  z.object({action:z.literal('focus'),selector:z.string().min(1).max(512)}).strict(),
  z.object({action:z.literal('click'),selector:z.string().min(1).max(512)}).strict(),
  z.object({action:z.literal('fill'),selector:z.string().min(1).max(512),value:z.string().max(8000)}).strict(),
  z.object({action:z.literal('press'),key:z.enum(['Tab','Shift+Tab','Enter','Space','Escape'])}).strict(),
  z.object({action:z.literal('wait'),ms:z.number().int().min(1).max(20000)}).strict(),
  z.object({action:z.literal('reload')}).strict()
]);
export const briefSchema = z.object({
  title: z.string().min(1).max(200), objective: z.string().min(1).max(8000),
  target: z.enum(['prototype', 'release', 'deployed']).default('deployed'),
  maturity: z.enum(['pilot','production']).default('pilot'),
  capabilities: z.array(z.enum(['responsive','liveUpdates','timeDependent','persistence','accounts','multiUser','exportsData'])).default(['responsive']),
  operatingEnvelope: z.string().max(2000).optional(),
  targetChangeEvidence: z.string().min(10).max(2000).optional(),
  scopeChanges: z.array(z.object({ subject: z.enum(['requirement','criterion','capabilities','maturity']).default('requirement'), requirementId: id, impact: z.enum(['refinement','expansion','reduction']).default('reduction'), reason: z.string().min(10).max(2000), userEvidence: z.string().min(10).max(2000).optional() }).strict()).max(100).default([]),
  designBrief: z.string().max(8000).optional(),
  requirements: z.array(z.object({ id, description: z.string().min(1).max(2000), acceptance: z.array(z.string().min(1).max(1000)).max(20).default([]), required: z.boolean().default(true), scopeEvidence: z.string().max(2000).optional() }).strict()).max(100).default([]),
  criteria: z.array(z.object({
    id, description: z.string().min(1).max(1000), required: z.boolean().default(true),
    requirementIds: z.array(id).default([]),
    covers: z.array(coverageTag).default([]),
    category: z.enum(['functional','design','accessibility','security','build','operations','production']).default('functional'),
    stage: z.enum(['local','release','production']).default('local'),
    verification: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('check'), checkId: id }).strict(),
      z.object({ kind: z.literal('browser'), assertion }).strict(),
      z.object({ kind: z.literal('journey'), steps: z.array(step).min(2).max(20) }).strict(),
      z.object({ kind: z.literal('review') }).strict()
    ])
  }).strict()).min(1).max(100)
}).strict();
const schema = z.object({ projects: z.array(z.object({
  id, name: z.string().min(1), root: z.string(),
  sources: z.array(z.string().min(1)).min(1),
  checks: z.record(id, z.object({ args: z.array(z.string()).min(1), timeoutMs: z.number().int().min(100).max(600000).default(60000), reportPath: z.string().min(1).optional() }).strict()),
  preview: z.object({ module: z.string(), export: z.string().default('createApp'), healthPath: z.string().startsWith('/').default('/') }).strict().optional(),
  browserChannel: z.enum(['msedge', 'chrome', 'chromium']).default('chromium'),
  lineage: z.object({ product: id, variant: z.enum(['local','hosted','archived']), supersedes: id.optional() }).strict().optional(),
  deploymentOrigins: z.array(z.string().url().refine(v => new URL(v).protocol === 'https:' && new URL(v).origin === v)).default([]),
  deploymentAuth: z.object({ header: z.enum(['OAI-Sites-Authorization','Authorization']), env: z.string().regex(/^[A-Z][A-Z0-9_]{2,100}$/) }).strict().optional()
}).strict()).min(1).max(20) }).strict();
export async function loadConfig(file) {
  const config = schema.parse(JSON.parse(await readFile(file, 'utf8')));
  const ids = new Set(), roots = new Set();
  for (const p of config.projects) {
    p.root = await realpath(resolve(dirname(file), p.root));
    requireThat(!ids.has(p.id) && !roots.has(p.root.toLowerCase()), 'DUPLICATE_PROJECT', '프로젝트 ID와 경로는 중복될 수 없습니다.');
    ids.add(p.id); roots.add(p.root.toLowerCase());
    for (const source of p.sources) await safePath(p.root, source, { missing: true });
    for (const check of Object.values(p.checks)) if(check.reportPath) await safePath(p.root,check.reportPath,{missing:true});
    if (p.preview) {
      await safePath(p.root, p.preview.module);
      requireThat(!p.preview.healthPath.startsWith('//'), 'INVALID_HEALTH_PATH', 'healthPath는 상대 경로여야 합니다.');
    }
  }
  return config.projects;
}
