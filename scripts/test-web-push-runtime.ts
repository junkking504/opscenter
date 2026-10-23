import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,chmodSync,unlinkSync,symlinkSync,rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pushLease,watchSupervisorPipe } from '../lib/web-push-runtime';
import { pushEnabled,pushEnrollmentEnabled } from '../lib/web-push-policy';
const root=mkdtempSync(path.join(os.tmpdir(),'ops-push-runtime-'));
const file=path.join(root,'capture-lease.json'),nonce='a'.repeat(32),now=100000;
const good={version:1,mode:'observe',nonce,expiresAt:104};
const write=(value:unknown)=>writeFileSync(file,JSON.stringify(value),{mode:0o600});
try {
  assert.equal(pushLease(undefined,undefined,root,now),false);
  write(good);assert.equal(pushLease(undefined,undefined,root,now),true);
  assert.equal(pushLease('send',nonce,root,now),false);
  write({...good,mode:'send'});assert.equal(pushLease('send',nonce,root,now),true);
  assert.equal(pushLease('send','b'.repeat(32),root,now),false);
  for(const update of [{expiresAt:100},{expiresAt:111},{expiresAt:'104'},{mode:'off'},{nonce:'bad'},{version:2}]) {
    write({...good,...update});assert.equal(pushLease(undefined,undefined,root,now),false);
  }
  write(good);chmodSync(file,0o644);assert.equal(pushLease(undefined,undefined,root,now),false);
  unlinkSync(file);mkdirSync(file);assert.equal(pushLease(undefined,undefined,root,now),false);rmSync(file,{recursive:true});
  const target=path.join(root,'target');writeFileSync(target,JSON.stringify(good),{mode:0o600});symlinkSync(target,file);
  assert.equal(pushLease(undefined,undefined,root,now),false);unlinkSync(file);
  write(good);chmodSync(root,0o755);assert.equal(pushLease(undefined,undefined,root,now),false);
  const env={OPSCENTER_RUNTIME:'MISSION_CONTROL',OPSCENTER_WEB_PUSH_ORIGIN:'https://ops.example.test',OPSCENTER_WEB_PUSH_ENROLLMENT_ENABLED:'1',OPSCENTER_WEB_PUSH_ENABLED:'0',OPSCENTER_WEB_PUSH_ACTIVATED_AT:'2026-01-01T00:00:00Z',OPSCENTER_WEB_PUSH_PUBLIC_KEY:'a'.repeat(87),OPSCENTER_WEB_PUSH_SUBJECT:'mailto:fixture@example.test',OPSCENTER_PROCESS_ROLE:'push-dispatcher',OPSCENTER_WEB_PUSH_PRIVATE_KEY:'a'.repeat(43)};
  assert.equal(pushEnrollmentEnabled(env),true);assert.equal(pushEnabled(env),false);
  console.log('Private lease expiry, mode, nonce, permissions, symlink and enrollment-only fixtures passed.');
}finally{rmSync(root,{recursive:true,force:true});}

// Supervisor liveness pipe: missing, malformed, stdio and non-pipe descriptors
// are refused; closing the holder's end stops the child; an orderly close does not.
async function parentDeath() {
  for(const value of [undefined,'','abc','1','2','3.5','999999'])assert.throws(()=>watchSupervisorPipe(value,()=>{}),/supervisor_required/);
  const fileRoot=mkdtempSync(path.join(os.tmpdir(),'ops-push-liveness-'));
  try {
    const {openSync,closeSync}=await import('node:fs');
    const regular=openSync(path.join(fileRoot,'regular'),'w');
    try {assert.throws(()=>watchSupervisorPipe(String(regular),()=>{}),/supervisor_required/);} finally {closeSync(regular);}
  } finally {rmSync(fileRoot,{recursive:true,force:true});}
  const runtime=path.resolve('lib/web-push-runtime.ts');
  const child=(code:string)=>spawn(process.execPath,['--import','tsx','-e',code],{stdio:['ignore','pipe','inherit','pipe']});
  const exitOf=(proc:ReturnType<typeof child>)=>new Promise<number|null>(resolve=>proc.on('exit',code=>resolve(code)));
  // The holder (this process) disappearing is modelled by closing its end.
  const lost=child(`import(${JSON.stringify(runtime)}).then(m=>{m.watchSupervisorPipe('3',()=>{process.stdout.write('gone');process.exit(7);});setTimeout(()=>process.exit(3),10000);});`);
  const lostOut:string[]=[];lost.stdout!.on('data',chunk=>lostOut.push(String(chunk)));
  await new Promise(resolve=>setTimeout(resolve,1500));
  (lost.stdio[3] as import('node:net').Socket).destroy();
  assert.equal(await exitOf(lost),7,'child must stop when the supervisor end closes');assert.equal(lostOut.join(''),'gone');
  // An orderly stop closes the watcher without reporting parent loss, and an
  // unref'd watcher never keeps an otherwise finished process alive.
  const orderly=child(`import(${JSON.stringify(runtime)}).then(m=>{const close=m.watchSupervisorPipe('3',()=>process.exit(9));close();});`);
  assert.equal(await exitOf(orderly),0,'orderly close must not report parent loss or hang');
  (orderly.stdio[3] as import('node:net').Socket).destroy();
  console.log('Supervisor liveness pipe: invalid descriptors refused, parent loss stops the child, orderly close is silent.');
}
parentDeath().catch(error=>{console.error(error);process.exitCode=1;});
