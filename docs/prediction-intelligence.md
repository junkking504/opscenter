# Prediction intelligence

## Interactive graphs

Graphs live beside their operating workflows, with independent 30-, 90- and
365-day controls:

- Capital → Expenses: combined recorded dump/fuel, separate fuel sources,
  WEX gallons purchased, net cost per gallon and recorded dump costs.
- Capital → Trends: revenue, completed jobs, average job value and Net after
  recorded costs; existing monthly comparisons remain available.
- Capital → Accounting: comparable full-month statement income, total expenses
  and net income, filtered by existing company/source/basis controls. Cash flow
  is explicitly unavailable because the current import is P&L only.
- Campaign → Performance: SearchKings ad spend, calls, reported conversions
  and cost per tracked call (not verified customer acquisition cost).
- Campaign → Reviews: captured review counts and daily average ratings, with
  Podium's partial-history limitation.
- Convoy → Reports: miles and fuel purchase/cost history for all trucks or an
  individual truck. No fuel consumption or MPG is inferred from purchases.
- Command → Forecast: the combined jobs, revenue, fuel cost and dump-cost
  planning baselines. Forecasts do not clutter historical workflow pages.

Command metric cards navigate to the matching record workspace with a focused
trend and the selected day's card value. Today's jobs opens Control's active
schedule (including estimates, excluding cancellations), Revenue and Net open
Capital Trends, Labor opens Crew, and Dump + Fuel opens Capital Expenses.
The selected day is preserved. Current assumed costs are labeled; historical
assumptions are not reconstructed. Revenue precedence matches the Command card.

The existing finance API and read-only `/api/desktop/analytics` return aggregate
projections bounded to 365 days. Finance/forecast/labor require `finance.read`;
operations scopes use explicit field allowlists, without revenue, payroll or
financial forecasts. No new vendor requests or background polling are added.

Missing calendar days remain null gaps. Current partial actuals are excluded;
today's baseline is never replayed on historical selected dates. WEX and JunkWare
fuel expenses remain distinct, non-additive series. Net cost per gallon is total
WEX net cost divided by gallons (including any net-cost adjustments), not a pump
price average or measured consumption. The chart labels imported WEX coverage.
Forecast shading is historical 20th–80th percentile spread, not a calibrated
prediction interval. Daily values, rolling backtest error and method remain
inspectable beside the graphs. Existing monthly performance views are preserved.

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
