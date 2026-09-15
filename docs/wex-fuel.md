# WEX fleet fuel

OpsCenter reads posted WEX fuel-card transactions from the CSV export in the
authenticated WEXOnline portal. The portal feed is an interim source while WEX
reviews the request for Fleet Management API credentials.

## Source boundary

- Only the **POSTED** transaction export is imported. Pending and declined
  authorizations are excluded because a single purchase can have more than one
  authorization stage.
- WEX `Trans ID` is the stable identity. Reimporting the same export is
  idempotent, and conflicting rows with the same ID fail closed.
- WEX purchases appear beside Finance costs. They are not added to the published
  JunkWare expense totals, because that could count the same fuel twice.
- The UI shows the import time and the latest transaction date covered by the
  export. A saved snapshot is not represented as a fresh portal read.

## Import

From a source checkout:

```sh
npm run import:wex-fuel -- ~/Downloads/Transactions.csv
```

The protected runtime snapshot is written to
`~/.openclaw/workspace/opsbot/data/integrations/wex-fuel/posted-transactions.json`
with mode `0600`. Set `WEX_FUEL_DATA_DIR` to use another directory or pass an
explicit output file as the second argument.

## Sign-in

The WEX tab uses the dedicated Chrome `OpsCenter` profile. Keep that browser
profile and tab open to retain WEX's session cookie. WEX controls session expiry
and can require 2FA again; OpsCenter must stop refresh and request sign-in when
that happens. It must never report the prior snapshot as a fresh portal read.

## API migration

WEX's Fleet Management API uses provider-issued credentials. Before enabling
requests, confirm WEX's fees and rate limits, then obtain explicit approval for
the provider, purpose, request cap, and maximum spend under
[spending controls](spending-controls.md). The API collector should write the
same snapshot schema so Finance does not need a second source model.
