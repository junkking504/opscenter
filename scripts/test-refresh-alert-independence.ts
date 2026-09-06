import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

// Run one real loop body with isolated source, backup and publisher commands.
// No source-system or Slack calls are made by this regression test.
const source = fs.readFileSync('scripts/run-junkware-live-refresh-loop.sh', 'utf8');
const publisher = source.slice(source.indexOf('publish_due_slack_alerts()'), source.indexOf('queue_sms_refresh_date()'));
const cycle = source.slice(source.indexOf('  CYCLE_STARTED='), source.indexOf('  TOMORROW_SCHEDULE='));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-refresh-alerts-'));
try {
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(root, 'deploy/vps'), { recursive: true });
  fs.mkdirSync(path.join(root, 'node_modules/.bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules/.bin/tsx'), '#!/bin/bash\nexit 0\n', { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'scripts/run_opscenter_refresh.sh'), '#!/bin/bash\nexit "${TEST_SOURCE_RESULT:-0}"\n', { mode: 0o700 });
  fs.writeFileSync(path.join(root, 'deploy/vps/sync-data.sh'), '#!/bin/bash\necho backup >> "$TEST_EVENTS"\nexit 1\n', { mode: 0o700 });
  for (const sourceResult of [0, 1]) {
    const events = path.join(root, `events-${sourceResult}`);
    const script = `set -u
      OPSBOT_DIR="$TEST_ROOT"
      OPSCENTER_DIR="$TEST_ROOT"
      OPSCENTER_VPS=test-backup
      OPSCENTER_SSH_KEY=unused
      SLACK_OPSCENTER_ALERTS_ENABLED=true
      SLACK_BOT_TOKEN=synthetic-test-token
      SLACK_ALERT_MIN_INTERVAL_SECONDS=60
      LAST_SLACK_ALERT_RUN=0
      SMS_PENDING_DATES=()
      network_available() { return 0; }
      queue_sms_refresh_date() { :; }
      publish_verified_closeout_alerts() { echo closeout >> "$TEST_EVENTS"; }
      auto_virtualize_external_bookings() { :; }
      npm() { echo accounting >> "$TEST_EVENTS"; }
      python3() { :; }
      node() { echo alerts >> "$TEST_EVENTS"; }
      ${publisher}
      ${cycle}
      echo "source_success=$PUBLISH_SUCCEEDED"
    `;
    const result = execFileSync('/bin/bash', ['-c', script], { encoding: 'utf8', env: { NODE_ENV: 'test', PATH: process.env.PATH, TEST_ROOT: root, TEST_EVENTS: events, TEST_SOURCE_RESULT: String(sourceResult) } });
    const calls = fs.readFileSync(events, 'utf8').trim().split('\n');
    assert.equal(calls.filter(value => value === 'alerts').length, 1, 'Only one alert pass within the minimum interval');
    if (sourceResult === 0) {
      assert.ok(calls.indexOf('alerts') < calls.indexOf('accounting'), 'Clock-in and other alerts precede accounting');
      assert.ok(calls.indexOf('alerts') < calls.indexOf('backup'), 'Alerts precede the failed backup');
      assert.match(result, /source_success=true/, 'A failed backup must not back off healthy local collection');
    } else {
      assert.match(result, /source_success=false/, 'A real source failure must retain collection retry behavior');
      assert.ok(!calls.includes('backup'), 'Do not publish a failed collection to the backup');
    }
  }
  console.log('Refresh alert independence checks passed.');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
