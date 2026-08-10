# OpsCenter v1

Local read-only operations dashboard for Junk King Operations.

## Data Source

OpsCenter reads one local file:

```text
../opsbot/data/processed/daily_metrics.json
```

It does not connect directly to Junkware, QuickBooks Online, LinxUp, databases, or live APIs.

## Start

```sh
cd opscenter
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Pages

- Dashboard
- Fleet
- Finance
- Jobs

## Notes

- Rule #1: OpsCenter must maintain current data. The collector refreshes at
  service startup, retries failed publishes after 15 seconds, and interrupts
  its normal wait as soon as network connectivity returns. Open current-data
  pages automatically advance when a newer daily snapshot is published;
  historical dates remain fixed only when an operator selects them explicitly.
- Missing data is handled with empty states.
- Dark mode follows the system color scheme.
- All data is read locally from `daily_metrics.json`.
