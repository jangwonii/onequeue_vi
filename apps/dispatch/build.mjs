import {mkdir,copyFile} from 'node:fs/promises';
await mkdir('dist',{recursive:true});for(const file of ['server.mjs','index.html','app.js','styles.css','package.json'])await copyFile(file,'dist/'+file);console.log('독립 실행 산출물: dist/');
