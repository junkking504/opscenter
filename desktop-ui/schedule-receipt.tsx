import './schedule-controls.css';
import type { ScheduleAppointment } from "./lib/schedule-contract";
import { submitScheduleOperation } from "./lib/schedule-operation-transport";

export type Receipt = {
  dryRun?: boolean;
  action?: 'move' | 'reschedule' | 'restore' | 'call_ahead' | 'cancel' | 'note' | 'closeout' | 'classify';
  crewAssignment?: {state:'pending'|'assigned'|'queued'|'attention';message:string};
  sourceResult?: Record<string, unknown>;
  requestId: string;
  status: "pending" | "verified" | "failed" | "uncertain" | "reconciled";
  message: string;
};
export async function sendScheduleChange(
  job: Pick<ScheduleAppointment,'recordId'|'version'>,
  date: string,
  action: string,
  values: Record<string, unknown>,
  requestId: string,
) {
  return submitScheduleOperation({
      requestId,
      date,
      recordId: job.recordId,
      expectedVersion: job.version,
      action,
      values,
  });
}
export function ChangeReceipt({ receipt, onCheck }: { receipt: Receipt; onCheck: () => void }) {
  return (
    <section
      className={`schedule-change-receipt sync-${receipt.status === "verified" ? "verified" : "uncertain"}`}
      role="status"
    >
      <header>
        <div>
          <span>
            {receipt.dryRun ? "Dry run complete" : receipt.status === "reconciled" ? "Current Schedule Verified" : receipt.status === "verified"
              ? "Change Verified"
              : receipt.status === "failed"
                ? "Change Not Applied"
                : "Verification Required"}
          </span>
          <strong>{receipt.message}</strong>
        </div>
      </header>
      {receipt.crewAssignment && <p>{receipt.crewAssignment.message}</p>}
      {receipt.crewAssignment?.state === 'attention' && <a href="/crew-dispatch">Open Crew Dispatch</a>}
      {(receipt.status === "pending" || receipt.status === "uncertain") && (
        <footer>
          <small>Do not repeat an unverified change.</small>
          <button type="button" className="ops-button" onClick={onCheck}>
            Check Saved Result
          </button>
        </footer>
      )}
    </section>
  );
}
export async function checkScheduleChange(requestId: string) {
  const response = await fetch(
    `/api/desktop/schedule/operations?requestId=${encodeURIComponent(requestId)}&reconcile=1`,
    { credentials: "same-origin", cache: "no-store", signal: AbortSignal.timeout(210_000) },
  );
  const body = await response.json();
  if (!response.ok || !body.receipt)
    throw new Error(body.error || "The saved result is unavailable.");
  return body.receipt as Receipt;
}
