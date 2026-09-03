import { useEffect, useRef, useState } from "react";
import { Button } from "./components/ui/button";
import type { MoveProposal, ScheduleAppointment } from "./lib/schedule-contract";
import {
  assignmentNeedsVerification,
  scheduleMoveWindow,
  truckLabel,
  isClosed,
} from "./lib/schedule-contract";

export type { MoveProposal } from "./lib/schedule-contract";
type Receipt = {
  requestId: string;
  status: "pending" | "verified" | "failed" | "uncertain";
  message: string;
};
export async function sendScheduleChange(
  job: ScheduleAppointment,
  date: string,
  action: string,
  values: Record<string, unknown>,
  requestId: string,
) {
  const response = await fetch("/api/desktop/schedule/operations", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      requestId,
      date,
      recordId: job.recordId,
      expectedVersion: job.version,
      action,
      values,
    }),
    signal: AbortSignal.timeout(150_000),
  });
  const body = await response.json();
  if (!body.receipt) {
    if ([400, 401, 403, 404, 409, 422].includes(response.status))
      return {
        requestId,
        status: "failed",
        message: body.error || "The appointment change was rejected.",
      } as Receipt;
    throw new Error(body.error || "The appointment result could not be confirmed.");
  }
  return body.receipt as Receipt;
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
            {receipt.status === "verified"
              ? "Change Verified"
              : receipt.status === "failed"
                ? "Change Not Applied"
                : "Verification Required"}
          </span>
          <strong>{receipt.message}</strong>
        </div>
      </header>
      {(receipt.status === "pending" || receipt.status === "uncertain") && (
        <footer>
          <small>Do not repeat an unverified change.</small>
          <Button variant="outline" size="sm" onClick={onCheck}>
            Check Saved Result
          </Button>
        </footer>
      )}
    </section>
  );
}
export async function checkScheduleChange(requestId: string) {
  const response = await fetch(
    `/api/desktop/schedule/operations?requestId=${encodeURIComponent(requestId)}`,
    { credentials: "same-origin", cache: "no-store" },
  );
  const body = await response.json();
  if (!response.ok || !body.receipt)
    throw new Error(body.error || "The saved result is unavailable.");
  return body.receipt as Receipt;
}
export function MoveConfirmation({
  move,
  date,
  cancel,
  saved,
  onBusyChange,
}: {
  move: MoveProposal;
  date: string;
  cancel: () => void;
  saved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [requestId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus({ preventScroll: true });
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const window = scheduleMoveWindow(move.job, move.start);
  const confirm = async () => {
    if (busy || receipt) return;
    setBusy(true);
    setError("");
    try {
      const result = await sendScheduleChange(
        move.job,
        date,
        "move",
        {
          truck: move.truck === "Unassigned" ? "" : move.truck,
          ...(window.changed
            ? { appointmentStartMinutes: move.start, durationHours: window.durationHours }
            : {}),
        },
        requestId,
      );
      setReceipt(result);
      if (result.status === "verified") saved();
    } catch (failure) {
      setReceipt({
        requestId,
        status: "uncertain",
        message: failure instanceof Error ? failure.message : "The source result is uncertain.",
      });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section
      className={`schedule-move-confirmation${move.conflicts.length ? " has-conflict" : ""}`}
      role="dialog"
      aria-label="Confirm schedule move"
      onKeyDownCapture={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) cancel();
        }
      }}
    >
      <header>
        <div>
          <span>{move.conflicts.length ? "Schedule Conflict" : "Confirm Move"}</span>
          <strong>
            {move.job.jkNumber} · {move.job.customerName}
          </strong>
        </div>
        <button
          ref={cancelButton}
          aria-label="Cancel schedule move"
          disabled={busy}
          onClick={cancel}
        >
          ×
        </button>
      </header>
      <div className="schedule-move-path">
        <span>
          <b>From</b>
          {truckLabel(move.job.truck)} · {move.job.appointmentTime}
        </span>
        <span>→</span>
        <span>
          <b>To</b>
          {move.truck} · {window.label}
        </span>
      </div>
      {move.conflicts.length > 0 && (
        <p>Overlaps {move.conflicts.join(", ")}. Verify the route before confirming.</p>
      )}
      {!window.supported && (
        <p>
          This appointment has a non-hourly window. Keep its time unchanged to reassign the truck;
          JunkWare’s current editor requires hourly time slots.
        </p>
      )}
      <p>
        This changes the appointment in JunkWare. Customer and Krewe communications remain separate.
      </p>
      {receipt ? (
        <ChangeReceipt
          receipt={receipt}
          onCheck={() => {
            void checkScheduleChange(requestId)
              .then((value) => {
                setReceipt(value);
                if (value.status === "verified") saved();
              })
              .catch((failure) => setError(failure.message));
          }}
        />
      ) : (
        <footer>
          <Button variant="outline" size="sm" disabled={busy} onClick={cancel}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={busy || !window.supported || assignmentNeedsVerification(move.job)}
            onClick={() => {
              void confirm();
            }}
          >
            {busy
              ? "Verifying in JunkWare…"
              : move.conflicts.length
                ? "Move Anyway"
                : "Confirm Move"}
          </Button>
        </footer>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

export default function ScheduleControls({
  job,
  date,
  trucks,
  onMove,
  saved,
  onBusyChange,
}: {
  job: ScheduleAppointment;
  date: string;
  trucks: string[];
  onMove: (move: MoveProposal) => void;
  saved: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [truck, setTruck] = useState(truckLabel(job.truck));
  const [start, setStart] = useState(
    job.appointmentStartMinutes === null ? "" : String(job.appointmentStartMinutes),
  );
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const run = async (action: string, values: Record<string, unknown>) => {
    if (busy || (receipt && receipt.status !== "verified" && receipt.status !== "failed")) return;
    const requestId = crypto.randomUUID();
    setBusy(true);
    setError("");
    setReceipt(null);
    try {
      const result = await sendScheduleChange(job, date, action, values, requestId);
      setReceipt(result);
      if (result.status === "verified") {
        if (action === "note") setNote("");
        setConfirmCancel(false);
        saved();
      }
    } catch (failure) {
      setReceipt({
        requestId,
        status: "uncertain",
        message:
          failure instanceof Error ? failure.message : "The source result could not be confirmed.",
      });
    } finally {
      setBusy(false);
    }
  };
  const blocked =
    busy || Boolean(receipt && (receipt.status === "pending" || receipt.status === "uncertain"));
  const unchangedAssignment =
    truck === truckLabel(job.truck) &&
    (start === "" || Number(start) === job.appointmentStartMinutes);
  return (
    <section className="drawer-dispatch-controls">
      <div className="drawer-control-heading">
        <span>Dispatch Controls</span>
        <strong>Update the Live Plan</strong>
        <small>Changes are verified in JunkWare. Call-ahead is recorded in OpsCenter.</small>
      </div>
      {assignmentNeedsVerification(job) && (
        <p className="drawer-action-feedback" role="status">
          Assignment Not Verified in JunkWare. Check the source before another move.
        </p>
      )}
      {!isClosed(job) && (
        <>
          <div className="drawer-control-fields">
            <label>
              <span>Truck Assignment</span>
              <select
                value={truck}
                onChange={(event) => setTruck(event.target.value)}
                disabled={blocked || assignmentNeedsVerification(job)}
              >
                {[...new Set([...trucks, truckLabel(job.truck), "Unassigned"])].map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Appointment Window</span>
              <select
                value={start}
                onChange={(event) => setStart(event.target.value)}
                disabled={blocked || assignmentNeedsVerification(job)}
              >
                {job.appointmentStartMinutes !== null &&
                  (job.appointmentStartMinutes % 60 !== 0 ||
                    job.appointmentStartMinutes < 420 ||
                    job.appointmentStartMinutes > 1080) && (
                    <option value={job.appointmentStartMinutes}>{job.appointmentTime}</option>
                  )}
                <option value="">Keep Current Time</option>
                {Array.from({ length: 12 }, (_, index) => (index + 7) * 60).map((value) => (
                  <option key={value} value={value}>
                    {scheduleMoveWindow(job, value).label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="drawer-quick-actions">
            <Button
              variant="outline"
              disabled={blocked || unchangedAssignment || assignmentNeedsVerification(job)}
              onClick={() =>
                onMove({ job, truck, start: start === "" ? null : Number(start), conflicts: [] })
              }
            >
              Review Assignment Change
            </Button>
            <Button
              variant="outline"
              disabled={blocked}
              onClick={() => {
                void run("call_ahead", { called: job.callAhead !== "called" });
              }}
            >
              {job.callAhead === "called" ? "Clear Call Ahead" : "Mark Call Ahead"}
            </Button>
          </div>
        </>
      )}
      <div className="drawer-note-row">
        <label className="drawer-cancel-field">
          <span>Add Appointment Note</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={2000}
            disabled={blocked}
          />
        </label>
        <Button
          className="drawer-cancel-action"
          variant="outline"
          disabled={blocked || !note.trim()}
          onClick={() => {
            void run("note", { note });
          }}
        >
          Save Note in JunkWare
        </Button>
      </div>
      {!isClosed(job) && (
        <div className="drawer-cancel-row">
          <label className="drawer-cancel-field">
            <span>Cancellation Reason</span>
            <input
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setConfirmCancel(false);
              }}
              maxLength={500}
              placeholder="Required to record a cancellation"
              disabled={blocked}
            />
          </label>
          <Button
            className="drawer-cancel-action"
            variant="outline"
            disabled={blocked || !reason.trim()}
            onClick={() => setConfirmCancel(true)}
          >
            Record Cancellation
          </Button>
          {confirmCancel && (
            <div className="drawer-cancel-confirmation" role="alert">
              <p>
                Cancel {job.jkNumber} in JunkWare? This removes the appointment from the active
                plan.
              </p>
              <div className="drawer-quick-actions">
                <Button
                  variant="outline"
                  disabled={blocked}
                  onClick={() => setConfirmCancel(false)}
                >
                  Keep Appointment
                </Button>
                <Button
                  disabled={blocked || !reason.trim()}
                  onClick={() => {
                    void run("cancel", { reason });
                  }}
                >
                  {busy ? "Verifying…" : "Confirm Cancellation"}
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
      {receipt && (
        <ChangeReceipt
          receipt={receipt}
          onCheck={() => {
            void checkScheduleChange(receipt.requestId)
              .then((value) => {
                setReceipt(value);
                if (value.status === "verified") saved();
              })
              .catch((failure) => setError(failure.message));
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
