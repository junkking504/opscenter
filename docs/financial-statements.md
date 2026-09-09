# Accounting financial statements

The desktop Finance overview displays imported accountant P&L statements above
operational month-to-date metrics. Accounting figures never replace JunkWare
job revenue, card-payment reconciliation, payroll, or estimated operating costs.
Access uses the existing `finance.read` permission on `/api/desktop/finance`.

## Import

Run `python3 scripts/import-financial-statements.py /absolute/path/report.xlsx`
to review recognized months and warnings. Add `--apply` to preserve the original
and normalized data under `~/Library/Application Support/OpsCenter/financial-statements`.
The importer uses the Python standard library, reads saved numeric results,
and never executes workbook formulas or embedded instructions. A required total
without a numeric cached result blocks import. Workbooks remain unchanged.

Supported exports have a `P&L` sheet, company/title in A1/A2, explicit monthly
amount headers in rows 5 or 6, account labels in column A, and the standard
`Total for` income, COGS, expense and other-income totals through `Net Income`.
Combined-period totals and percentage columns are not monthly amounts.

`OPSCENTER_FINANCIAL_STATEMENTS_DIR` can select a separate runtime directory for
validation. Never store real imports, financial exports, or source values in Git.
Source IDs use SHA256 of the original file. Re-imports update the same source;
revised workbooks remain separately inspectable. Prefer the comparative column
from the later reporting period for an overlapping month; display that choice
and allow inspection of each version. Same-period revisions require explicit
source review; do not treat lexical filename order as accountant approval.

The view preserves draft/unreviewed status, unknown accounting bases, negative
balances, zero versus missing values, source-cell references and annotations.
Supplemental manager-bonus calculations never become company net income.
The importer checks reported total relationships and income detail, preserving
the source totals with a visible warning if they disagree. It does not establish
that every underlying account or formula has been audited.

Full YTD requires every month from January through the selected month, one
company and a consistent explicitly stated basis. Missing months or unknown/
mixed bases leave YTD unavailable. Monthly tables retain reported amounts with
draft labels and do not invent prior-year comparisons.

## QuickBooks

The existing Accounting OAuth client now also supports an explicit, read-only
P&L collection through the Reports API. After verifying the app is on Intuit's
no-charge Builder tier, load the existing protected QBO configuration and run:

```sh
node --import tsx scripts/collect-qbo-financial-statements.ts --through YYYY-MM-DD --company 'Exact connected company name'
```

The same operation is available through **Refresh QuickBooks reports** in the
Finance overview. The same-origin POST endpoint requires `finance.read` and
always requests today's Chicago date, independent of the displayed historical
month. A private filesystem lock serializes refreshes, and a persisted successful
refresh receipt prevents repeated requests for 15 minutes. A crashed lock must
be reviewed against its recorded owner PID before removal. Failed API reads
preserve the last report snapshots and leave a visible refresh error.

An uncached refresh makes one company-identity request and two report requests, each with a
bounded timeout and the existing single authentication retry. It requests
accrual P&Ls grouped by month for January through the specified day, plus the
same prior-year period. Partial months retain exact end dates. No polling,
LaunchAgent, automation or accounting write is installed. Recheck the Intuit
tier before subsequent collections; do not upgrade the account or allow paid
overages. See [Spending controls](spending-controls.md).

The normalized source ID is stable by company, year, environment and basis.
Raw report snapshots are preserved separately by content SHA256. The Finance
source selector keeps QBO reports and accountant drafts separate and defaults
to QBO when available. Current books are explicitly not a reviewed close; a
complete period's API coverage does not establish bookkeeping completeness.
Matching YTD comparisons require matching report cutoffs. Balance-sheet and
cash-flow reports are not collected by this P&L workflow.

## Verification

- `python3 scripts/test-financial-statement-import.py`
- `node --import tsx scripts/test-financial-statements.ts`
- `node --import tsx scripts/test-qbo-financial-statements.ts`
- Desktop TypeScript, application TypeScript, lint, production build, and the
  authenticated Finance month/version/detail controls.
