# OpsCenter Mac Mini staging deployment

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

Use an authorized `@junk-king.com` email on the local login screen. Preview
authentication is local and uses a secret generated specifically for the Mini.

## 5. Verify isolation

Run:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
./deploy/macmini/verify-preview.sh
```

Every check must report `PASS`. In particular, the production collector and
Cloudflare tunnel must report as unloaded.

## Future production preparation

The `production-launchd` directory contains the final service definitions for
`/Users/missioncontrol`, but preview installation does not copy or load them.
Do not place these files in `~/Library/LaunchAgents` while the current Mac is
still production.

Before a future cutover:

1. transfer the final authoritative OpsBot data, secrets, Keychain items,
   persistent browser profile, Cloudflare credentials, Wrangler authentication,
   and VPS SSH key;
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
