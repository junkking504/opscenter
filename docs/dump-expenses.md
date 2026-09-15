# Assumed dump expenses

Effective September 15, 2026, OpsCenter projects one assumed dump expense when
LinxUp reports a native geofence entry at a landfill, transfer station or dump.
The user supplied these minimums:

| Facility | Minimum |
| --- | ---: |
| Gentilly Landfill (GL) | $44.00 |
| Stranco Transfer Station (STS) | $85.00 |
| Baton Rouge Landfill (BRL / EBR) | $44.00 |
| River Birch Landfill (RBL) | $47.00 |

The observed LinxUp spelling `BR Landfilll` and `BR Landfill` also resolve to
Baton Rouge Landfill; the source spelling is retained on the visit record.

Other disposal facilities show **Minimum fee needed** and an incomplete combined
total. Warehouse and metal-recycling entries never create dump expenses. No
weight, receipt number, provider payment or fee is fabricated.

## Replacement rule

- The assumption appears on entry. Its replacement window stays open while onsite.
- An explicit exit sets the deadline to exactly 60 minutes after departure.
- A verified JunkWare dump expense with a recorded transaction time from entry
  through that deadline, inclusive, replaces the assumption. The source's recorded
  transaction time is the available matching evidence; collection time is not
  submission time. A delayed collection can therefore reconcile an on-time record.
- Match the physical truck and facility, including the configured aliases. A blank
  source location matches only one unambiguous eligible visit. Fuel and different
  trucks or facilities cannot replace the expense.
- One source expense replaces one assumption. When same-facility visit windows
  overlap, a named expense matches the latest eligible entry. Repeated entry
  reports before an exit and exact provider retries produce only one assumption.
- After the deadline the minimum stays assumed. A late actual remains its own
  source record; it does not automatically replace the earlier assumption.
- Neighboring-day local snapshots support midnight departures and receipts. The
  replacement retains the entry day's record, including when its actual expense
  is on the next day. Incomplete exit evidence never invents a timeout.

## Presentation and authority

Command displays an **Assumed dump expense** card until a qualifying actual
replaces it. Finance's **Dump Expenses** section displays the same records and
actual, assumed and combined operational totals. The existing Finance refresh
reconciles the projection; this adds no polling or external provider requests.
Actual source expense notifications keep their existing behavior; assumptions
send no new messages.

The projection lives in `lib/dump-expense-policy.ts` and `lib/dump-expenses.ts`,
derived on read from retained LinxUp and verified JunkWare history. It does not
write assumptions into JunkWare or QBO or alter published accounting totals.
The stable entry identity survives reloads and actual replacement. There is no
timer or stored estimate that can duplicate during a process restart.

The source defaults can be overridden with protected runtime configuration at
`data/config/dump-minimum-fees.json`: `effectiveFrom` (YYYY-MM-DD), optional
`defaultMinimumFee`, and `facilities` containing `name`, `aliases` and
`minimumFee`. Amounts must be nonnegative dollar values with at most two decimal
places; aliases must be unique. An invalid override shows settings unavailable
instead of silently using a different fee. Keep private runtime data out of Git.

Validation: `npm run verify:dump-expenses`, `npm run verify:geofence-alerts`,
truck expense notification checks, TypeScript, desktop build and production build.
