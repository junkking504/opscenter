import { startPushDispatcher } from '../lib/web-push-dispatcher';
import { startPushJournal } from '../lib/web-push-journal';
import { pushEnabled } from '../lib/web-push-policy';
async function main(){
  if(!pushEnabled()){console.log('Web Push disabled; no source, database or network access.');return;}
  const root=process.env.OPSCENTER_WEB_PUSH_JOURNAL_DIR;
  if(!root||process.env.OPSCENTER_WEB_PUSH_CAPTURE!=='1')throw new Error('canonical_producer_integration_required');
  // Recover publication state before any pending delivery can be claimed.
  // The source helper receives no signing key or protected runtime environment.
  const {execFileSync}=await import('node:child_process');
  const fs=await import('node:fs');const path=await import('node:path');
  const helper=process.env.OPSCENTER_WEB_PUSH_CAPTURE_HELPER;
  if(!helper||!path.isAbsolute(helper)||!fs.readFileSync(helper).equals(fs.readFileSync(path.join(process.cwd(),'scripts/opscenter_push_journal.py'))))throw new Error('push_helper_version_mismatch');
  try{execFileSync('python3',[helper,'--recover',root],{
    stdio:'pipe',env:{NODE_ENV:'production',PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'},
  });}catch{throw new Error('push_source_recovery_failed');}
  let closeJournal:(()=>Promise<void>)|undefined;
  let closeDispatcher:(()=>Promise<void>)|undefined;
  const failed=()=>{process.exitCode=1;void closeJournal?.();void closeDispatcher?.();};
  const dispatcher=await startPushDispatcher(undefined,undefined,failed);
  closeDispatcher=dispatcher.stop;
  if('busy' in dispatcher||'disabled' in dispatcher)return;
  try{
    const journal=await startPushJournal(root,undefined,failed);
    closeJournal=journal.stop;
    const stop=async()=>{await journal.stop();await dispatcher.stop();};
    process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
    // No polling health timer: watcher/DB failures close resources and exit.
    if('active' in journal&&!journal.active){await stop();throw new Error('push_journal_failed');}
  }catch{await dispatcher.stop();throw new Error('push_source_start_failed');}
}
export { startPushDispatcher };
main().catch(error=>{console.error(error instanceof Error?error.message:'push_dispatcher_failed');process.exitCode=1;});
