# SearchKings integration

OpsCenter treats SearchKings as the paid-marketing source and JunkWare as the booking and revenue source. The two systems are kept distinct:

- Platform conversions are reported exactly as SearchKings provides them.
- Qualified calls are SearchKings calls scored 3–5 by default.
- Matched bookings are qualified calls whose normalized phone number appears on a JunkWare appointment from the call date through seven days later.
- A completed JunkWare appointment is credited to its earliest qualifying matching call only, so duplicate calls cannot inflate bookings or revenue.
- Attributed revenue is limited to those matched appointments that JunkWare also identifies as completed. An estimate or scheduled match remains a booking signal, but its quoted amount is excluded from revenue and ROAS.
- A qualified call starts in **Needs follow-up** and becomes **Lost** after 72 hours without a match. Both thresholds are configurable.
- If a lost call later matches a JunkWare appointment, it is shown as **Recovered**.

Call recordings are not copied into OpsCenter. The snapshot contains call metadata, score, tags, and the SearchKings-generated summary, plus a secure link back to SearchKings.

## Collector setup

The collector runs on the Mac connector and publishes both a current snapshot and a monthly snapshot. Store the SearchKings sign-in in the macOS keychain so it is not written to the repository or deployment environment:

```sh
security add-generic-password -U -a opscenter -s opsbot-searchkings-username -w
security add-generic-password -U -a opscenter -s opsbot-searchkings-password -w
security add-generic-password -U -a opscenter -s opsbot-searchkings-firebase-api-key -w
```

With `-w` last, macOS prompts securely. Enter the SearchKings email, password,
and Firebase API key at the corresponding prompts; none of the values are
echoed or saved in shell history.

Run a first verified refresh:

```sh
npm run collect:searchkings -- --force
```

Install the dedicated production collector on Mission Control:

```sh
./deploy/macmini/install-searchkings-collector.sh
```

The LaunchAgent starts at login, checks every five minutes, and refreshes
SearchKings at most once every 15 minutes. It runs independently of JunkWare,
QBO, Krewe Portal, and VPS synchronization, so a failure in those integrations
does not make Marketing data stale. The general live refresh loop also retains
its SearchKings call as a redundant fallback. Both paths use the same lock and
freshness gate, and retain the last verified snapshot on authentication or
network failure.

## Files and retention

- `data/searchkings/current.json` — current month-to-date snapshot
- `data/history/searchkings/searchkings_YYYY-MM.json` — monthly snapshot
- `data/searchkings-overrides/lost-leads.json` — management outcomes and notes

The deployment sync treats `searchkings-overrides` as shared application state. It is pulled from the VPS before publishing new collector data so lead outcomes are not overwritten.

## Historical browsing

Marketing uses the selected `date` query parameter as a month selector and
reads the matching verified `searchkings_YYYY-MM.json` snapshot. Navigation
keeps that date when moving between Marketing sections and other operating
pages. The live `current.json` is a fallback only for the current calendar
month; OpsCenter never substitutes it for a missing historical month. A month
without a verified snapshot is shown as unavailable until it is backfilled.
