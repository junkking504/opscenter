# Krewe My Pay portal

Krewe members sign in at `https://crew.junk-king.app` with the username already assigned to them in JunkWare. A shared temporary password is used only for the first sign-in. OpsCenter then requires the employee to create a personal password before `/my-pay` can load. The resulting signed Krewe session lasts up to 30 days.

The Krewe hostname exposes only the Krewe portal, legal pages, and support. Requests for management routes are redirected to Krewe login. `ops.junk-king.app` remains the management hostname.

## Authentication configuration

If `crew.junk-king.app` remains behind a Cloudflare Access application, its Krewe policy must bypass identity-provider verification. OpsCenter performs the Krewe authentication itself; an email one-time PIN must not appear before the username/password page.

Bind a dedicated Worker KV namespace as `CREW_CREDENTIALS`. Store these values as protected production/Worker secrets:

```text
OPS_CREW_ROSTER_JSON=[{"employee":"Example Employee","username":"junkware.username","active":true}]
OPS_CREW_TEMP_PASSWORD_HASH=<one-way hash of the shared temporary password>
OPS_CREW_SESSION_SECRET=<at least 32 characters of cryptographic random data>
```

Employee names must identify the same employee represented in `daily_metrics` payroll records, and usernames must match JunkWare exactly (comparison is case-insensitive). The roster is private payroll-access configuration; do not put the real roster, temporary password, hashes, or session secret in source control or client-side code. Removing or deactivating an employee in the roster invalidates that employee's existing Krewe session as well as future logins.

The shared temporary password is accepted only while that username has no personal credential in `CREW_CREDENTIALS`. Completing password setup stores a salted, server-peppered one-way hash and permanently disables the temporary password for that username. Personal passwords must be 10–128 characters and contain at least one letter and one number.

## Krewe performance views

The signed-in Krewe portal includes daily metrics for Krewe members with a recorded clock-in that day and a month-to-date Krewe leaderboard. Both share only jobs completed, revenue, average job size, and tips. Total pay, hourly rates, hours, bonus amounts, bonus-day counts, and other payroll details remain visible only to the signed-in employee in their private pay sections.

Schedule appointment notes in OpsCenter are appended to the appointment's **Other Notes** in JunkWare and are read back before the UI confirms success. The Krewe Portal does not provide job or appointment notes.

Each employee also has a personal performance summary with Day, Week, and Month views. Week means Monday through the current day, and Month means calendar month-to-date. Longer-range average job size and estimate close percentage are recalculated from the combined underlying jobs and estimates rather than averaged from daily percentages.

## Pay-period schedule

The portal uses two-week pay periods, with Week 1 and Week 2 each running Monday through Sunday. The schedule is anchored to Monday `2026-08-03`, matching the current OpsCenter Krewe-period implementation. If the authoritative schedule uses another pay-period start, set:

```text
OPS_PAY_PERIOD_ANCHOR=YYYY-MM-DD
```

The anchor must be the Monday that starts Week 1 of a pay period. Overtime is calculated independently in each Monday-through-Sunday workweek after 40 hours, at 1.5× the recorded hourly rate.

## Management time-card corrections

In desktop **Krewe → Pay Period**, open either weekly breakdown. Every day
has **Edit hours** and **Add bonus** for managers, including days with no source
shift. The editor identifies the employee and work date, loads fresh day-specific
values and write versions, and saves to that day rather than the period selector's
date. A missing shift can use an employee established elsewhere in the same pay
period; another day's clocks or rate are never copied into the blank record.

A time correction requires a clock-in, positive hourly rate, and reason. The
clock-out can remain open; unavailable historical hours remain flagged. A manual
bonus requires a positive amount and reason. Saved corrections include the
signed-in operator and timestamp; saved manual bonuses are read back in the day
editor. The weekly hours refresh after a verified save and the open week remains
in place. Published payroll can lag corrections and remains labeled separately.
Future days remain marked Upcoming until their operating date.

The editor pauses background refresh and uses the existing permission, stale
version, receipt, and duplicate-request protections. An uncertain result blocks
another save and retains its receipt ID for the browser session; use **Check
saved result** before another change. Time corrections write the clock-in, clock-out, and per-shift hourly rate to JunkWare. A successful UI receipt requires a fresh JunkWare read-back of every field. See [JunkWare write-through](junkware-write-through.md) for the source contract.

Desktop **Krewe → Today** includes only employees with a valid recorded clock-in
for the selected operating date, including completed shifts and saved missed-shift
corrections. Job attribution, revenue, or roster membership alone does not qualify.
Its totals use this same roster. An empty holiday shows no clocked-in crew; missing
source coverage remains a separate warning. The employee drawer retains its daily
manager controls. Period and monthly records remain available independently of
this attendance filter; payroll edits are accessible from the weekly breakdown.

