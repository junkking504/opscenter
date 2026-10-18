import { archivePushScopes,createPushMaintenance } from '../lib/web-push-archive';
import { pushDependencies } from '../lib/web-push-worker';
import { startPushDispatcher } from '../lib/web-push-dispatcher';
import { startPushJournal } from '../lib/web-push-journal';
import { pushEnabled } from '../lib/web-push-policy';
async function main(){
  const observing=process.env.OPSCENTER_RUNTIME==='MISSION_CONTROL'&&process.env.OPSCENTER_PROCESS_ROLE==='push-observer'&&process.env.OPSCENTER_WEB_PUSH_ENABLED==='0'&&process.env.OPSCENTER_WEB_PUSH_CAPTURE==='1';
  if(!pushEnabled()&&!observing){console.log('Web Push disabled; no source, database or network access.');return;}
  const base=pushDependencies();
  const deps={...base,enabled:()=>observing||pushEnabled(),ownerAllowed:(owner:string)=>!observing&&base.ownerAllowed(owner)};
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
  let deadlineTimer:ReturnType<typeof setTimeout>|undefined,stopping=false;
  const readyFile=process.env.OPSCENTER_WEB_PUSH_READY_FILE,nonce=process.env.OPSCENTER_WEB_PUSH_RUN_NONCE;
  if(!readyFile||path.dirname(readyFile)!==path.dirname(root)||!nonce||! /^[a-f0-9]{32}$/.test(nonce)||path.basename(readyFile)!==`ready-${nonce}.json`)throw new Error('supervisor_required');
  const stop=async()=>{if(stopping)return;stopping=true;clearTimeout(deadlineTimer);try{fs.unlinkSync(readyFile);}catch{}await closeJournal?.();await closeDispatcher?.();};
  const failed=()=>{process.exitCode=1;void stop();};
  const checkTrial=async()=>{
    if(stopping)return;
    const trial=(await deps.pool.query('SELECT started_at,deadline,stopped_at,attempts_used,clock_timestamp() AS now FROM opscenter_kernel.push_trial WHERE singleton=true')).rows[0];
    if(stopping)return;
    if(!trial)throw new Error('trial_missing');
    clearTimeout(deadlineTimer);
    if(trial.stopped_at||trial.attempts_used>=3||trial.deadline&&trial.deadline<=trial.now||observing&&trial.started_at){void stop();return;}
    if(trial.deadline)deadlineTimer=setTimeout(()=>{void stop();},Math.max(0,trial.deadline.getTime()-trial.now.getTime()));
  };
  const trialChanged=()=>{void checkTrial().catch(failed);};
  const maintenance=createPushMaintenance(async()=>{await archivePushScopes(deps,async(cutoff,acks)=>{
    // One proof set, including files referencing scopes across the whole set.
    // A private file avoids OS argument limits without splitting acknowledgements.
    const ackFile=path.join(root,'retirement-acknowledgements.json');
    fs.writeFileSync(ackFile,JSON.stringify(acks),{mode:0o600});
    try {
      const result=await execute('python3',[helper,'--retire',root,'--cutoff',cutoff,'--acknowledgements-file',ackFile],{env:{NODE_ENV:'production',PATH:process.env.PATH,PYTHONDONTWRITEBYTECODE:'1'},timeout:30000});
      return JSON.parse(result.stdout) as string[];
    }finally{fs.unlinkSync(ackFile);}
  });});
  let journalWake:(()=>void)|undefined;
  await checkTrial();if(stopping)return;
  const dispatcher=await startPushDispatcher(deps,undefined,failed,()=>{maintenance.invalidate();journalWake?.();trialChanged();},trialChanged);
  closeDispatcher=dispatcher.stop;
  if(stopping){await dispatcher.stop();return;}
  if('busy' in dispatcher||'disabled' in dispatcher)return;
  try{
    const journal=await startPushJournal(root,deps,failed,recover,maintenance.maintain);
    closeJournal=journal.stop;
    if(stopping){await journal.stop();return;}
    journalWake=journal.wake;
    await maintenance.maintain(); // close the startup delivery-completion race
    await checkTrial();
    if(!stopping)fs.writeFileSync(readyFile,JSON.stringify({nonce,pid:process.pid,ready:true}),{mode:0o600,flag:'wx'});
    process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
    // No polling health timer: watcher/DB failures close resources and exit.
    if('active' in journal&&!journal.active){await stop();throw new Error('push_journal_failed');}
  }catch{await stop();throw new Error('push_source_start_failed');}
}
export { startPushDispatcher };
main().catch(error=>{console.error(error instanceof Error?error.message:'push_dispatcher_failed');process.exitCode=1;});
