# OpsCenter Mission Control deployment

The intended long-term flow is:

```text
MacBook edits and tests -> Git commit and push -> Mission Control builds and runs that commit
```

Application code travels through Git. Authoritative OpsCenter/OpsBot data,
secrets, browser profiles, credentials, and logs remain outside the repository
on Mission Control.

Mission Control also keeps the ignored Slack alert configuration outside each
release at `/Users/missioncontrol/Library/Application Support/OpsCenter/slack.env`.
When that file exists, every deployed release links it as `.env.slack.local`;
the bot token remains in Keychain rather than in this file.

## Production lineage and deployments

The Git deployment uses immutable release directories under
`/Users/missioncontrol/opscenter-v2/releases`. The stable live path remains
`/Users/missioncontrol/opscenter-v2/opscenter`, but becomes a symbolic link to
the active release. This keeps all existing LaunchAgent paths valid.

`origin/production` is the only production deployment source. Feature branches
must first merge the active Mission Control commit and then be integrated into
`production`. A deployment activates a complete commit snapshot, so this
forward-only rule is what keeps previously shipped work in every later release.

Mission Control runs the production controller from outside Git release
snapshots:

```text
/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control/deploy-release.sh
```

This prevents the normal deployment command from using an older controller
carried by a stale feature branch. The installed controller serializes builds,
requires the requested SHA to equal `origin/production`, verifies that it
contains the active release before and after the build, and records successful
transitions in `deployment-history.tsv` beside the controller.

Before activation in either deployment mode, the controller runs the reviewed
release's kernel migration runner against the existing protected
`production.env`. It requires an enabled Mission Control kernel and the
`opscenter_production` database, passes only the migration environment, and
never evaluates configuration as shell code. Build, spending, and
lineage checks precede database changes; production head and ancestry are
checked again afterward. Migration failure prevents candidate startup, live-link
changes, and service restarts. Migration output is suppressed to keep protected
connection details out of deployment logs; investigate failures locally through
the existing database maintenance workflow.

The runner serializes migrations with its database advisory lock, verifies
checksums, and commits each migration separately. A failed migration rolls back
that file; earlier completed migrations remain. Production changes must use
reviewed backward-compatible migrations: automatic application rollback does
not undo schema changes. Destructive migrations require separate authorization.
An interrupted live migration retains the deployment lock for recovery.

After activation, the controller restarts every loaded release-bound collector
and watcher with a bounded timeout. A restart failure restores the prior
release. Superseded releases are pruned only after a bounded `lsof` scan proves
that no running process still references them; the active and immediately
previous releases are always protected. The shared retention helper keeps three
production releases and two previews, with explained exceptions for live
processes and recent builds. See [Workspace retention](../../docs/workspace-retention.md)
for the task-completion command and seven-day generated-file cleanup.

Release-bound LaunchAgents invoke their scripts through the stable macOS
`/bin/bash` or `/bin/zsh` executable. This keeps macOS Background Task
Management from treating every immutable-release symlink change as a newly
added background program. Collector installers also leave an identical
installed plist untouched while restarting the loaded service.

Production deployments now preserve all existing releases by default. Both
retention phases are skipped when `OPSCENTER_PRESERVE_RELEASES=true` (the default
in the launcher and installed controller). The launcher forwards this setting
explicitly; invalid values fail before deployment. Only a separately authorized
cleanup may use `false`. This does not change scheduled retention or authorize
cleanup. Install the reviewed controller before relying on this safeguard.

Before deploying, commit and push the intended code, integrate it into
`origin/production`, and install or refresh the reviewed controller explicitly:

```sh
./deploy/macmini/install-production-release-controller-from-macbook.sh <mc-host> origin/production
```

Installing the controller does not build, activate, restart, or deploy
OpsCenter. It is a separate authorization boundary from deployment.

Both launchers use installed controllers. They run the externally reviewed
spending gate before dependency installation. Controller installation preserves
the separately installed spending checker and allowlist; a routine release must
not approve new charges. See [Spending controls](../../docs/spending-controls.md).

For the first setup, supply MC's Bonjour name, DNS name, or address:

