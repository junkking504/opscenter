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

All seven Capital views share the same brand-red summary cards, page hierarchy,
source panels and responsive controls. Gold charts and neutral surfaces use the existing
OpsCenter palette. Payments adds tender/verification filters
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

## Reconciliation

Payments’ Reconcile Yesterday switch and the overview shortcut open the previous
calendar day in America/Chicago, including weekends. The review has its own
clearly labeled date picker, with a Yesterday reset and access to older days;
it does not change the global operating date. Payment sources and the native
QuickBooks register use the same review date. Register date fields are locked
to that date in this area. Changing the review date is blocked during source
loading, action confirmation/submission and payment evidence review.

Verify Payment records confirmation of selected cash, check or card payments
only in OpsCenter. The accountant records verification in QuickBooks separately. Billed work uses Update QuickBooks.
This reuses the existing cross-check, source evidence and durable accounting actions. Empty queues and missing sources never mark
a day reconciled. No automatic payment writes or new collectors are added.

Capital navigation uses the same separated, rounded buttons as Convoy: pale
backgrounds for available views, a brand-red selected view, and wrapping on
narrow screens so every label remains visible.


## Compact overview layout

Capital places its title and view tabs on a shared wrapping row. The overview
starts with the reporting month, compact Reconcile yesterday and Accounting
buttons, then the financial cards. Reconciliation keeps its previous-calendar-day
default and existing payment review flow.

The number-source strip appears directly beneath the cards, followed by source/payment status. Source details
expands the existing publication/retrieval timestamps and Refresh data control;
refresh failures remain visible even while details are collapsed. Card-level
freshness, incomplete-cost labels and unavailable values are preserved. Finance tabs use the shared 32 px control size; overview actions retain their existing touch sizing.

## Finance Navigation And Number Sources

Finance has seven visible tabs and sidebar destinations: Overview, Trends,
Payments, Expenses, Accounting, Resale and Recycling. Trends keeps its own
selected tab, including when opened from a metric tile. Reconciliation remains
a Payments subview with Recorded Payments and Reconcile Yesterday switches;
existing URL keys and role permissions are unchanged. Overview no longer
repeats the destination cards.

The strip beneath Overview’s four tiles explains operating revenue for the
month, recorded payments for the selected day, and QuickBooks income for the
selected month with its reporting cutoff and basis. It uses only loaded Finance
values. QuickBooks statements are selected per company using the existing
preference rule; totals combine only when their cutoff and basis agree. Missing
values or incompatible reporting periods read Unavailable in neutral gray.
Accountant workbooks and other months never substitute for QuickBooks income.

Trends displays only its trend reports and shared financial record details. Overview
keeps the monthly summary, source-number strip and operating panels; it no longer
embeds a second copy of the trend reports. Summary tile links open Trends directly.