The employee-facing **My Pay** portal remains read-only. Managers make payroll
corrections in Krewe, where the source value and correction audit are visible.

Corrections are durable operational state at
`OPSBOT_DATA_DIR/payroll_corrections/payroll_corrections.json`. The Mac/VPS
state sync treats this directory like the other operator-managed state, so a
correction made in either served runtime is read back by the other. Private
JunkWare synchronization receipts live under the same directory in
`junkware-sync/`. They retain the employee identity, before/after shift,
submission marker, and verification time without rewriting collected exports.

## Activation sequence

1. Create and bind the dedicated `CREW_CREDENTIALS` KV namespace.
2. Add the JunkWare username-to-employee roster and authentication secrets.
3. Set the Krewe Access application to bypass identity-provider verification.
4. Deploy OpsCenter with the `crew.junk-king.app` custom domain.
5. Confirm a wrong password is rejected and the shared temporary password redirects to `/set-password`.
6. Complete a controlled test user's setup and confirm the temporary password no longer works for that username.

### Corrected pay in desktop Krewe

Today and pay-period totals recalculate corrected hourly shifts using available
records earlier in the same workweek, including earlier OpsCenter corrections.
An earlier edit also updates overtime allocation for later days in that week.
Missing earlier hours or missing pay components remain unresolved instead of
being treated as zero. Salaried pay is not converted to hourly wages.

Unconfirmed calculated amounts are labeled as OpsCenter calculations. Once
verified, matching JunkWare hourly wages take precedence, including its rounding;
local tips and bonus components are not implicitly certified by a timesheet save. Clock-in, clock-out,
and the shift hourly rate are sent to JunkWare from both desktop editors and the
legacy payroll-correction API. JunkWare calculates its own regular/overtime pay;
OpsCenter does not submit a fabricated total or alter the employee profile wage.
The source verification status is shown beside corrected pay and in Clock Out
alerts. Manual bonuses have no field in the inspected JunkWare timesheet editor
and remain explicitly labeled as OpsCenter bonus records.

## Desktop payroll review

Krewe → Pay Period adds a payroll review table above the existing two-week and
per-day records. It uses the same daily earnings as the employee cards and the
same weekly hours allocation. Hourly pay includes the recorded overtime wages;
tips, bonuses and supplemental pay remain separate components. No deductions,
net-pay calculation or payroll-provider submission is introduced.

The pay-period response now carries its hours snapshot with the earnings, so the
review and cards use one server response rather than independently refreshed
hours and pay requests. Per-day evidence includes source observation time,
shift rate, correction notes/actor and JunkWare synchronization status, plus
manual bonus notes. Payroll role restrictions remain unchanged.

Flags identify missing sources, missing employee/time/pay records, unfinished
shifts, hour disagreements, component/total mismatches, negative pay and
unverified corrections. Unknown amounts remain unavailable, including in the
CSV. The zero-hour employee filter remains; excluded employees with recorded
pay are called out separately and block reviewed export.

Review checkboxes are available for completed periods with complete daily
sources and unflagged employees. Marks are local to the current screen session;
a change to the supporting record clears its mark. They are not payroll
approval records and do not change any source data. Failed refreshes disable
reviewed export. A draft export includes every listed employee and all flags;
a reviewed export includes only checked employees, and explicitly reports any
excluded unreviewed employees. Search/table filters do not change export scope.
Exports contain period dates, both weeks' hours, regular/OT hours, each earnings
component, total pay before deductions, review status, flags and retrieval time.
CSV text cells are escaped against formulas. Files are generated in the browser
and never stored in Git or posted to a payroll provider.

Verification: `npm run verify:payroll-review`; isolated browser fixture:
`desktop-ui/tests/payroll-review.html` (fictional records only).

### Email to operations managers

**Email reviewed report** opens the operator's mail application with the three
explicitly requested operations-manager recipients, period, reviewed employee
hours/earnings and source link filled in. The reviewer chooses the sending
mailbox and presses Send in that application. OpsCenter does not claim delivery
for that manually composed message. The report is in the message body; the CSV can
be exported separately if an attachment is needed. Partial employee selections
are identified in the subject and body. Oversized messages are rejected with
instructions to use the CSV instead. The separate [scheduled payroll delivery](payroll-report-delivery.md) sends the
full report with flags at 8 a.m. Central on the Monday after each biweekly
period ends. It uses the existing Mail account through the Codex schedule.
No test report is sent to the real recipients.