```sh
cd /Users/ejd/opscenter-v2/opscenter
./deploy/macmini/deploy-from-macbook.sh --bootstrap <mc-host> origin/production
```

The bootstrap preserves the existing transferred application folder as a
timestamped `pre-git-snapshot-*` directory. It does not enable a production
service or Cloudflare Tunnel, install the production controller, or deploy.
After bootstrap, run the explicit controller-install command below and then the
normal production deployment command.

The production build keeps its 6 GiB compiler heap cap and enables Next.js
Webpack memory optimizations. Runtime `data/` and `logs/` links are excluded
from dependency tracing: their contents stay external and available at runtime.
Next.js 16 applies public trace exclusions after its initial entrypoint scan,
so `next.config.mjs` also applies them to the entrypoint tracing plugin. The
guard deliberately fails if that plugin changes; review it when upgrading Next.js.
This prevents compilation from exhausting memory while traversing live records.

For production deployments:

On Mission Control, `./deploy/macmini/ship.sh <PR number> [--dry-run]` is an
optional wrapper for an explicitly authorized release. Before merging it checks
CI, explicit stop labels, and that the exact PR head contains both the active
release and current production. A real merge pins that head; deployment uses
`deploy-from-macbook.sh` over localhost SSH and its fixed installed controller.
There is no controller-path override. Dry run performs read-only Git fetches
and checks but neither merges nor deploys. Review receipts are optional.
The installed controller repeats lineage and operational checks before activation.

Run the launcher from the reviewed source checkout or task worktree. Its Git
check supports both ordinary checkouts and linked worktrees.

```sh
git fetch origin
./deploy/macmini/deploy-from-macbook.sh <mc-host> origin/production
```

To avoid repeating the host, set `OPSCENTER_MC_HOST` in the MacBook shell's
private environment and run:

```sh
OPSCENTER_MC_HOST=<mc-host> ./deploy/macmini/deploy-from-macbook.sh origin/production
```

The controller uses `~/.ssh/id_ed25519_opscenter` by default. Set
`OPSCENTER_MC_SSH_KEY` when the approved Mission Control key is stored at a
different private path.

The local and installed controllers both reject any requested SHA other than the
current `origin/production` head. The installed controller builds before
changing the live link. If an OpsCenter preview or production LaunchAgent is
already loaded, it restarts that service and requires the login page to return
HTTP 200. A failed startup automatically restores the previous live link and
restarts the prior release. Each release also installs the Chromium revision
pinned by Playwright so JunkWare closeout and truck-assignment actions remain
available after dependency updates.

