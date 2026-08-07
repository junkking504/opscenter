# OpsCenter VPS deployment

This deployment keeps the proven collectors on the Mac for the first cutover and runs the public web application on a Linux VPS. The Mac synchronizes fresh data to the VPS after collection. Once this is stable, the browser collectors can be ported separately without risking the public dashboard.

## Target layout

- `/srv/opscenter/source`: deployable application source
- `/srv/opscenter/data`: synchronized operational data and app state
- `/srv/opscenter/qbo`: persistent QuickBooks tokens
- `/etc/opscenter/app.env`: application secrets, mode `0600`
- `/etc/cloudflared`: tunnel configuration and credentials

The Docker container publishes Next.js only on `127.0.0.1:3000`. Cloudflare Tunnel is the only public path to the application. Do not open port 3000 in the VPS firewall.

## Minimum server

Use a current Ubuntu LTS server with at least 2 vCPU, 4 GB RAM, and 40 GB SSD. Use 80 GB if collector history and backups will later move to the VPS. Install Docker Engine, the Docker Compose plugin, `rsync`, and `cloudflared` from their official repositories.

## First deployment

1. Create a non-root deployment user with SSH-key access and permission to run Docker.
2. Create the target directories and give the deployment user ownership of `/srv/opscenter`.
3. Copy `app.env.example` to `/etc/opscenter/app.env`, fill the real values, and set mode `0600`.
4. Configure Cloudflare Access for `ops.junk-king.app` before moving the tunnel. Allow only the intended Junk King users. The application's legacy email form is not sufficient perimeter authentication by itself.
5. From the Mac, set `OPSCENTER_VPS=user@server` and, when using a dedicated key, `OPSCENTER_SSH_KEY=/path/to/key`. Then run `deploy/vps/sync-data.sh initial`.
6. Run `deploy/vps/push-app.sh` to upload the current working tree, build the image, and start it.
7. Verify `curl http://127.0.0.1:3000/api/health` on the VPS.
8. Copy the existing Cloudflare tunnel credentials to `/etc/cloudflared`, update its service to `http://127.0.0.1:3000`, and start the VPS tunnel connector.
9. Confirm the public site through Cloudflare Access, then stop the Mac's tunnel connector. Leaving both tunnel connectors running briefly provides a rollback window, but requests may reach either machine during that overlap.

## JunkWare text notifications

OpsCenter uses an iPhone Shortcuts message automation as a free low-latency feed. Each Junk King notification is sent to the protected OpsCenter webhook, displayed in the live update rail, and used to wake the authoritative JunkWare collector. The most recent 100 messages are stored in the private VPS data volume.

1. Generate separate `JUNKWARE_SMS_INGEST_TOKEN` and `JUNKWARE_SMS_REFRESH_TOKEN` values with `openssl rand -base64 48`. Put both on the VPS and put only the refresh token in the Mac collector environment.
2. Put the ingest token in the iPhone shortcut's `Authorization: Bearer …` request header.
3. Route `hooks.junk-king.app` through the existing Cloudflare tunnel without a Cloudflare Access policy. Middleware limits that hostname to the signed webhook and token-protected status endpoint.
4. On the iPhone that receives Junk King texts, create a Message automation filtered to the notification sender and set it to run immediately.
5. Add a Get Contents of URL action that POSTs JSON to `https://hooks.junk-king.app/api/integrations/junkware/sms` with `text`, `sender`, and `receivedAt` fields derived from the incoming message.
6. Send one test notification and confirm it appears in the OpsCenter live update rail and the Mac collector log reports an immediate SMS-triggered schedule refresh.

## Continuing data updates

Run `deploy/vps/sync-data.sh incremental` on the Mac immediately after each successful collector cycle. It first pulls VPS-authored state such as manual bonuses and route assignments, then pushes current operational data. It intentionally excludes large backups, audits, and quarantine folders.

Do not automate the sync until an initial run and a manual incremental run both succeed. The existing Mac service remains the rollback path until at least one full operating day has been verified on the VPS.

## Verification

- Container status is `healthy`.
- `/api/health` reports `ok: true` and a recent metrics timestamp.
- Dashboard, jobs, finance, fleet, manual bonuses, and route planner load through the public hostname.
- Cloudflare Access rejects an unapproved identity.
- New collector data appears on the VPS within one refresh interval.
- Stopping the Mac tunnel does not interrupt the public site.
