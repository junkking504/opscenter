# Driving scores

The current desktop exposes daily truck scoring in Fleet → Driving Scores and
Daily Krewe, with an expandable event breakdown and pay-period driving review.
These use `buildFleetDailyRecord` and the existing `driving-score-policy.ts`.
No scoring weights, thresholds, payroll amounts, or collector cadence change.

A personal score requires a sole named driver, a confirmed scoring status, and
confirmed attribution confidence. Shared, partial, missing, or navigator-only
assignments remain labeled as truck scores requiring attribution review.
Pay-period counts include only days on which all attached scores are confirmed
and scorable. A below-60 day has at least one confirmed score below 60; multiple
trucks on one date count once. Missing data never becomes a zero score.

Truck load cards on the original Fleet page wrap at readable widths. Verification
notes remain accessible under “Load needs verification”; opening notes does not
stretch the other cards or mutate a load observation.

## API connection and recovery

Scoring is collected through the existing LinxUp V2 API token in Keychain; it
does not depend on an interactive portal login. The account's Setup →
API/Developers documentation at `https://app03.linxup.com/ibis/apidocs/` identifies
`https://app03.linxup.com/ibis/rest/api/v2` as its API base. The legacy
`www.awaregps.com` host failed certificate verification on September 16, 2026.
The daily, location-history and safety-alert collectors now use the documented
account host, with certificate validation and existing request cadence unchanged.

Install the reviewed external OpsBot collector changes using
`scripts/install-linxup-collection-safety.py --apply` while holding the existing
LinxUp processing lock and ensuring the independent daily collector is idle.
The installer accepts only the pinned original or previous reviewed hashes,
backs up changed files, rejects unknown drift before writing, and is idempotent.
After recovery, collect all three sources and rebuild daily metrics; confirm
source status, trip coverage, safety-event availability, and the authenticated
Driving Scores tab separately. Live GPS push alone is not scoring data.
