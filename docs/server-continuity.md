# Mission Control primary with a read-only VPS standby

The operator selected **Mission Control primary with VPS standby** on September
14, 2026. Automatic recovery is view-only. It does not promote a second writer.

## Ownership and routing

Mission Control owns application writes, operational files, PostgreSQL,
collectors, webhook processing, and external retries. The VPS holds a mirrored
file set and a separate restored database.

The VPS continuity gateway listens on loopback port 3002. It normally forwards
to the existing SSH origin relay on port 3000. When that origin is unavailable,
it permits a bounded set of page and data reads from the independent VPS app
on port 3001. The recovery page displays a prominent notice that records are
from the last synchronization and changes/source refreshes are paused.

The VPS Cloudflare `ops.junk-king.app` ingress can use port 3002 after acceptance.
The Mac connector continues to use its local primary directly. Webhook ingress
remains on the primary path; the standby does not acknowledge or enqueue writes.
Existing vendor retry behavior remains responsible for interrupted delivery.

The gateway selects the target before submitting a request. A connection reset
or timeout after submission returns an uncertain-result error and is never
replayed to either origin. New writes are refused while recovery is active.
Only operator sign-in and sign-out may write authentication state on the standby.
Several GET routes can trigger work, so the recovery API list is explicit and
collection/verification parameters are stripped. Unknown endpoints fail closed.

Returning traffic to a healthy Mission Control requires no business-record
merge because the standby never accepts operational writes. Its separate
login-throttle state is retained on the VPS.

## Independent enforcement

`deploy/vps/continuity.yaml` uses these boundaries:

- Application operational files and QBO state are mounted read-only; the root
  filesystem is read-only and Linux capabilities are dropped. The app runs as
  UID 1000, matching the mirror owner, so private source snapshots remain
  readable without broadening their permissions. Finance inventory reads do
  not acquire mutation locks or allocate legacy item numbers; the next
  authorized mutation performs that migration.
- `opscenter_recovery_20260914` is isolated from the retained old database and
  from Mission Control. `opscenter_standby_reader` has schema usage and SELECT
  privileges, no table writes or schema creation, and read-only transactions
  by default. Schema ownership remains with the restoring administrator.
- The app and database are on an internal Docker network. There is no direct
  external route from the app. A TLS CONNECT proxy permits only the exact
  existing Cloudflare Access team hostname on port 443. Other hosts and ports
  are rejected. Authentication validation and TLS verification stay enabled.
- No standby collectors, payment workers, assignment retries, or notification
  publishers run. Data freshness stops advancing when Mission Control stops.

The gateway allows up to ten seconds for standby readiness during a cold
source load. A healthy primary returns without waiting for that independent
check. A successful standby result is reused for at most 15 seconds to avoid
repeating expensive health reads during a screen load, then revalidated;
unavailable or incorrectly writable recovery still fails closed. Upstream
requests use separate connections, with no retry after submission.

