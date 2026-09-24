# Geocodio free address fallback

Status: implemented and mock-tested; not activated or live-verified. Account,
credential installation, installed spending inventory and deployment are pending.

The September 24, 2026 user request approves Geocodio only as a free fallback,
with $0 in new charges. Retain parish GIS, Census and existing OSM precedence.
Geocodio runs only when none produced an accepted location, including a Census
ambiguity that an independent exact premises point may resolve. It does not
replace the map renderer or modify JunkWare source addresses.

## Acceptance and privacy

- Send one cleaned service address, not names, phones, notes or unit identifiers.
- Do not query explicit building identifiers as an unsuffixed base premise.
- Require exactly one result, accuracy 1, `accuracy_type: rooftop`, exact house,
  street, city, Louisiana state, US country and ZIP; retain territory checks.
- Reject interpolation, nearest-rooftop, road/city centroids, unexpected unit
  results, conflicting candidates and changed identity. No first-result shortcut.
- Distinguish building/parcel/unspecified premises points in the reason. Never
  claim an apartment entrance is located. Preserve original crew unit instructions.
- Cache provider responses six hours and accepted address verification through
  the existing seven-day cache. Revalidate cached provider responses every time.

## Activation checklist

1. Sign in to the organization's free Geocodio account. Verify no payment method,
   subscription, prepaid credits or paid upgrade. Do not create a second account
   to evade limits. Review other account consumers because quotas are shared.
2. Create a server-side key limited to forward geocoding where supported. Never
   paste credentials into a task, Git, public URL, browser bundle or OpsWiki.
3. Install protected configuration at
   `~/Library/Application Support/OpsCenter/geocodio-free-fallback.json`, mode
   0600. Fields: `schema: 1`, `enabled: true`, `provider: "geocodio"`,
   `maxSpendMicros: 0`, `maxRequests: 2500` (may be lower),
   `noPaymentMethod: true`, ISO `verifiedAt`, ISO `validUntil` no more than 31
   days later, and `apiKey`. Record account verification, not an assumption.
4. Initialize `geocodio-free-usage.json` in the same protected directory only
   after confirming there is no prior usage history to preserve. Initial shape:
   `{ "schema": 1, "lastAt": 0, "attempts": [], "blockedUntil": 0, "cache": {} }`.
   Do not reset, delete or replace existing history to restore capacity. Back up
   this file along with the configuration; never commit either.
5. Review and install the hostname inventory and pinned new module hashes using
   the [spending-control procedure](spending-controls.md). Do not alter other
   approvals or the checker. Then ship via the immutable production controller.
6. Test failing Louisiana addresses with bounded free requests. Read back saved
   source/precision, ledger count, background sweep and authenticated Schedule
   pins. A build or successful API response alone is not live acceptance.

Missing/disabled/expired configuration performs no Geocodio request. Missing or
corrupt ledger fails closed. A shared lock spans reservation and request; a crash
can strand it, intentionally requiring review rather than automatic deletion.
Reservations are fsynced before network access and never refunded after errors.
HTTP 401/403/429 pauses the provider for 25 hours. No fields, batch jobs, redirects,
SDKs, paid services or changes to the AI budget are included.

For tests only, override `GEOCODIO_FREE_CONFIG_FILE` and
`GEOCODIO_FREE_STATE_FILE` with isolated temporary paths. The normal address
test command disables real configuration, and the Geocodio tests supply only
synthetic configuration and mocked fetch responses.

Sources reviewed September 24, 2026:
[free-account cutoff](https://www.geocod.io/free-geocoding),
[API v2, accuracy and authorization](https://www.geocod.io/docs/),
[storage terms](https://www.geocod.io/terms-of-use).
