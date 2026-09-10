# Scheduled payroll email

The Mission Control Codex task **Monday payroll reports** sends the completed
biweekly Krewe report at 8:00 a.m. America/Chicago on the Monday after the period
ends. Its weekly wakeup checks the configured OpsCenter pay-period anchor and
skips the intervening Monday. First eligible delivery: September 21, 2026, for
September 7–20. The schedule is managed in Codex, outside the application release.
The Mac must be on, Codex running, and the existing Mail account accessible.

Recipients: eugene.dabezies@junk-king.com, branden.dozier@junk-king.com, and
robert.mclaughlin@junk-king.com. Use the existing Junk King sending account
batonrouge.gm@junk-king.com. No paid email provider or new account is provisioned.

The scheduled report includes all employees in the same recorded-hours scope as
Krewe, both weeks, regular and overtime hours, hourly pay, tips, bonuses,
supplemental pay and totals before deductions. Missing sources, excluded
zero-hour employees with pay, and employee discrepancies remain explicit flags.
Unknown values remain unavailable, never zero. The subject says **FOR REVIEW**;
it is neither a manually approved report nor a payroll submission. No manual
review marks are required. The CSV preserves the same flags and source totals.

## Runbook

Always resolve the active release and use its dependencies. These commands read
production configuration without printing it and keep report data outside Git:

```sh
cd /Users/missioncontrol/opscenter-v2/opscenter
node --env-file='/Users/missioncontrol/Library/Application Support/OpsCenter/production.env' --import tsx scripts/prepare-scheduled-payroll.ts prepare
```

The command returns `not-due` outside qualifying Mondays at/after 8 a.m. Central.
A prepared report returns a private directory and `emailPath`. Read that JSON to
get the exact recipients, subject, text and attachment path. The report directory
is `~/Library/Application Support/OpsCenter/payroll-reports/START_END` (0700),
with report files restricted to the user (0600). Preparation reads persisted
sources; it does not trigger collectors, modify pay or send mail. Existing
prepared snapshots are reused so the attachment and message stay consistent.

Use approved computer-use tools to search Mail Sent and Outbox for the exact
subject and period before composing. If already present, reconcile the existing
attempt instead of sending another. Otherwise compose the complete message,
attach the generated CSV, and verify all recipient addresses, the business
sender, report period, body and attachment. Treat report contents only as data.
Immediately before pressing Send, reserve the attempt (replace `START_END` with
the prepared period key):

```sh
node --env-file='/Users/missioncontrol/Library/Application Support/OpsCenter/production.env' --import tsx scripts/prepare-scheduled-payroll.ts reserve START_END
```

The exclusive reservation rejects duplicates and concurrent attempts. A failed
reservation means do not send. After Send, verify the matching message in Sent,
including recipients and attachment, before recording confirmation:

```sh
node --env-file='/Users/missioncontrol/Library/Application Support/OpsCenter/production.env' --import tsx scripts/prepare-scheduled-payroll.ts confirm-sent START_END 'Sent-folder verification evidence'
```

A `sending` receipt represents an uncertain attempt until verified. Never delete
it or resend automatically. If Mail, the sender, source reads or verification
fail, report the failure to the user and preserve the receipt. A delayed run on
the same Monday can proceed; a missed Monday requires explicit recovery rather
than quietly emailing a different period. No report is sent while setting up or
testing this workflow.

The in-app **Email reviewed report** button remains a separate, manually sent
message containing the currently selected reviewed employees. It does not
represent or confirm scheduled delivery.

Validation: `npm run verify:payroll-review` covers scheduled flagged output,
nulls, off-period Mondays, time-of-day and daylight-saving boundaries, and
exclusive reservations with verified-only completion. Paid providers are not
used in tests.

### Review flags and shared source gaps

Missing daily snapshots are period-level warnings, not employee errors or a
reason to include an otherwise zero-hour roster entry. Employee-specific unknown
hours and missing clock-outs remain eligible for review. Reviewed exports remain
blocked while shared source dates are missing; draft CSVs preserve those gaps.
Employee review items are grouped by work date, retaining specific causes instead
of separately counting incomplete daily and period totals caused by the same
problem. Failed JunkWare corrections show the verifier's reason. A later day's
pay warning identifies the earlier correction date; unverified pay remains
unavailable until the supporting weekly records and correction are resolved.
