import Link from "next/link";
import { money } from "@/lib/opsData";
import type { PaymentReconciliationView } from "@/lib/payment-reconciliation";
import { jobScheduleHref } from "@/lib/related-record-links";
import { stableUpdatedAt } from "@/lib/stable-date";

const QBO_STATUS_URL = "/integrations/qbo/status";
const JUNKWARE_URL = "https://junkware.junk-king.com/franchise/accounting/update-quickbooks.aspx";

function statusText(status: PaymentReconciliationView["status"]): string {
  if (status === "balanced") return "Reconciled";
  if (status === "needs_review") return "Needs review";
  if (status === "merchant_data_stale") return "Refreshing";
  if (status === "merchant_data_missing") return "QBO data needed";
  return "Not collected";
}

function statusClass(status: PaymentReconciliationView["status"]): string {
  if (status === "balanced") return "is-balanced";
  if (status === "needs_review") return "needs-review";
  if (status === "merchant_data_stale") return "data-stale";
  return "data-missing";
}

function amountOrDash(value: number | null): string {
  return value === null ? "—" : money(value);
}

export default function PaymentReconciliationPanel({
  view,
  periodLabel,
}: {
  view: PaymentReconciliationView;
  periodLabel: string;
}) {
  const { summary, coverage } = view;
  const coverageComplete = coverage.expectedDays > 0 && coverage.merchantDays === coverage.expectedDays;
  const merchantReady = view.merchantCenterAvailable && view.merchantCenterFresh;
  const showExceptions = merchantReady && view.exceptions.length > 0;
  const merchantRefreshLabel = view.merchantCenterCollectedAt
    ? stableUpdatedAt(view.merchantCenterCollectedAt)
    : "unknown";

  return (
    <div className="ops-card ops-payment-reconciliation-card">
      <div className="ops-card-header compact">
        <div>
          <div className="ops-section-title">Card Payment Reconciliation</div>
          <div className="ops-muted">
            JunkWare Accounting → Update QuickBooks compared with {view.merchantSourceName} for {periodLabel}.
          </div>
        </div>
        <span className={`ops-reconciliation-status ${statusClass(view.status)}`}>
          {statusText(view.status)}
        </span>
      </div>

      {view.status === "not_collected" || view.status === "merchant_data_missing" ? (
        <div className="ops-reconciliation-callout">
          <div>
            <strong>QuickBooks Online transactions have not been collected for this period.</strong>
            <span>
              OpsCenter will retry the API automatically. Check the encrypted OAuth connection if this message persists.
            </span>
          </div>
          <div className="ops-reconciliation-links">
            <Link href={QBO_STATUS_URL}>Check QBO connection</Link>
            <Link href={JUNKWARE_URL} target="_blank" rel="noreferrer">Open JunkWare ledger</Link>
          </div>
        </div>
      ) : null}

      {view.status === "merchant_data_stale" ? (
        <div className="ops-reconciliation-callout">
          <div>
            <strong>QuickBooks Online is refreshing.</strong>
            <span>
              The last transaction snapshot was collected {merchantRefreshLabel}. Differences and exceptions are hidden until a current snapshot is available.
            </span>
          </div>
        </div>
      ) : null}

      {coverage.expectedDays > 1 && !coverageComplete ? (
        <div className="ops-reconciliation-coverage">
          QBO coverage: {coverage.merchantDays} of {coverage.expectedDays} published days. Totals below include collected days only.
        </div>
      ) : null}

      <div className="ops-reconciliation-summary">
        <div><span>JunkWare card payments</span><strong>{money(summary.junkware_total)}</strong><small>{summary.junkware_count} paid totals</small></div>
        <div><span>QuickBooks Online</span><strong>{merchantReady ? money(summary.merchant_center_total) : "—"}</strong><small>{merchantReady ? `${summary.merchant_center_count} card transactions` : view.merchantCenterAvailable ? "Refreshing transactions" : "Awaiting API"}</small></div>
        <div><span>Matched</span><strong>{merchantReady ? money(summary.matched_total) : "—"}</strong><small>{merchantReady ? `${summary.matched_count} one-to-one matches` : "Not current"}</small></div>
        <div><span>Tips</span><strong>{merchantReady ? money(summary.tip_total) : "—"}</strong><small>Paid total minus job revenue</small></div>
        <div><span>Difference</span><strong className={merchantReady && Math.abs(summary.net_difference) > 0.01 ? "ops-reconciliation-difference" : ""}>{merchantReady ? money(summary.net_difference) : "—"}</strong><small>{merchantReady ? "QuickBooks Online minus JunkWare" : "Waiting for current feed"}</small></div>
        <div><span>Exceptions</span><strong>{merchantReady ? summary.exception_count : "—"}</strong><small>{merchantReady ? "Require review" : "Waiting for current feed"}</small></div>
        <div><span>Processing fees</span><strong>—</strong><small>Not included in QBO transaction queries</small></div>
      </div>

      {showExceptions ? (
        <div className="ops-reconciliation-exceptions">
          <div className="ops-card-header compact">
            <div>
              <div className="ops-section-title">Payment Exceptions</div>
              <div className="ops-muted">Unmatched or ambiguous transactions are never auto-cleared.</div>
            </div>
          </div>
          <div className="ops-finance-table-scroll">
            <table className="ops-table ops-payment-reconciliation-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Exception</th>
                  <th>Reference</th>
                  <th>Customer</th>
                  <th>Card</th>
                  <th>JunkWare</th>
                  <th>QuickBooks Online</th>
                </tr>
              </thead>
              <tbody>
                {view.exceptions.slice(0, 100).map((row, index) => (
                  <tr key={`${row.date}|${row.type}|${row.reference}|${index}`}>
                    <td>{row.date}</td>
                    <td><span className="ops-status-tag">{row.type}</span></td>
                    <td>
                      {row.junkwareAmount !== null && row.reference !== "—" ? (
                        <Link
                          className="ops-reconciliation-job-link"
                          href={jobScheduleHref(row.date, row.reference)}
                          title={`Open ${row.reference} on the OpsCenter schedule`}
                        >
                          {row.reference}
                        </Link>
                      ) : row.reference}
                    </td>
                    <td>{row.customer}</td>
                    <td>{row.cardLastFour ? `•••• ${row.cardLastFour}` : "—"}</td>
                    <td className="ops-money">{amountOrDash(row.junkwareAmount)}</td>
                    <td className="ops-money">{amountOrDash(row.merchantAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}
