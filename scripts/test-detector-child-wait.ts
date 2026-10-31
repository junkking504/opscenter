import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('deploy/macmini/install-junkware-schedule-detector.sh','utf8');
const start=source.indexOf('  CHILD_WAIT_SECONDS=');
const endMarker='    sleep 2\n  done\n';
const end=source.indexOf(endMarker,start)+endMarker.length;
assert.ok(start>=0&&end>start);
const guard=source.slice(start,end);
// busyPolls: how many pgrep calls report a non-collector child before it exits.
function run(busyPolls:number,command:string,waitSeconds=240) {
  return spawnSync('bash',['-c',`set -eu
LOCK_PID=123
DETECTOR_CHILD_WAIT_SECONDS=${waitSeconds}
counter=$(mktemp); echo 0 > "$counter"; now=1000
pgrep() { n=$(( $(cat "$counter") + 1 )); echo "$n" > "$counter"; if [ "$n" -le ${busyPolls} ]; then echo 999; fi; }
ps() { printf '%s' '${command}'; }
kill() { return 0; }
sleep() { echo $((now+2)) > "$counter.now"; now=$((now+2)); }
date() { cat "$counter.now" 2>/dev/null || echo 1000; }
${guard}
printf 'continued polls=%s' "$(cat "$counter")"
`],{encoding:'utf8'});
}
const brief=run(3,'python3 publish-changes.py');
assert.equal(brief.status,0,'A helper that finishes within the wait must not fail the release');
assert.match(brief.stdout,/continued polls=4/);
assert.equal(run(0,'').status,0,'No children continues immediately');
assert.equal(run(2,'python3 collect-junkware-schedule-stream.py').stdout,'continued polls=1','The stream collector never needs a wait');
const stuck=run(1000,'python3 publish-changes.py',20);
assert.equal(stuck.status,1,'A helper that never finishes must still block, and is never killed');
assert.match(stuck.stderr,/after waiting 20s; refusing to terminate it/);
console.log('Detector child wait passed: short helpers wait, collector ignored, persistent helper still refused.');
