import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { pushEnabled, pushEnrollmentEnabled } from './web-push-policy';

export const PUSH_STATE_HOME='/Users/missioncontrol/Library/Application Support/OpsCenter/web-push';
/** Private, short-lived local supervisor capability. File contents never select a
 * network destination. Explicit parameters are for isolated local fixtures. */
export function pushLease(mode?:'send',nonce?:string,home=PUSH_STATE_HOME,now=Date.now(),requireReenable=false):boolean {
  let fd:number|undefined;
  try {
    const directory=lstatSync(home);
    if(!directory.isDirectory()||directory.uid!==process.getuid?.()||(directory.mode&0o077)!==0)return false;
    fd=openSync(path.join(home,'capture-lease.json'),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const info=fstatSync(fd);
    if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>1024)return false;
    const value=JSON.parse(readFileSync(fd,'utf8'));
    return (!requireReenable||value.reenableVersion===1)&&value.version===1&&['observe','send'].includes(value.mode)&&(!mode||value.mode===mode)
      &&typeof value.nonce==='string'&&/^[a-f0-9]{32}$/.test(value.nonce)&&(!nonce||nonce===value.nonce)
      &&typeof value.expiresAt==='number'&&Number.isFinite(value.expiresAt)&&value.expiresAt*1000>now&&value.expiresAt*1000<=now+10000;
  }catch{return false;}finally{if(fd!==undefined)closeSync(fd);}
}
/** Parent-death detection: the supervisor holds the pipe's only write end, so its
 * exit for any reason (SIGKILL included) delivers EOF here. Event-driven, no timer.
 * Returns a close function for an orderly stop that does not report parent loss. */
export function watchSupervisorPipe(value:string|undefined,onGone:()=>void):()=>void {
  const fd=Number(value);
  let kind;
  try {kind=value&&/^\d+$/.test(value)&&Number.isSafeInteger(fd)&&fd>=3?fstatSync(fd):undefined;}catch{kind=undefined;}
  if(!kind||!(kind.isFIFO()||kind.isSocket()))throw new Error('supervisor_required');
  let closing=false,gone=false;
  const pipe=new net.Socket({fd,readable:true,writable:false});
  const lost=()=>{if(closing||gone)return;gone=true;onGone();};
  pipe.on('end',lost);pipe.on('close',lost);pipe.on('error',lost);pipe.on('data',()=>{});pipe.resume();
  // Never keeps the process alive by itself; exit paths behave as before.
  pipe.unref();
  return ()=>{closing=true;pipe.destroy();};
}
export function supervisedPushEnrollment():boolean {return pushEnrollmentEnabled()&&pushLease();}
export function supervisedPushDelivery():boolean {
  const nonce=process.env.OPSCENTER_WEB_PUSH_RUN_NONCE;
  return pushEnabled()&&!!nonce&&pushLease('send',nonce);
}
