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
