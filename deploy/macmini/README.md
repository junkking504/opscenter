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

After activation, the controller restarts every loaded release-bound collector
and watcher with a bounded timeout. A restart failure restores the prior
release. Superseded releases are pruned only after a bounded `lsof` scan proves
that no running process still references them; the active and immediately
previous releases are always protected.

Before deploying, commit and push the intended code, integrate it into
`origin/production`, and install or refresh the reviewed controller explicitly:

```sh
./deploy/macmini/install-production-release-controller-from-macbook.sh <mc-host> origin/production
```

Installing the controller does not build, activate, restart, or deploy
OpsCenter. It is a separate authorization boundary from deployment.

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

For production deployments:

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
Keychain. `/api/health` reports `stale-linxup-data` when today's normalized GPS
snapshot is more than three minutes old, and current OpsCenter pages refresh
when a newer LinxUp snapshot arrives.

### Dedicated JunkWare schedule detector

Current appointments and Slack schedule events use a persistent, verified
JunkWare schedule detector. JunkWare serializes concurrent browser logins, so
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
report their expected runtimes, use protected environment files, and keep the
new platform kernel disabled in production. It does not require production
services to be unloaded.

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
