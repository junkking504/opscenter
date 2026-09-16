# Source-aware daily publication

The OpsBot refresh collects and validates JunkWare before calculating daily
metrics. A failure in LinxUp daily, location, or alert collection is recorded by
the existing collector-health helper and no longer aborts revenue publication.
Timesheet-rate failure also leaves revenue publishable while payroll remains
stale or unavailable. No TLS verification or provider cadence is changed here.

## Dependencies

| Metric | Required evidence |
| --- | --- |
| Total revenue, completed-job counts, market revenue, average completed job | Verified dated JunkWare completed capture and matching completed CSV |
| Collected/billed revenue and tips | Completed capture's payment classification and tip fields; these are JunkWare classifications, not Merchant Center settlement or QBO accounting |
| Payroll and labor | Completed assignments (revenue credit, bonus and tips), employee clock capture, verified timesheet hourly rates; open shifts stop at employee capture time |
| Recorded dump, fuel and other operating expenses | Dated JunkWare Truck Records CSV |
| Royalties and estimated card fees | Revenue with existing fixed calculation policy; estimates are not accounting transactions |
| Costs and net profit | Revenue, payroll, and recorded Truck Records expenses; no GPS dependency for aggregate totals |
| Truck revenue and truck profit attribution | Completed capture plus retained GPS location/appointment-visit attribution; stale GPS can leave attribution provisional even when aggregate revenue is current |
| Mileage, drive/idle time and driver scores | Separate LinxUp summary, location and alerts; driver attribution also needs JunkWare assignments and employee hours |
| QBO payment matches | Separate QBO summary and JunkWare invoice identifiers; never inferred fresh from a new daily publication |

The application can supplement recorded expenses with its WEX/dump ledgers;
their timestamps and source precedence are owned by the application read model.
The processor does not claim those independent ledger inputs are fresh.

## JSON contract

`generated_at` and `source_freshness.published_at` identify processing time only.
`source_freshness.version` is `1`. `sources` has `junkware_completed`,
`junkware_employees`, `junkware_truck_records`, `junkware_rates`,
`linxup_summary`, `linxup_location`, `linxup_alerts`, and `qbo`. `metrics` has
`revenue`, `payroll`, `operating_costs`, `costs`, `net`, `gps`, and
`truck_revenue`.

Each entry has `status` (`current`, `stale`, or `missing`), `as_of` (ISO source
time or null), and an optional `reason`. Metric entries also list `dependencies`.
An aggregate's timestamp is the oldest required timestamp; an unknown required
timestamp stays null. A failed collector cannot advance the last good timestamp.
Today, observations older than ten minutes are stale; consumers must keep aging
them after publication. Historical records do not expire just through wall-clock
aging, but explicit source failures and missing inputs remain visible.

JunkWare source time is the minimum of its verified raw `scraped_at` and the
particular CSV's existing file time. Payroll rate time comes only from the rate
rows required by the final hourly payroll roster. An unused former employee's
retained rate cannot block today's payroll. Every required rate must match its
dated employee evidence, amount, verified-current status and valid timestamp;
missing, fallback, old or future evidence still blocks current payroll. Salary
and empty payrolls require no hourly rates. Per-record payroll cutoffs are updated
to the same final source timestamp. LinxUp uses its source capture timestamp. Unknown rate/GPS
capture times are never replaced by publication time. QBO's existing summary
file time is a local source-file observation, not a processor refresh claim.

The guard requires all four verified territory IDs and a matching date, capture
timestamp, completed IDs/count/revenue, and valid numeric amounts. It checks
JunkWare inputs again before publication to reject concurrent mixed captures.
Each metrics file is replaced atomically. A verified empty completed capture is
a genuine zero; missing, corrupt, mismatched, or failed JunkWare cannot fabricate
one. This intentionally rejects legacy captures without verification metadata.

## Installing the narrow runtime changes

OpsBot source remains outside application Git. The reviewed installer patches
known anchors in `run_opscenter_refresh.sh` and `process_daily_metrics.py`, and
installs `source_aware_metrics.py` beside the processor. It refuses unknown
source shapes before changing any file and is idempotent.

```sh
python3 scripts/test-source-aware-metrics.py --opsbot-root /Users/missioncontrol/.openclaw/workspace/opsbot
python3 scripts/install-source-aware-metrics.py
# Acquire the existing OpsBot tmp/opscenter_refresh.lock directory between runs.
# Then install the committed source and release the lock in a finally/trap.
python3 scripts/install-source-aware-metrics.py --apply
```

The tests use synthetic records and mocked providers, including the actual
refresh shell and processor against temporary inputs. They verify GPS failure,
failed/missing/mismatched JunkWare, real zero, retained cost timestamps,
concurrent source changes, and the employee open-shift cutoff. Installation does
not submit business writes, send messages, or restart other services.
