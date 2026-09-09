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

The existing Accounting OAuth client reads company identity, card Payments and
SalesReceipts. It does not yet collect P&L, balance-sheet, or cash-flow reports.
QBO's Reports API can provide these using explicit date ranges and accounting
basis. Keep API reports separately sourced from accountant drafts, and compare
them before assigning precedence to adjustments. Do not silently overwrite a
reviewed statement when current books change.

Before enabling additional API request volume, verify the app's Intuit partner
tier and enforce the spending controls. No additional QBO polling or metered
feature is enabled by the workbook import. See [Spending controls](spending-controls.md)
and [QBO setup](qbo-intuit-production-setup.md).

## Verification

- `python3 scripts/test-financial-statement-import.py`
- `node --import tsx scripts/test-financial-statements.ts`
- Desktop TypeScript, application TypeScript, lint, production build, and the
  authenticated Finance month/version/detail controls.
