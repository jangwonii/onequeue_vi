import { spawnSync } from 'node:child_process';
// Direct Node entry points avoid a broken npm.cmd lookup in this Windows host.
for(const args of [['scripts/stamp-release.mjs'],['scripts/run-framework.mjs','build']]){
  const result=spawnSync(process.execPath,args,{stdio:'inherit',windowsHide:true});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status || 1);
}
