import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'ops-push-loader-'));
try {
 const mock=path.join(root,'security-mock'),loader=path.join(root,'loader.sh'),calls=path.join(root,'calls');
 fs.writeFileSync(mock,'#!/bin/sh\nprintf "%s\\n" "$*" >> "$MOCK_CALLS"\nprintf "fixture-only"\n',{mode:0o700});
 // Substitute the hardcoded executable in a temporary COPY. Never source the
 // real loader or invoke the real Keychain tool in this test.
 fs.writeFileSync(loader,fs.readFileSync('scripts/load-opscenter-secrets.sh','utf8').replace('/usr/bin/security',mock));
 for(const [runtime,enabled,role,expect] of [['MISSION_CONTROL','1','web',false],['MISSION_CONTROL','0','push-dispatcher',false],['MAC_MINI_PREVIEW','1','push-dispatcher',false],['MISSION_CONTROL','1','push-dispatcher',true]]) {
  fs.writeFileSync(calls,'');
  const result=spawnSync('/bin/sh',['-c',`. "$1"; printf '%s' "\${OPSCENTER_WEB_PUSH_PRIVATE_KEY:-}"`,'test',loader],{encoding:'utf8',env:{PATH:'/usr/bin:/bin',MOCK_CALLS:calls,OPSCENTER_RUNTIME:runtime,OPSCENTER_WEB_PUSH_ENABLED:enabled,OPSCENTER_PROCESS_ROLE:role}});
  assert.equal(result.status,0);assert.equal(fs.readFileSync(calls,'utf8').includes('web-push-vapid'),expect);assert.equal(result.stdout,expect?'fixture-only':'');
 }
 const cleared=spawnSync('/bin/sh',['-c',`. "$1"; test -z "\${OPSCENTER_WEB_PUSH_PRIVATE_KEY:-}"`,'test',loader],{env:{PATH:'/usr/bin:/bin',MOCK_CALLS:calls,OPSCENTER_PROCESS_ROLE:'web',OPSCENTER_WEB_PUSH_PRIVATE_KEY:'synthetic-inherited'}});
 assert.equal(cleared.status,0);console.log('PASS sender-only loader: web, preview and disabled processes never request the push key; inherited push key cleared. Mock executable only.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
