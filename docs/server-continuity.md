# Server continuity recovery

## Verified failure in the existing design

On September 12, the VPS application and assignment retry containers were
stopped. The VPS Cloudflare connector sent traffic to `127.0.0.1:3000`, which
was an SSH reverse forward to Mission Control. Both public connector paths
therefore depended on the Mac and its internet connection.

The September 4 routing change was documented in commit `69e6a405`. It directed
both paths to one application, one set of files, and one PostgreSQL database.
That avoided divergent operational state but removed independent application
availability. The existing three-minute data publication is a file copy; it
does not deploy application releases, replicate PostgreSQL, or start a standby.

## Recovery candidate

`deploy/vps/continuity.yaml` is an isolated recovery candidate, not the public
production configuration. Its application binds only VPS loopback port 3001.
PostgreSQL has no host port. Authentication remains enabled. Application data
and QBO files are mounted read-only while the database restore and application
are tested. The existing production relay on port 3000 remains separate.

Secrets live under `/etc/opscenter/continuity-*.env`, outside source. Compose
uses `env_file.format: raw` so password hashes containing dollar signs remain
literal. This requires Compose 2.30 or later; the inspected VPS runs 2.40.3.
See the [Compose service reference](https://docs.docker.com/reference/compose-file/services/).

The candidate uses the current production source plus Python and process tools
for the release checks. Its Docker context excludes authentication state and
local artifacts. It does not enable any new metered provider.

## Cutover requirements

Do not point public traffic at two independently writable data copies. Before
activating a writable server, establish one owner for operational files, kernel
database writes, external action retries, collectors, and webhook queues.

For a Mac-primary standby, promotion must fence Mac writes and incoming file
synchronization before the VPS accepts writes. Returning to the Mac requires
reconciling server-authored state before failback. A reachable login page alone
is not proof that these requirements are met.

For a VPS-primary deployment, transfer the final database and file state under
a write pause, move the public route to the independently running VPS app,
and prevent the Mac from overwriting VPS-authored records. Collector and token
ownership must be moved or explicitly classified as dependent on Mission
Control. Running the web application on the VPS while leaving all collectors
on the Mac provides page availability, but not uninterrupted fresh source data.

Cloudflare replicas distribute ingress connections; they do not reconcile
application state or by themselves define primary/standby routing. See
[Tunnel availability](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/).

Acceptance requires authenticated pages and source freshness to be checked on
the independent VPS, followed by a bounded simulation of the Mission Control
path being unavailable. Do not disconnect the user's whole network to test it.
Check that no uncertain external operation is automatically replayed.