The existing Playwright runtime includes Node 24, which supports
`NODE_USE_ENV_PROXY=1` for fetch and HTTP proxy routing. See [Node's proxy
configuration](https://nodejs.org/en/learn/http/enterprise-network-configuration).
Cloudflare replicas provide connector availability rather than database
ownership or origin-state replication. See [Tunnel availability](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/).

The loopback app port is published by a narrow TCP ingress companion because
Docker does not publish host ports directly from an internal-only network. The
companion forwards only to `app:3000`; it has no application credentials or data
mounts. The app itself remains on the internal network.

## Snapshot publication

Existing file synchronization remains primary-to-VPS. The snapshot publisher
invokes the current production file worker under its existing shared lock,
records file-copy freshness separately, and never pulls standby changes back. The steady-state standby
uses the VPS mirror read-only. Frozen candidate files are used for independent
restore QA before that binding is activated.

`publish-continuity-database.py` runs on Mission Control every 180 seconds under
`com.opscenter.continuity-database`. Its installed copy lives in
`~/Library/Application Support/OpsCenter/continuity-control/`. It reads the
production database through the existing restricted app role and local socket.
Imported accounting-statement JSON snapshots are also mirrored from their
separate Application Support directory into a read-only mount. Workbook
originals and credentials are excluded from this additional transfer.
Temporary dumps are private and removed; the nightly 14-backup retention is
unchanged.

The remote receiver verifies that the configured candidate still uses the
expected read-only database role and database. A transactional restore also
refuses to proceed if that role gains table-write or schema-create privileges.
Restores serialize, use a bounded lock wait, and commit schema/data/reader grants
together. A failed restore leaves the prior committed snapshot intact. Local
publication status and the remote `status/database-sync.json` record success
separately from ordinary file-sync health.

Three minutes is the configured publication interval, not a guaranteed recovery
point: failed or delayed jobs retain older data. Verify source timestamps in the
UI and the database receipt independently. No live GPS or collection continuity
is claimed while Mission Control is unavailable.

## Operations and verification

The source for the Docker-authorized Compose wrapper is
`deploy/vps/continuity-compose.sh`; its installed VPS entrypoint is
`/home/opscenter/continuity-compose.sh`. Protected env files stay under
`/etc/opscenter`, and the wrapper avoids printing their contents.

The candidate lives under `/srv/opscenter/continuity-20260912`; the date names the
retained task directory, not its current application version. Runtime app image
`opscenter:continuity-monitor-20260914` was built from the current production application
plus the continuity Docker configuration. Preserve the image ID and source SHA
in the acceptance record whenever replacing it.

Run `node --test scripts/test-continuity-proxy.mjs` for routing, denied writes,
GET-side-effect filtering, lost-response handling, return to primary, and the
authentication egress allowlist. Independently verify:

1. VPS-local app/database health, role privileges, network isolation, and source
   timestamps; a login response alone is insufficient.
2. Authenticated Schedule and Command reads through the isolated gateway with
   its primary set to an unavailable test port, plus the recovery notice.
3. Denied mutation requests against that isolated gateway, without sending
   synthetic operational requests to the live primary.
4. A bounded public routing test with an automatic restoration deadline,
   followed by authenticated primary UI and source-freshness checks.
5. Normal scheduled database publication and an injected transactional restore
   failure that leaves the previous schema and data intact.

Do not label ordinary data-sync success as healthy failover. Application release
updates must also rebuild and retest the standby; file and database publication
do not deploy code. The independent observer below detects release drift; it does not automatically deploy code.

## Writable promotion is not implemented

This design intentionally has no automatic writable promotion command. A future
promotion must fence **every** Mission Control writer and prevent an offline
Mac from resuming external actions, including collectors and retry workers.
It must stop both incoming snapshot publishers, define ownership generation,
reconcile uncertain source submissions, and establish a reviewed failback path.
Changing the gateway or mounting data read-write is not sufficient fencing.

Keep recovery view-only until that protocol is implemented and tested. The
read-only ownership guard is a safeguard for this mode, not a distributed lease
that proves the Mac has stopped writing.

## Build maintenance

The VPS user has Docker Buildx v0.37.1 installed under
`~/.docker/cli-plugins/docker-buildx`, verified against the SHA256 published in
the [official Docker release](https://github.com/docker/buildx/releases/tag/v0.37.1).
Use `docker buildx build --load` rather than the deprecated legacy builder.
The runtime image separates stable dependencies from application files and
omits Vite build dependencies and the Next build cache. No Docker daemon storage
configuration or paid capacity was changed.

## Independent continuity monitoring

Command > Monitor includes Server continuity. The VPS systemd timer
`opscenter-continuity-monitor.timer` invokes the Python observer every 60 seconds,
even when Mission Control is unavailable. Source lives in
`deploy/vps/continuity-monitor.py`; the installed script is
`/home/opscenter/continuity-monitor/observe.py`. Its private state directory is
mounted read-only in the standby app. The timer and service definitions live
beside the script in source; install them under `/etc/systemd/system`, verify
with `systemd-analyze verify`, reload systemd, then enable only this timer.
The observer uses the existing opscenter user's Docker inspection authority.

Mission Control's `com.opscenter.continuity-monitor` LaunchAgent exchanges
sanitized release and backup receipts every 60 seconds. Its source script and
plist live under `deploy/macmini/`; its installed script and `monitor.json`
are in `~/Library/Application Support/OpsCenter/continuity-control/`.
The collector uses the existing VPS SSH identity. An exchange failure preserves
the prior observation but marks it unavailable; it never substitutes success.
The VPS app reads the independent local evidence when the Mac is unavailable.

Ten checks cover the monitoring link, exact primary/VPS source revision parity,
read-only standby app/database identity, gateway readiness, primary relay,
public login and structured database readiness, operational file backup,
accounting-statement backup, independent database receipt, and VPS disk.
Evidence older than three minutes or future-dated is unknown. Backup snapshots
older than ten minutes and the latest failed publication need attention.
Disk warnings begin at 90% used or less than 5 GiB available.

Two bad observations at least 45 seconds apart confirm an incident; three
successful observations clear it. Unknown evidence never clears an incident.
The private `monitor.json` ledger retains occurrence counts and the most recent
100 transition receipts. Corrupt history is preserved for review. Do not delete
it to reset incident history. While a previous incident awaits its third good
check, the UI says recovery is being confirmed.

These deterministic checks make no AI/provider calls and send no Slack/email
messages. They display evidence and next checks, without repairs or writable
promotion. Public probes originate outside Mission Control but on the VPS;
they do not constitute a third independent availability monitor or an
end-to-end Cloudflare ingress configuration audit. Authenticated workflow QA
remains a separate acceptance requirement. Run `npm run verify:continuity`;
the normal application build includes these regression tests.
