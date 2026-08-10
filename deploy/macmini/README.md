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

## Ongoing commit-based deployments

The Git deployment uses immutable release directories under
`/Users/missioncontrol/opscenter-v2/releases`. The stable live path remains
`/Users/missioncontrol/opscenter-v2/opscenter`, but becomes a symbolic link to
the active release. This keeps all existing LaunchAgent paths valid.

Before deploying, commit and push the intended code from the MacBook. A dirty
working tree is allowed, but uncommitted changes are deliberately excluded.

For the first deployment, supply MC's Bonjour name, DNS name, or address:

```sh
cd /Users/ejd/opscenter-v2/opscenter
./deploy/macmini/deploy-from-macbook.sh --bootstrap <mc-host> HEAD
```

The bootstrap preserves the existing transferred application folder as a
timestamped `pre-git-snapshot-*` directory. It does not enable a production
service or Cloudflare Tunnel.

For later deployments:

```sh
git push
./deploy/macmini/deploy-from-macbook.sh <mc-host> HEAD
```

To avoid repeating the host, set `OPSCENTER_MC_HOST` in the MacBook shell's
private environment and run:

```sh
OPSCENTER_MC_HOST=<mc-host> ./deploy/macmini/deploy-from-macbook.sh HEAD
```

The controller uses `~/.ssh/id_ed25519_opscenter` by default. Set
`OPSCENTER_MC_SSH_KEY` when the approved Mission Control key is stored at a
different private path.

The remote deployment refuses commits that are not contained in a pushed
origin branch. It builds the release before changing the live link. If an
OpsCenter preview or production LaunchAgent is already loaded, it restarts that
service and requires the login page to return HTTP 200. A failed startup
automatically restores the previous live link and restarts the prior release.
Each release also installs the Chromium revision pinned by Playwright so
JunkWare closeout and truck-assignment actions remain available after dependency
updates.

To roll back manually, deploy the previous commit SHA with the same command.

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
