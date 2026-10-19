import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const root=resolve(import.meta.dirname,'..'), hash=createHash('sha256');
async function visit(path){
  for(const item of (await readdir(resolve(root,path),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
    const name=path+'/'+item.name;if(name==='lib/build-info.mjs')continue;
    if(item.isDirectory())await visit(name);
    else{hash.update(name.replaceAll('\\','/'));hash.update('\0');hash.update(await readFile(resolve(root,name)));hash.update('\0');}
  }
}
for(const dir of ['app','lib','public','db','drizzle'])await visit(dir);
for(const file of ['package.json','package-lock.json','.openai/hosting.json']){hash.update(file);hash.update(await readFile(resolve(root,file)));}
const digest=hash.digest('hex');
await writeFile(resolve(root,'lib/build-info.mjs'),"// Generated from deployment sources; no timestamps or secrets.\nexport const BUILD_HASH = '"+digest+"';\n");
console.log('Build source identity: '+digest);