Independent review is optional under the owner's October 31, 2026 policy.
Neither the shipping wrapper nor the installed controller requires a review
receipt. The optional audit and opted-in review relay remain available; see
[agent handoffs and review](../../docs/agent-handoffs.md#optional-review-audit).
Install the updated controller explicitly for this policy to apply on the host.

The normal deployment command has no non-forward override. A manual rollback
requires a separately reviewed and explicitly authorized recovery procedure;
never move `origin/production` backward merely to make a deployment pass.

### Dedicated LinxUp freshness collector

Production GPS and appointment-visit matching run independently of the slower
JunkWare, QBO, Crew Portal, and VPS publishing cycle. After deploying a release
that includes the collector, install or refresh its LaunchAgent with:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/install-linxup-collector.sh
```

The LaunchAgent runs once per minute and uses the LinxUp API token stored in
Keychain. V3 Position Push is authoritative while current; this minute collector
remains enabled as verification, backfill, and automatic V2 fallback.
`/api/health` reports `degraded-linxup-v3-fallback` when the normalized snapshot
is current but V3 delivery is not, and reports `stale-linxup-data` when today's
normalized GPS snapshot is more than three minutes old. Current OpsCenter pages
refresh when either source advances the normalized snapshot.

### Dedicated JunkWare schedule detector

Current appointments and Slack schedule events use a persistent, verified
JunkWare schedule detector. The installer allows up to ten minutes for a cold
initialization to finish all four markets and produce a verified heartbeat newer
than the restart. A missing, stale or invalid heartbeat still fails deployment;
normal operation keeps its existing freshness thresholds. JunkWare serializes concurrent browser logins, so
one browser checks the four markets in sequence and publishes each market as
soon as it is verified. Each sweep begins five seconds after the previous sweep
completes. The production in-session sweep measured 17.2 seconds total and about
4.3 seconds per market, yielding a roughly 22-second same-market read cadence
before the five-second OpsCenter browser check. This targets about 30 seconds and
keeps the operating requirement below 60 seconds. The full multi-integration
collector remains the reconciliation and enrichment path.

Production deployments reinstall this detector even if its LaunchAgent has
become unloaded. To repair or verify it independently, run:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/install-junkware-schedule-detector.sh
```

The detector writes verified market snapshots below
`data/history/junkware/schedule-watchers/` and a heartbeat to
`data/slack/junkware_schedule_watchers/detector.json`. `/api/health` reports
`stale-junkware-schedule` when the current-day verified snapshot is older than
two minutes. Current OpsCenter pages poll the combined freshness signal every
five seconds and refresh when a newer verified schedule arrives.

To deploy OpsCenter while leaving the separately managed WhatsApp photo worker
untouched, set `OPSCENTER_RESTART_WHATSAPP_PHOTO_WORKER=false` for the deployment
command. The default remains to restart the worker when it is loaded so it uses
the newly active release.

The WhatsApp job-photo integration has a separate, opt-in worker because it
performs authenticated JunkWare writes. Follow `docs/whatsapp-job-photos.md`
to configure Meta credentials and the private truck-phone map, then install
only `com.openclaw.opscenter.whatsapp-photos`. Do not start the worker until
the webhook, sender mapping, GPS safety gates, and test-safe JK are ready.

### Preview-only deployments after cutover

Production and preview must not share the same stable release symlink after
cutover. Production continues to use:

```text
/Users/missioncontrol/opscenter-v2/opscenter
```

Preview uses OpenStreetMap and OSRM without loading Google Maps billing credentials.
See [the mapping billing boundary](../../docs/linxup-push.md#mapping-billing-boundary).

Preview uses a separate link and release tree:

```text
/Users/missioncontrol/opscenter-v2/opscenter-preview
/Users/missioncontrol/opscenter-v2/preview-releases/<commit>
```

After pushing the intended commit, deploy only preview with:

```sh
./deploy/macmini/deploy-preview-from-macbook.sh <mc-host> HEAD
```

Or use `OPSCENTER_MC_HOST` as with production deployments. The preview deploy
builds in the preview release tree, runs kernel migrations, atomically switches
only the preview link, restarts only the preview LaunchAgent, verifies both
runtimes, and restores the previous preview link if validation fails. It records
and checks the production link before and after activation.

Do not use `deploy-release.sh` for preview after cutover; when production is
loaded that script deliberately targets production.

## Initial isolated preview transfer

This package prepares a second OpsCenter instance for the macOS account
`missioncontrol`. It is deliberately isolated from the production instance on
the current Mac.

## Safety boundary

The preview configuration:

- listens only on `127.0.0.1:3100`;
- uses a separate Next.js build directory;
- creates a separate authentication secret on the Mac Mini;
- does not install or start the JunkWare collector;
- does not run scheduled history reconciliation;
- does not synchronize the VPS or Crew Portal;
- does not install or start Cloudflare Tunnel;
- does not copy production environment secrets, browser sessions, SSH keys, or
  Cloudflare credentials.

The current Mac remains the only production OpsCenter until a separate cutover
is explicitly performed.

## 1. Create a preview transfer on the current Mac

Connect an external drive and run, replacing the example destination with the
actual mounted drive or destination folder:

```sh
cd /Users/ejd/opscenter-v2/opscenter
./deploy/macmini/create-preview-transfer.sh /Volumes/OPSCENTER_TRANSFER
```

This creates a timestamped `OpsCenter-MacMini-Preview-*` folder. It contains the
complete current application working tree, including uncommitted and untracked
source files, plus a non-authoritative snapshot of OpsBot data. Build artifacts,
caches, logs, Git metadata, and production secrets are excluded.

Because production remains active, the copied data is only a staging snapshot.
Do not use it for authoritative writes or reporting after the transfer date.

## 2. Copy the staged folders to the Mac Mini

While logged into the Mac Mini as `missioncontrol`, copy the contents beneath
the bundle's `Users/missioncontrol` folder into `/Users/missioncontrol`.

The resulting paths must be:

```text
/Users/missioncontrol/opscenter-v2/opscenter
/Users/missioncontrol/.openclaw/workspace/opsbot/data
```

Do not copy the current Mac's LaunchAgents or enable a Cloudflare tunnel.

## 3. Install prerequisites on the Mac Mini

Install the Xcode command-line tools, Homebrew at `/opt/homebrew`, and Node.js.
Then confirm these commands work:

```sh
node --version
npm --version
/opt/homebrew/bin/brew --version
```

OpenClaw, Python Playwright, cloudflared, the persistent browser profile, SSH
key, Wrangler credentials, and production environment files are not required
for preview mode. They are deliberately deferred until cutover preparation.

## 4. Build and start the isolated preview

Run on the Mac Mini:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
chmod 755 deploy/macmini/*.sh
./deploy/macmini/install-preview.sh
```

The installer refuses to run under any username other than `missioncontrol`.
It also refuses to continue if a production OpsCenter, collector, browser
keepalive, reconciliation job, or public tunnel is already loaded.

Open the preview directly on the Mac Mini:

```text
http://127.0.0.1:3100
```

Use the shared username and password on the local login screen. Configure
`OPS_AUTH_USERNAME` and a salted `OPS_AUTH_PASSWORD_HASH` in the protected
runtime environment; never store the password in the repository.

The configured primary identity defaults to `admin`. Use `OPS_AUTH_ROLE`,
`OPS_AUTH_DEFAULT_ROLE`, and `OPS_AUTH_ROLE_BINDINGS` to assign interactive
`admin`, `manager`, or `operator` access without storing role data in source.
See [the OpsCenter role model](../../docs/OPSCENTER_ROLE_MODEL.md) for the
permission matrix and binding formats.

## 5. Verify isolation

Run:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/verify-preview.sh
```

Every check must report `PASS`. In particular, the production collector and
Cloudflare tunnel must report as unloaded.

`verify-preview.sh` is a pre-cutover verifier. It is intentionally expected to
fail after Mission Control becomes production because production services are
then loaded.

## Post-cutover production and preview coexistence

After a supervised cutover, use the separate coexistence verifier:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/verify-coexistence.sh
```

This verifies that production and preview are distinct localhost listeners,
report their expected runtimes, and use protected environment files. Enabled
kernels must report healthy runtime state and database names matching their
runtime-specific configuration. Preview uses `opscenter_preview`; when both
kernels are enabled their database names must differ. Production may remain
enabled. The preview PostgreSQL socket/cluster checks remain required with
`--require-preview-kernel`. No production services or configuration are changed.

When validating the isolated preview database and kernel, add:

```sh
./deploy/macmini/verify-coexistence.sh --require-preview-kernel
```

The coexistence verifier reports aggregate application health as a warning so
data freshness can be handled separately without weakening isolation checks.

### Install the isolated preview database

PostgreSQL 18 must be installed through Homebrew without starting its default
service. The OpsCenter installer creates its own cluster, Unix socket, app
role, database, and LaunchAgent:

```sh
brew install postgresql@18
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/install-postgres-preview.sh
```

The preview cluster uses a Unix socket under the protected OpsCenter support
directory and has no TCP listener. It does not change `production.env` and it
refuses to proceed if Homebrew's default PostgreSQL service is loaded.

Run schema migrations from the release being validated, with the preview
runtime and database URL loaded from the protected preview environment. Then
verify the cluster and exercise backup/restore:

```sh
./deploy/macmini/verify-postgres-preview.sh
./deploy/macmini/test-postgres-preview-backup.sh
./deploy/macmini/verify-coexistence.sh --require-preview-kernel
```

## Future production preparation

The `production-launchd` directory contains the final service definitions for
`/Users/missioncontrol`, but preview installation does not copy or load them.
Do not place these files in `~/Library/LaunchAgents` while the current Mac is
still production.

Before a future cutover:

1. transfer the final authoritative OpsBot data, secrets, Keychain items,
   persistent browser profile, Cloudflare credentials, Wrangler authentication,
   and VPS SSH key;
   store production environment values in
   `/Users/missioncontrol/Library/Application Support/OpsCenter/production.env`
   with mode `600`;
2. run `deploy/macmini/prepare-runtime-paths.sh` to convert the active OpsBot and
   OpenClaw configuration paths from `/Users/ejd` to
   `/Users/missioncontrol`;
3. reinstall the OpenClaw gateway service from the `missioncontrol` account so
   its generated service environment uses the new home directory;
4. validate all integrations manually;
5. stop the collector and public tunnel on the current Mac;
6. only then install and load the files from `production-launchd` on the Mini.

Cutover should be handled as a separate, supervised operation with rollback to
the current Mac available.


The schedule-detector installer rechecks PID liveness when `ps` no longer returns
the expected command after `launchctl bootout`. An already-exited detector is a
successful stop; an unrelated or unidentified live process still blocks the
release. `scripts/test-detector-restart-race.ts` covers both cases.

## Release slots

See the [release-slot runbook](../../docs/zero-downtime-deploys.md) for the separately reviewed installation,
first proxy bootstrap, graceful rollback, routine activation and retained-slot
protections. Source deployment alone does not enable slot mode.

## Zero-touch releases (auto-ship)

`deploy/macmini/auto-ship.sh` considers up to 1,000 open production PRs
labeled `ready-to-ship`, sorted oldest first. Conflicted or pending/failing-CI
candidates retain their labels and do not block the next candidate. So does a
PR that production outran (`PR must contain the active release`), and a PR
whose `ship.sh` refusal happened before any merge. The first release or
recorded failure ends the tick. There is no pause between releases, so the next
tick (two minutes later) takes the next labeled PR.
Every candidate still goes through `ship.sh`: exact fetched head, current
production ancestry, CI, and explicit `claude-stop` labels. Review receipts
are optional.
The standard installed controller builds, health-checks and handles rollback.

The queue lookup runs inside the dedicated `worktrees/ship` checkout regardless
of launchd's working directory. A dirty checkout blocks its refresh. A lock
serializes the entire tick, including PR bookkeeping.
The off switch and deployment lock are checked again before each candidate.
Known failures remove `ready-to-ship`, add `ship-failed`, and attempt a PR comment
(label updates are retried three times on GitHub errors);
a failed comment is logged, and a failed PR-state lookup is reported as UNKNOWN.
No comment infers a successful deployment or rollback from a merged PR alone.

Before calling `ship.sh`, the scheduler writes `auto-ship.inflight` in its
configuration directory. Normal completion or a recognized pre-merge wait
removes it. An interruption, failed label update, or failed release whose PR is not
confirmed OPEN retains it and blocks later ticks. An unclassified failure
(without an explicit pre-merge refusal from `ship.sh`) also retains it even
if the PR still appears OPEN. A merged PR with a failed deployment must be
reconciled before any later candidate can deploy that production history. INT/TERM/HUP release the owned scheduler lock; SIGKILL or a machine crash
may leave the lock too. Lock contention is logged so a persistent stale lock
is visible. Never automatically delete either marker on a timer.
An operator must confirm that the scheduler/release children have stopped,
inspect the PR head/state/labels, active release, controller log and health,
reconcile any partial merge/deploy and label changes, then remove the stale
markers. Retry/release permission remains separate.

It is not installed by merging. Install deliberately from
`launchd/com.opscenter.auto-ship.plist.example`. Existing installations keep
executing their selected script until that checkout/controller is updated;
merging alone is not evidence that the fixed scheduler is running. Off switch:
`touch "$HOME/Library/Application Support/OpsCenter/auto-ship.off"`.

Check offline with `python3 scripts/test-auto-ship.py` and
`python3 scripts/test-ship-preflight.py`. Both execute real zsh with stubbed
GitHub, Git and release operations; Bash is not a valid substitute. The CI
release-script job installs zsh and runs these plus the review-gate suite.
