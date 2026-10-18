import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,writeFileSync,chmodSync,unlinkSync,symlinkSync,rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pushLease } from '../lib/web-push-runtime';
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
