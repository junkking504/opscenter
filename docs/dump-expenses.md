# Assumed dump expenses

Effective September 15, 2026, OpsCenter projects one assumed dump expense when
the visit-tracking agent establishes a positive facility arrival at a landfill, transfer station or dump.
The user supplied these minimums:

| Facility | Minimum |
| --- | ---: |
| Gentilly Landfill (GL) | $44.00 |
| Stranco Transfer Station (STS) | $85.00 |
| Baton Rouge Landfill (BRL / EBR) | $47.00 |
| River Birch Landfill (RBL) | $47.00 |

The observed LinxUp spelling `BR Landfilll` and `BR Landfill` also resolve to
Baton Rouge Landfill; the source spelling is retained on the visit record.

Other disposal facilities show **Minimum fee needed** and an incomplete combined
total. Warehouse and metal-recycling entries never create dump expenses. No
weight, receipt number, provider payment or fee is fabricated.

## Replacement rule

- The unload/cost agent consumes the visit agent's normalized facility visits.
  Native entries and positive GPS facility reports both qualify. One stable visit
  identity produces one unload at its original arrival and one assumed minimum.
- A verified actual replaces the assumption whenever it is recorded; there is
  no sixty-minute expiry. Late collection or manual entry backdated to the visit's
  operating day reconciles normally.
- Match truck, facility aliases, and operating date. A later same-day actual can
  replace an earlier visit. For repeated visits to the same named facility,
  verified manual actuals consume GPS assumptions one-for-one, ordered by the
  closest transaction-to-visit interval. Transaction time selects among same-day
  visits but does not block replacement because manual entry and GPS event clocks
  can differ.
  Extra GPS visits remain assumed; extra verified actuals remain actual source
  records and never cause an assumption to be counted again. When a manual row
  has no facility, it consumes the closest same-truck, same-day dump assumption;
  the missing source location remains visible in provenance.
- Source rows that remain possible duplicates or have receipt-ownership conflicts
  require review and cannot replace assumptions. No amount-based guess is made.
- A visit genuinely spanning midnight can match an actual on its departure day
  (within a maximum 36-hour visit). Other-day expenses do not silently attach to
  an old open visit. They need an explicit source association.
- Replacing an assumed cost retains the visit identity and unload timestamp. A
  later expense cannot create a second unload or erase later pickups. An existing
  OpsBot expense unload is suppressed in the load read projection only when its
  completed message transaction explicitly matches the actual and that actual
  matches this visit. Unrelated manual unloads remain untouched.
- A verified, unambiguous JunkWare dump expense with no matching facility visit
  still resets that truck's projected load once at the expense transaction time.
  Existing same-truck completion receipts before that time are covered; later
  pickups remain onboard. Duplicate or ownership-conflicted expenses require
  review and cannot reset load.

## Two trucks at the same facility

Each physical truck keeps its own visit, unload and assumed cost. Equal costs,
site and transaction time across different trucks never identify one expense.
Different receipt numbers preserve both actual costs. Repeated actuals and visits
reconcile one-for-one within their own truck; they never consume another truck's
assumption. The same nonblank receipt recorded on different trucks at the same facility
and operating date is an ownership conflict; actual and combined totals remain
unavailable until receipt or crew evidence resolves it. GPS co-location alone
cannot identify a swapped receipt assignment, so source truck ownership is never
automatically reassigned.

## Repeated market views and facility names

JunkWare can show the complete truck expense table under multiple markets while
its summary allocates the cost between markets. Operational views collapse those
copies only when complete row identities and amounts agree, each market has one
copy per identity, and verified market allocation totals sum to the full truck
table total within one cent. That narrow tolerance covers source allocation
rounding only; larger differences remain unresolved. The known `--` marker means zero allocation; arbitrary missing
text does not. This proof applies separately to dump and fuel rows. Same-market
repeated rows and mismatched/correcting snapshots stay available for review.
Potential duplicate expenses make the actual and combined dump totals unavailable,
so duplicate rows cannot inflate a headline total.

Original expense IDs, market IDs and raw location spelling are retained as
provenance. Command merges the original event fingerprints into one operational
card. Raw expense collection and Slack notification identities remain unchanged.
The observed exact spellings `Gentillt` and `Gentility` display as **Gentilly** and match the
Gentilly visit; there is no general fuzzy facility matching or source edit.

## Presentation and authority

Command displays an **Assumed dump expense** card until a qualifying actual
replaces it. Finance's **Dump Expenses** section displays the same records and
actual, assumed and combined operational totals. The existing Finance refresh reconciles the projection, and the two local
[operational agents](operational-agents.md) also run while the UI is closed.
This adds no provider polling or external requests.
Actual source expense notifications keep their existing behavior; assumptions
send no new messages.

When assumed costs remain, Disposal costs displays `Combined*` with the note
`* Combined includes assumed costs alongside recorded actual costs.` Actual-only
totals have no asterisk. Unresolved totals remain unavailable; the marker never
overrides reconciliation or implies a verified final total.

The projection lives in `lib/unload-cost-agent.ts` and `lib/dump-expenses.ts`,
derived on read from retained LinxUp and verified JunkWare history. OpsCenter
includes the still-assumed amount in the selected day's disposal expense, total
costs and Net. A matching manual actual replaces that assumption, so the amount
never stacks. The projection does not write assumptions into JunkWare or QBO.
The stable entry identity survives reloads and actual replacement. There is no
timer or stored estimate that can duplicate during a process restart.

The source defaults can be overridden with protected runtime configuration at
`data/config/dump-minimum-fees.json`: `effectiveFrom` (YYYY-MM-DD), optional
`defaultMinimumFee`, and `facilities` containing `name`, `aliases` and
`minimumFee`. Amounts must be nonnegative dollar values with at most two decimal
places; aliases must be unique. An invalid override shows settings unavailable
instead of silently using a different fee. Keep private runtime data out of Git.

Reviewed exact pairs may be stored separately in protected runtime configuration
at `data/config/dump-expense-confirmations.json`. Each record
contains the operating `date`, exact `expenseId`, exact `visitId`, `confirmedAt`,
`confirmedBy`, and a nonblank evidence `note`. Malformed or duplicate-expense
records fail closed. Exact confirmations take precedence over automatic
one-for-one ordering without weakening truck, facility or operating-day checks.

Validation: `npm run verify:dump-expenses`, `npm run verify:geofence-alerts`,
truck expense notification checks, TypeScript, desktop build and production build.
