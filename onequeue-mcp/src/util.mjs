import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, realpath, lstat, mkdir, writeFile, rename } from 'node:fs/promises';
import { resolve, relative, isAbsolute, sep, dirname } from 'node:path';

export class AppError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
export function requireThat(value, code, message) { if (!value) throw new AppError(code, message); }
export function inside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}
export async function safePath(root, path, { missing = false } = {}) {
  const target = resolve(root, path);
  requireThat(inside(root, target), 'PATH_OUTSIDE_PROJECT', '프로젝트 밖의 경로는 사용할 수 없습니다.');
  let current = root;
  for (const piece of relative(root, target).split(sep).filter(Boolean)) {
    current = resolve(current, piece);
    try {
      const info = await lstat(current);
      requireThat(!info.isSymbolicLink(), 'SYMLINK_NOT_ALLOWED', '프로젝트 내부 링크 경로는 지원하지 않습니다.');
      requireThat(inside(root, await realpath(current)), 'PATH_OUTSIDE_PROJECT', '실제 경로가 프로젝트 밖입니다.');
    } catch (error) { if (!(missing && error.code === 'ENOENT')) throw error; }
  }
  return target;
}
export async function atomicJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, path);
}
export function redact(value) {
  return String(value)
    .replace(/(Bearer\s+)[\w.+\/-]+/gi, '$1[REDACTED]')
    .replace(/((?:password|passwd|secret|api[_-]?key|access[_-]?token|authorization|cookie|set-cookie)\s*["']?\s*[:=]\s*["']?)[^\s,"'<>]+/gi, '$1[REDACTED]');
}
export const now = () => new Date().toISOString();
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function childEnvironment(extra = {}) {
  const keys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'LANG'];
  return { ...Object.fromEntries(keys.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]])), ...extra };
}
export async function fingerprint(project) {
  const hash = createHash('sha256');
  hash.update(JSON.stringify({ sources: project.sources, checks: project.checks, preview: project.preview, browserChannel: project.browserChannel, deploymentOrigins: project.deploymentOrigins, deploymentAuth: project.deploymentAuth }));
  let count = 0, bytes = 0;
  async function visit(path) {
    const full = await safePath(project.root, path);
    const stat = await lstat(full);
    if (stat.isDirectory()) {
      for (const entry of (await readdir(full)).sort()) {
        if (['node_modules', '.git', '.onequeue', 'dist', 'test-results'].includes(entry)) continue;
        await visit(relative(project.root, resolve(full, entry)));
      }
    } else if (stat.isFile()) {
      count++; bytes += stat.size;
      requireThat(count <= 20000 && bytes <= 100 * 1024 * 1024, 'SOURCE_LIMIT', '소스 지문 범위가 20,000개 파일 또는 100 MiB를 초과했습니다.');
      hash.update(relative(project.root, full).replaceAll('\\', '/')); hash.update('\0');
      hash.update(await readFile(full)); hash.update('\0');
    }
  }
  for (const path of [...project.sources].sort()) {
    try { await visit(path); } catch (error) { if (error.code === 'ENOENT') hash.update(`missing:${path}\0`); else throw error; }
  }
  return { hash: hash.digest('hex'), files: count };
}
