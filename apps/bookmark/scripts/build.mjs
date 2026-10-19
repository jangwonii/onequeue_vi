import { mkdir, copyFile, writeFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
for (const file of ['index.html', 'styles.css', 'app.js', 'server.mjs']) await copyFile(file, `dist/${file}`);
await writeFile('dist/package.json', JSON.stringify({ name: 'bookmark-reading-room', private: true, type: 'module', engines: { node: '>=24' }, scripts: { start: 'node server.mjs' } }, null, 2));
console.log('책갈피 실행 패키지: dist/ — Node 24+, npm start');
