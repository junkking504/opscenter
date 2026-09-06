import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('deploy/macmini/install-junkware-schedule-detector.sh','utf8');
const start=source.indexOf('if [ -n "$LOCK_PID" ] && kill -0');
const end=source.indexOf('if [ -n "$LOCK_PID" ] && kill -0',start+1);
assert.ok(start>=0&&end>start);
const guard=source.slice(start,end);
function check(exited:boolean,command:string) {
  const result=spawnSync('bash',['-c',`set -eu
LOCK_PID=123
checks=0
kill() { checks=$((checks+1)); if [ "$checks" -eq 1 ]; then return 0; fi; return ${exited?1:0}; }
ps() { printf '%s' '${command}'; }
${guard}
printf 'owner=%s' "$LOCK_PID"
`],{encoding:'utf8'});
return result;
}
assert.equal(check(true,'').status,0,'A process exiting after bootout must not fail deployment');
assert.equal(check(true,'').stdout,'owner=');
assert.equal(check(false,'unrelated-server').status,1,'An unrelated live PID must still block termination');
assert.equal(check(false,'').status,1,'An unidentifiable live PID must still block termination');
assert.equal(check(false,'bash /release/scripts/run-junkware-schedule-detector.sh').stdout,'owner=123');
console.log('Detector restart race passed: exited process accepted; unrelated or unidentified live process rejected.');
