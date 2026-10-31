import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const source=fs.readFileSync('deploy/macmini/install-junkware-schedule-detector.sh','utf8');
const start=source.indexOf('  CHILD_WAIT_SECONDS=');
const endMarker='  kill -TERM "$LOCK_PID" 2>/dev/null || true\n';
const end=source.indexOf(endMarker,start)+endMarker.length;
assert.ok(start>=0&&end>start);
const guard=source.slice(start,end);
// busyPolls: how many pgrep calls report a non-collector child (pid 999) before it exits.
// parentAlive: whether the detector (pid 123) is still running. Signals are recorded in "signals".
function run(busyPolls:number,command:string,waitSeconds=240,parentAlive=true,aliveUntil=busyPolls) {
  return spawnSync('bash',['-c',`set -eu
LOCK_PID=123
DETECTOR_CHILD_WAIT_SECONDS=${waitSeconds}
counter=$(mktemp); echo 0 > "$counter"; : > "$counter.signals"
pgrep() { n=$(( $(cat "$counter") + 1 )); echo "$n" > "$counter"; if [ "$n" -le ${busyPolls} ]; then echo 999; fi; }
ps() { printf '%s' '${command}'; }
kill() {
  if [ "$1" = "-0" ]; then
    if [ "$2" = "123" ]; then return ${parentAlive?0:1}; fi
    n=$(cat "$counter"); [ "$n" -le ${aliveUntil} ]; return
  fi
  echo "$*" >> "$counter.signals"; return 0
}
sleep() { echo $(( $(cat "$counter.now" 2>/dev/null || echo 1000) + 2 )) > "$counter.now"; }
date() { cat "$counter.now" 2>/dev/null || echo 1000; }
emit() { printf 'polls=%s signals=[%s]' "$(cat "$counter")" "$(tr '\n' ';' < "$counter.signals")"; }
trap emit EXIT
${guard}
`],{encoding:'utf8'});
}
const brief=run(3,'python3 publish-changes.py');
assert.equal(brief.status,0,'A helper that finishes within the wait must not fail the release');
assert.match(brief.stdout,/polls=4/);
assert.equal(run(0,'').status,0,'No children continues immediately');
const collector=run(2,'python3 collect-junkware-schedule-stream.py');
assert.equal(collector.status,0);
assert.match(collector.stdout,/polls=1 /,'The stream collector never needs a wait');
const stuck=run(1000,'python3 publish-changes.py',20);
assert.equal(stuck.status,1,'A helper that never finishes must still block');
assert.match(stuck.stderr,/after waiting 20s; refusing to terminate it/);
assert.doesNotMatch(stuck.stdout,/-TERM 999/,'A persistent helper is never signalled');
const orphaned=run(1000,'python3 publish-changes.py',20,false);
assert.equal(orphaned.status,1,'A helper that outlives the detector still blocks the release');
assert.doesNotMatch(orphaned.stdout,/-TERM 999/,'A helper that outlives the detector is never signalled');
const orphanDone=run(3,'python3 publish-changes.py',240,false);
assert.equal(orphanDone.status,0,'A helper that finishes after the detector exits lets the release continue');
// Reparenting: after the detector exits, pgrep -P stops listing the helper but it is still running.
const reparented=run(2,'python3 publish-changes.py',20,false,1000);
assert.equal(reparented.status,1,'A helper that disappears from pgrep but is still alive must block the release');
assert.doesNotMatch(reparented.stdout,/-TERM 999/,'A reparented helper is never signalled');
const reparentedDone=run(2,'python3 publish-changes.py',240,false,6);
assert.equal(reparentedDone.status,0,'A reparented helper that finishes lets the release continue');
console.log('Detector child wait passed: short helpers wait, collector ignored, persistent or orphaned helpers refused and never signalled.');
