# Capital financial hub

Capital opens with month-to-date operational revenue, costs, estimated profit and
average job value. A six-calendar-month revenue chart keeps missing months as gaps
and marks partial reporting periods. No cash balance or bank forecast is inferred
from job revenue. The day-at-a-glance cards retain per-metric source freshness.

Payments, Expenses, Accounting, Resale, Recycling and Trends are separate views.
Their `financeView` URL keys support direct links. Expenses contains disposal,
fuel reconciliation and posted WEX purchases. Accounting retains QuickBooks and
accountant statement source selectors, reporting cutoffs and existing refresh.
The overview links to these workflows and highlights missing cost coverage,
unverified card payments, unpaid recycling records and inventory needing listing.
A clear queue does not mark a daily close complete.

The redesign changes presentation only. Existing data collection cadence,
financial source precedence, payment verification, mutation receipt handling and
spending limits remain unchanged. Revenue, operational profit, processor payment
verification and accounting income remain separate.

Design reference: Mobbin QuickBooks business overview and Monarch cash-flow
hierarchy. Figma's tools were unavailable in this session; no Figma file was created.

All seven Capital views share the same green summary cards, page hierarchy,
source panels and responsive controls. Payments adds tender/verification filters
and job/customer/reference search. Resale adds status filters and inventory
cards. Payment rows become labeled cards on phones. Accounting, recycling and
trends retain their period/source selectors and detailed evidence disclosures.
The selected-day operational summary is a collapsed panel below specialist views.

The local `desktop-ui/tests/capital-hub.html` fixture uses synthetic records for
all-tab visual review, payment and resale filters, source switching and mobile
layouts. It replaces fetch locally and never contacts a financial provider.

Capital follows the shared OpsCenter density scale: 8px section gaps, 68px
minimum summary cards, 20px metric values and compact rows. Source labels may
grow a card when needed, so smaller spacing never clips freshness evidence.
