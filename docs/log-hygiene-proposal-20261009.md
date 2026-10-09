# Log hygiene — evidence and proposal, October 9

**Proposal only. No PostgreSQL setting, installed script, launchd entry, log or
Application Support configuration was changed.** Read-only source/log inspection
and a local `pg_settings` query were used. No purge or broad maintenance run.

## PostgreSQL ownership and effective configuration

Production is PostgreSQL 18, launched by
`~/Library/LaunchAgents/com.openclaw.opscenter.postgres-production.plist` with:

- Program: `/opt/homebrew/opt/postgresql@18/bin/postgres`.
- Data: `~/Library/Application Support/OpsCenter/postgres-production`.
- Explicit config: `~/Library/Application Support/OpsCenter/postgres-production.conf`.
  The `postgresql.conf` inside the data directory is **not** the owning config.
- Local socket: `~/Library/Application Support/OpsCenter/postgres-production-socket`,
  port 55433, database `opscenter_production`.
- launchd stderr destination: `~/Library/Logs/OpsCenter/postgres-production.err.log`.

The live settings query confirms `logging_collector=off` (config line 13),
`log_connections=on` (14), `log_disconnections=on` (15), and `log_destination=stderr`.
`log_rotation_age=1440min`, `log_rotation_size=10240kB`, log directory `log` and
filename `postgresql-%Y-%m-%d_%H%M%S.log` are defaults; they **do not rotate the
launchd stderr file while the collector is off**. `log_min_messages=warning` and
prefix `%m [%p] ` are defaults. No pending restart was reported.

`~/Library/Application Support/OpsCenter/database-control/maintain-postgres-production.sh`
is the installed nightly dump/14-backup-retention script, scheduled at 02:15 by
`com.openclaw.opscenter.postgres-backup`. It is not a log rotation owner.

Repository `scripts/prune-operational-storage.sh` does contain a generic manual
copy/truncate rotation: threshold 32MiB, three gzip generations by default. It
also prunes old LinxUp receipts and audit exports, so do **not** run its broad
`--apply` merely to rotate this log. No matching scheduled user LaunchAgent was
found. `/etc/newsyslog.conf` and its installed snippets contained no OpsCenter or
PostgreSQL entry; the inspected local/Homebrew rotation directories had none.
This establishes the inspected configuration, not proof that no ad-hoc task has
ever run the script.

## Measured volume

At approximately 19:09Z, the current PostgreSQL stderr log was **97,711,756 bytes**
(93.2MiB), 644,981 lines. Counts by the log's local-date prefix:

| Date | Received | Authenticated | Authorized | Disconnected |
| --- | ---: | ---: | ---: | ---: |
| Oct 6 | 4,927 | 4,927 | 4,927 | 4,927 |
| Oct 7 | 4,379 | 4,379 | 4,379 | 4,378 |
| Oct 8 | 4,892 | 4,892 | 4,892 | 4,893 |
| Oct 9, partial | 3,717 | 3,715 | 3,715 | 3,714 |

The handoff's ~12k figure conflates connection messages with sessions: one
successful connection produces received/authenticated/authorized messages, plus
one disconnection. On Oct 8 that is about 14.7k connection messages and 4.9k
disconnections. These are counts from this retained file, not whole-host metrics.

## Proposed PostgreSQL action

After explicit approval, set the two successful connection/disconnection flags
to off in the owning external config and reload configuration. Their live context
is `superuser-backend`; verify newly established sessions adopt the change rather
than claiming all existing sessions changed immediately. Keep warnings, errors,
failed authentication, durability, access rules and backup policy unchanged.
Verify actual settings/source lines and a new-session sample after reload.
No PostgreSQL restart is needed for these two flags; enabling the logging
collector is a different `postmaster` change and would require a planned restart.

For retained stderr, propose a **log-only**, bounded rotation action, separately
reviewed and scheduled daily with a 32MiB threshold and three compressed archives.
Use existing directory permissions, preserve the writer's open descriptor, avoid
following symlinks outside the approved log directory, serialize rotations, and
report archive/truncate failures. The current copy/truncate approach can lose
lines written between copy and truncation and requires temporary disk space; it
is suitable only if that bounded loss is accepted. For stronger completeness,
plan native PostgreSQL collector rotation at a later approved restart and retire
the stderr rotation overlap. Do not assume rename alone reopens launchd's file.

Future source work: add a log-only mode or separate reviewed helper beside
`scripts/prune-operational-storage.sh`, regression fixtures for preservation and
failure handling, an explicit installer/LaunchAgent for the log policy, and the
operations runbook. External config edits and installation remain a separate
approval boundary. None is implemented here.

## Retired-session polling

Read-only parse of the current application error log found **2,648** retired
identity rejection blocks: **2,434 API** and **214 page**. All had a Cloudflare
ray request ID. Blocks have no event timestamp, so a historical per-day rate
cannot be established from these entries. No request IDs or client records are
copied into this document.

`middleware.ts::logSessionRejection` currently records reason, API/page kind,
host, method, trusted-device boolean and `cf-ray`. A ray identifies one request,
not a stable device. The log cannot identify which phone/browser is polling.

Proposed bounded diagnostic fields: UTC event time; validated/bounded ray ID;
allowlisted route category (Command, Control, Crew, Fleet, Finance, other); coarse
browser family, OS family and mobile/desktop class from existing request headers.
Safari may lack client hints, so classify conservatively and preserve unknown.
Never log cookies, tokens, identity email, IP, full User-Agent, URL query,
customer/job identifiers or an opaque permanent fingerprint. A coarse hint can
narrow investigation but cannot prove a physical device; correlate a sampled ray
with already-available Cloudflare evidence and an operator's known open clients
only where that evidence is accessible without buying another service.

Keep rejecting every retired identity. Rate-limit **only repeated log lines**:
first occurrence per bounded reason/route/browser/OS bucket, then one summary
per five minutes with total/suppressed counts and first/last times. Cap buckets
(e.g. 256), expire idle ones (15 minutes), retain an overflow counter, and always
surface a new rejection reason. Avoid raw attacker-controlled keys, unbounded
maps or suppressing authentication enforcement. Preserve security-relevant
warnings and useful counts. A future frontend fix should stop polling on an
explicit retired-session response and return to sign-in without erasing saved
operational drafts; that is separate behavior to review/test.

Future source files: `middleware.ts`, a small new bounded auth-log helper under
`lib/`, mock-clock regression tests and the authentication runbook. No device
reset, sign-out, identity restoration or log suppression was performed.

## Disk pressure

The Data volume at inspection was **94% used, about 28GiB available** (`df`),
compared with 91%/42GB in the original handoff. Builds/worktrees make this value
move. A 93MiB log is only about 0.02% of a 460GiB volume, so rotating it will not
resolve the underlying capacity pressure. Keep normal documented release and
completed-worktree retention; separately review the largest generated artifacts
and retention exceptions before any further cleanup. Do not delete databases,
photos, runtime queues, source worktrees or unshipped work to meet a percentage.
The final task report should use a fresh post-build space reading.
