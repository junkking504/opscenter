import { archivePushScopes } from '../lib/web-push-archive';
import { pushDependencies } from '../lib/web-push-worker';
import { startPushDispatcher } from '../lib/web-push-dispatcher';
import { startPushJournal } from '../lib/web-push-journal';
import { pushEnabled } from '../lib/web-push-policy';
async function main(){
  if(!pushEnabled()){console.log('Web Push disabled; no source, database or network access.');return;}
  const root=process.env.OPSCENTER_WEB_PUSH_JOURNAL_DIR;
  if(!root||process.env.OPSCENTER_WEB_PUSH_CAPTURE!=='1')throw new Error('canonical_producer_integration_required');
  // Recover publication state before any pending delivery can be claimed.
  // The source helper receives no signing key or protected runtime environment.
  const {execFile}=await import('node:child_process');
  const {promisify}=await import('node:util');
  const execute=promisify(execFile);
  const fs=await import('node:fs');const path=await import('node:path');
  const helper=process.env.OPSCENTER_WEB_PUSH_CAPTURE_HELPER;
  if(!helper||!path.isAbsolute(helper)||!fs.readFileSync(helper).equals(fs.readFileSync(path.join(process.cwd(),'scripts/opscenter_push_journal.py'))))throw new Error('push_helper_version_mismatch');
  const recover=async()=>{try{await execute('python3',[helper,'--recover',root],{
    env:{NODE_ENV:'production',PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'},
    timeout:30000,
  });}catch{throw new Error('push_source_recovery_failed');}};
  await recover();
  let closeJournal:(()=>Promise<void>)|undefined;
  let closeDispatcher:(()=>Promise<void>)|undefined;
  const failed=()=>{process.exitCode=1;void closeJournal?.();void closeDispatcher?.();};
  const dispatcher=await startPushDispatcher(undefined,undefined,failed);
  closeDispatcher=dispatcher.stop;
  if('busy' in dispatcher||'disabled' in dispatcher)return;
  try{
    let lastFileCutoff='';
    const maintain=async()=>{await archivePushScopes(pushDependencies(),async(cutoff,acks)=>{
      if(!acks.length&&lastFileCutoff===cutoff)return [];
      const retired:string[]=[];
      for(let offset=0;offset<Math.max(1,acks.length);offset+=100){
        const result=await execute('python3',[helper,'--retire',root,'--cutoff',cutoff,'--acknowledgements',JSON.stringify(acks.slice(offset,offset+100))],{env:{NODE_ENV:'production',PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'},timeout:30000});
        retired.push(...JSON.parse(result.stdout));
      }
      lastFileCutoff=cutoff;return retired;
    });};
    const journal=await startPushJournal(root,undefined,failed,recover,maintain);
    closeJournal=journal.stop;
    const stop=async()=>{await journal.stop();await dispatcher.stop();};
    process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
    // No polling health timer: watcher/DB failures close resources and exit.
    if('active' in journal&&!journal.active){await stop();throw new Error('push_journal_failed');}
  }catch{await dispatcher.stop();throw new Error('push_source_start_failed');}
}
export { startPushDispatcher };
main().catch(error=>{console.error(error instanceof Error?error.message:'push_dispatcher_failed');process.exitCode=1;});
