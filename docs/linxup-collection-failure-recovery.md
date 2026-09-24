# LinxUp certificate failure and retained source data

## Verified incident: September 15, 2026

At 13:15 CDT, a verified TLS handshake to `www.awaregps.com:443` failed with
OpenSSL error 10 at depth 0. The endpoint served leaf `CN=*.awaregps.com`, issued
by Go Daddy Secure Certificate Authority G2, expiring at
`2026-09-15T13:17:00Z` (08:17 CDT). Its root and intermediate verified. Python's
default system CA store, explicit `/etc/ssl/cert.pem`, the installed certifi
bundle, and curl independently rejected the certificate as expired.

This is an endpoint certificate expiration, not a missing local trust root.
The last good metrics publication reported by the incident owner was 08:16 CDT.
Current refresh logs independently confirmed seven completed JunkWare records,
then four LinxUp daily endpoint failures and a LinxUp alerts TLS failure before
metrics processing. No credentials were used for the TLS diagnosis.

The provider must renew its certificate. Keep hostname, chain and expiry
verification enabled. Do not change trust stores, clocks, endpoints or TLS
verification settings to accept the expired certificate. Python's
[SSL documentation](https://docs.python.org/3/library/ssl.html) describes the
verified client context used here.

## Collector repair

`scripts/install-linxup-collection-safety.py` installs three narrowly reviewed
patches into the separately owned OpsBot collectors and one shared helper:

- `collect_linxup_daily.py`
- `collect_linxup_location_history.py`
- `collect_linxup_alerts.py`
- `linxup_collection_safety.py`

Patches preserve existing provider URLs, credentials, date ranges and schedules.
Daily collection retains its one attempt per endpoint; alerts/history retain
their maximum five attempts for transient errors. Certificate verification
failures stop without immediate retry. TLS errors disclose verification codes
without logging credentials or response bodies.

Daily collection now exits nonzero before writing any raw/CSV snapshot when any
endpoint fails. Alerts/history retain prior snapshots on transport, malformed
response or validation failures. Alerts also exit nonzero if a zero-row response
would replace existing records. Failure sidecars carry `source_status: failed`,
`status: stale|missing`, an attempt timestamp, and the previous snapshot's source
timestamp; a failed attempt never advances that timestamp. Valid recovery clears
the error. Existing error-bearing daily raw snapshots are not treated as verified
success merely because they contain a recent `retrieved_at`.

A successful, validated zero-row response is complete when there is no prior
non-empty snapshot to protect. The collector records `pagination_completed: true`
for that empty result so Visit Tracking does not report a false incomplete day.
An empty response that would replace prior records still fails closed and retains
the prior snapshot.

Status locations under OpsBot's existing LinxUp history directory:

- `linxup_DATE_status.json`
- `linxup_location_DATE_status.json`
- `alerts/linxup_alerts_DATE_status.json`

The revenue integration owns source-aware metrics freshness and independent
publication in `run_opscenter_refresh.sh`. These collector changes neither edit
that orchestration nor deploy/restart anything. V3 push data remains a separate
source; a V2 failure does not establish that V3 reception has failed.

## Coordinated installation and verification

Run from the integrated production checkout, after including this commit in the
revenue fix. Use the rollout owner's maintenance boundary to prevent concurrent
collector execution during the short four-file installation. The revenue owner
will hold `tmp/opscenter_refresh.lock` between cycles; also ensure the independent
LinxUp collector is outside its execution window. Do not independently restart
production or another task's workers.

```sh
python3 scripts/test-linxup-collection-safety.py
node scripts/verify-spending-boundary.mjs
python3 scripts/install-linxup-collection-safety.py --root /Users/missioncontrol/.openclaw/workspace/opsbot
python3 scripts/install-linxup-collection-safety.py --root /Users/missioncontrol/.openclaw/workspace/opsbot --apply
python3 scripts/install-linxup-collection-safety.py --root /Users/missioncontrol/.openclaw/workspace/opsbot
```

The first installer invocation checks hashes and compiles proposed source without
modifying runtime. Any unexpected current file or existing helper fails the check
before writes. Apply records original source in a new OpsBot `backups/` directory
and replaces each file atomically, helper first. All four files must match on
read-back. This is a multi-file source installation, not a cross-file transaction;
if interrupted, rerun the same installer under the maintenance boundary.

The versioned fixtures are sanitized collector source for offline regression
tests, not runtime data. The production installer patches hash-verified runtime
source; it does not install fixtures. No spending gate/allowlist change, new
provider or dependency is required.

Let the coordinated refresh execute normally after installation. While the
certificate is expired, verify nonzero LinxUp results and failed status sidecars;
hashes/mtimes of retained snapshots must stay unchanged. Independently verify
that validated JunkWare revenue publishes with stale/missing GPS freshness via
the revenue integration. The already-overwritten daily empty snapshot cannot be
recovered by this fix; do not label it last verified. Historical backup recovery
requires separately verified source evidence.

Check provider recovery without credentials:

```sh
openssl s_client -connect www.awaregps.com:443 -servername www.awaregps.com -verify_hostname www.awaregps.com -verify_return_error </dev/null
```

Only a successful verified handshake followed by a successful normal collector
run and current source timestamps proves V2 recovery. A deployment or passing
mock test alone does not prove provider recovery.

## Validation

Twelve offline tests cover certificate expiry/hostname/trust rejection with
verification enabled, bounded transient retries, malformed JSON and envelopes,
all three collectors retaining timestamps/data on TLS failures, missing data,
partial daily failures, valid recovery, empty alerts regression, old error
snapshots, installer drift rejection, backups and idempotence. No live collection
or business-record writes are performed by the tests.
