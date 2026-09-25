# Prediction intelligence

OpsCenter builds a protected, prediction-ready operating dataset from the
historical evidence it already collects. The first version is deliberately a
transparent baseline: it exposes source coverage, missing values, backtest
error, and the exact source used for each actual cost.

## Data grains

- **Daily business:** JunkWare revenue, jobs, estimates, payroll and recorded
  expenses; LinxUp miles and drive/idle time; SearchKings spend, traffic,
  conversions and calls; Podium review counts and ratings; QBO posted and
  matched payment totals; and WEX posted fuel purchases, gallons and unit cost.
- **Truck-day:** jobs, revenue, mileage, drive/idle time, recorded dump/fuel
  expenses, and WEX posted gallons and fuel cost.

Direct customer, employee, card, address, recording, and review-text
identifiers are excluded. The source records remain authoritative and stay in
protected runtime storage.

## Forecasts and signal map

The initial seven-day forecasts cover revenue, completed jobs, actual fuel
cost, WEX gallons, and recorded dump cost. They use a recency-weighted
same-weekday baseline, fall back to recent observed days, and publish mean
absolute error plus weighted absolute percentage error from a rolling
backtest. These are advisory planning ranges, not commitments.

Lagged relationships are calculated only with at least 21 overlapping observed
days. A correlation is an association to investigate, not proof that the
feature caused the outcome.

Dump assumptions never train the recorded-cost forecast. WEX is used only for
dates covered by a posted-transaction export; JunkWare recorded fuel is the
fallback outside that coverage. Missing sources remain null rather than
becoming zero.

## Build

```sh
OPSCENTER_DATA_DIR="$HOME/.openclaw/workspace/opsbot/data" npm run build:prediction-data
```

The protected output is
`data/prediction/daily-operating-features.json` with mode `0600`. Rebuilding is
atomic and does not alter any source record.
