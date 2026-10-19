import { OneQueue } from '../src/app.mjs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const args=process.argv.slice(2);
let config=fileURLToPath(new URL('../projects.json',import.meta.url)),projectId,detail='summary';
for(let i=0;i<args.length;i++){
  if(args[i]==='--config' && args[i+1])config=resolve(args[++i]);
  else if(args[i]==='--project' && args[i+1])projectId=args[++i];
  else if(args[i]==='--full')detail='full';
  else throw new Error('Usage: node scripts/status.mjs [--config path] [--project id] [--full]');
}
const app=await new OneQueue().init(config,{readOnly:true});
try{const ids=projectId?[projectId]:app.list().map(p=>p.id);console.log(JSON.stringify(await Promise.all(ids.map(id=>app.status(id,detail))),null,2));}
finally{await app.close();}
