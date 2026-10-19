import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'model.js', 'store.mjs', 'server.mjs']) await copyFile(file, 'dist/' + file);
await writeFile('dist/package.json', JSON.stringify({ name: 'our-promise', private: true, type: 'module', engines: { node: '>=24' }, scripts: { start: 'node server.mjs' } }, null, 2));
console.log('우리의 약속 실행 패키지: dist/ — Node 24+, npm start');
