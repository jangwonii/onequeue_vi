import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await mkdir('dist/backend', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'model.js', 'server.mjs', 'backend/store.mjs']) await copyFile(file, `dist/${file}`);
await writeFile('dist/package.json', JSON.stringify({ name: 'seven-routine-league', private: true, type: 'module', engines: { node: '>=24.0.0' }, scripts: { start: 'node server.mjs' } }, null, 2));
console.log('Server package ready in dist/. Requires Node.js 24+ and a persistent DATABASE_PATH.');
