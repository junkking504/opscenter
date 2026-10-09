# PostgreSQL and retired-session log operations

Scope approved October 9, 2026: successful PostgreSQL connection chatter,
PostgreSQL stderr rotation, and anonymous summaries of rejected web sessions.
Business records, backups, photos, queues and audit exports are excluded.

## PostgreSQL settings

The owner is `~/Library/Application Support/OpsCenter/postgres-production.conf`,
not the data directory's default config. Keep a timestamped copy under
`database-control/config-backups/` before changing only `log_connections` and
`log_disconnections` to `off`. Connect through the existing local socket at
`~/Library/Application Support/OpsCenter/postgres-production-socket`, port 55433,
database `opscenter_production`, using the existing peer-authenticated operator.
Execute `SELECT pg_reload_conf()`; no server restart is required.

Verify `pg_settings` reports both off with that source file and the correct
source lines, `pending_restart=false`, and `log_min_messages=warning` unchanged.
Check `pg_postmaster_start_time()` is unchanged. Establish a new session and
correlate its backend PID: connection/disconnection entries must be absent while
an explicit test warning and a rejected login still appear. Do not weaken HBA,
create a credential or change existing sessions to perform this check.
Restoring the backed-up settings also uses reload, not restart.

## Separately reviewed log-only rotation

`scripts/rotate-postgres-log.py` touches exactly
`~/Library/Logs/OpsCenter/postgres-production.err.log`, its three compressed
archives, a lock and its receipt. It does not invoke the broad prune helper.
At **32 MiB or greater**, it copies the current bytes into a private compressed
pending archive, fsyncs it, checks inode and size, and truncates the same open
file descriptor. Archives `.1.gz` through `.3.gz` retain newest to oldest.
A fourth rotation expires the oldest archive. Directory and file symlinks,
hard links, foreign-owned files and writable-by-others log directories fail
closed. A directory-relative descriptor and an exclusive advisory lock serialize
runs; concurrent invocations report `busy`.

Copy/truncate retains PostgreSQL/launchd's open writer. It cannot guarantee zero
loss for bytes written in the small stat-to-truncate interval. If the log grows
during copying, the helper stops without truncation. A pending archive after any
failure or crash blocks future rotation for operator review. Do not remove it
blindly: inspect whether the live log was truncated, preserve the pending archive
and existing generations, then make an explicitly reviewed recovery decision.
Do not switch to rename-only rotation; launchd does not reopen the old descriptor.

Run without `--apply` for the exact size/expiration preview (the serialization
lock file can be created). The daily job uses `--apply`. Failure returns nonzero,
prints a bounded error, and writes `postgres-log-rotation-status.json` where
possible. Check that receipt, the dedicated LaunchAgent error log and launchd's
last exit status. A missing/old receipt is unavailable evidence, not success.
There is no external notification or new paid monitoring service.

After independent review, install the exact committed helper using:

```sh
python3 deploy/macmini/install-postgres-log-rotation.py --reviewed-commit FULL_SHA
python3 deploy/macmini/install-postgres-log-rotation.py --reviewed-commit FULL_SHA --apply
```

The installer preserves old installed files and checksums under
`~/Library/Application Support/OpsCenter/log-control/install-backups/`, copies
the helper outside releases, and installs
`com.openclaw.opscenter.postgres-log-rotation` for **02:45 daily, host local time**
(Central on Mission Control). Installation does not rotate or restart PostgreSQL.
Before the first apply, record the dry-run receipt and confirm the approved
log-retention boundary. To suspend, boot out only this LaunchAgent; the database
and application remain running. Keep installed backups and receipts.

## Anonymous rejected-session summaries

`lib/auth-rejection-log.ts` leaves rejection enforcement unchanged. It emits UTC
time, bounded reason, route category, method, API/page class, coarse browser/OS
and mobile/desktop class. A validated Cloudflare ray may identify one request;
it is not a device fingerprint. No host, raw User-Agent, full path/query, cookie,
identity, IP, job identifier or personal content is logged. Unsupported clients
remain unknown; coarse categories cannot prove which physical device is involved.

Per process, the first rejection in each category is logged; repeats are summarized
at most once per five minutes with total/suppressed counts and first/last times.
There are at most 256 buckets plus nine reason-only overflow counters. Idle
buckets expire after 15 minutes. A new bounded reason is always surfaced even at
capacity. Flushes are request-driven: the next rejection emits due/idle summaries;
a process restart can lose pending counts. This is diagnostic sampling, not an
audit ledger. Logger failures must never permit a rejected session.

Validation: `verify:log-hygiene` covers writer preservation, retention, symlinks,
hardlinks, serialization, compression/truncation failures, growing logs, anonymous
fields, bounded overflow, expiry and log-sink failures. `verify:ops-auth` continues
to prove retired identities are denied. Full build and authenticated browser
acceptance are separate release checks.
