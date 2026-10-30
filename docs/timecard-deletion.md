# Manager time-entry deletion

Krewe's day editor offers **Delete time entry…**. The manager loads the current
JunkWare source entry, reviews the employee, date, clock-in/out and rate, and
explicitly confirms deletion. This affects the source timesheet and payroll;
normal product recovery has not been verified, so the confirmation warns that
it may be permanent. The retained audit is evidence, not an Undo feature.

## Supported source scope

The current integration supports one unambiguous same-day entry per employee.
Multiple shifts, ambiguous franchises, missing clock-in and overnight entries stop before submission
and must be handled in JunkWare. A source read is not inferred from a cached
OpsCenter payroll row.

JunkWare exposes positional WebForms row/control identifiers. They are never
stored as durable entry IDs. Each operation selects the exact employee/franchise
and work date afresh, reads the sole source entry, compares every saved field,
then opens that current row's native editor. Employee identity, date, both
clocks, explicit clock-out date and hourly rate are checked again before using
the editor's actual Delete postback. Changed or ambiguous entries fail closed.
No hidden application state is decoded and no control target is guessed.

## Authorization, audit and recovery

`/api/desktop/timecards` requires an authenticated manager/admin with
`sensitive.write`, including receipt reads. POST also uses the trusted-origin
check. Receipts are actor-bound; the client cannot submit a source before-image,
control ID, employee ID or arbitrary postback target. Source preview confirmation
expires after five minutes. Expiry prevents a stale destructive confirmation;
it does not expire an existing application login or notification authorization.

The worker shares the payroll employee lock with source corrections. Private
receipts under `OPSBOT_DATA_DIR/payroll_corrections/timecard-deletions` preserve
an immutable source before-image, employee/franchise identity, manager, captured
correction version and state history. `submittedAt` is persisted before the
single native postback. A submitted or uncertain request can only be read back;
checking its result cannot replay deletion. Success requires a fresh confirmed
employee/day read with no remaining entry. Missing source coverage, a changed
entry, navigation failure or uncertain absence never counts as success.

A verified source deletion disables the captured/older local correction override
without erasing its history. Old correction receipts cannot recreate the entry.
A replacement entry must first exist in JunkWare before a day correction can
edit it. This protects against a queued stale edit recreating a deleted shift.
Other dates and manual bonuses are unchanged.

Source deletion and cached payroll publication are separate. The UI reports
verified deletion and warns that saved totals may await normal synchronization;
it does not fake zero hours or hide raw snapshots. No collector, payroll refresh,
notification or background retry is started by the deletion handler.

## Validation

`npm run verify:junkware-payroll` includes synthetic deletion lifecycle and API
coverage. `npm run verify:timecard-delete:browser` tests mobile Chromium/WebKit
confirmation, cancellation, double-click suppression, lost/uncertain response
recovery, receipt identity, layout and native editor guards using local HTML
fixtures. All worker writes and source responses in these tests are mocked.
No real timecard is deleted to validate the feature. Actual handset interaction
and a real deletion outcome remain separate acceptance evidence.
