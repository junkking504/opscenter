import { truckDisplayText } from '../lib/junkware-trucks';
import { useEffect, useRef, useState } from "react";
import './schedule-controls.css';
import { Button } from "./components/ui/button";
import type { MoveProposal, ScheduleAppointment } from "./lib/schedule-contract";
import {
  assignmentNeedsVerification,
  scheduleDisplayTruck,
  scheduleTruckMismatch,
  scheduleMoveWindow,
  truckLabel,
  isClosed,
} from "./lib/schedule-contract";

export type { MoveProposal } from "./lib/schedule-contract";
import { sendScheduleChange, checkScheduleChange, ChangeReceipt, type Receipt } from './schedule-receipt';
export { sendScheduleChange, checkScheduleChange, ChangeReceipt, type Receipt } from './schedule-receipt';
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
  const savedRef = useRef(saved);
  savedRef.current = saved;
  useEffect(() => {
    if (receipt?.status === 'verified' && !receipt.crewAssignment) savedRef.current();
  }, [receipt?.status, receipt?.crewAssignment]);
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
  useEffect(() => {
    if (!receipt || !['pending', 'uncertain'].includes(receipt.status)) return;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const response = await fetch(`/api/desktop/schedule/operations?requestId=${encodeURIComponent(receipt.requestId)}`, {credentials:'same-origin', cache:'no-store', signal:AbortSignal.any([abort.signal, AbortSignal.timeout(15_000)])});
        const body = await response.json();
        if (!abort.signal.aborted && response.ok && body.receipt) setReceipt(body.receipt);
      } catch { /* Keep the existing receipt; never repeat the submission. */ }
      if (!abort.signal.aborted) timer = setTimeout(poll, 5_000);
    };
    timer = setTimeout(poll, 5_000);
    return () => { abort.abort(); clearTimeout(timer); };
  }, [receipt?.requestId, receipt?.status]);
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
      className="schedule-move-confirmation"
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
          <span>Confirm Move</span>
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
          {truckDisplayText(truckLabel(move.job.truck))} · {move.job.appointmentTime}
        </span>
        <span>→</span>
        <span>
          <b>To</b>
          {truckDisplayText(move.truck)} · {window.label}
        </span>
      </div>
      {move.conflicts.length > 0 && (
        <p>Also booked in this window: {move.conflicts.join(", ")}. Multiple jobs can share a truck’s appointment window. Use Stop Order to set their sequence.</p>
      )}
      {!window.supported && (
        <p>
          This appointment has a non-hourly window. Keep its time unchanged to reassign the truck;
          JunkWare’s current editor requires hourly time slots.
        </p>
      )}
      <p>
        {/complete|closed/i.test(move.job.status)
          ? "This changes the completed appointment in JunkWare. Its recorded GPS visit, completion status, and closeout evidence stay unchanged."
          : /^confirmed$/i.test(move.job.status) && move.truck !== "Unassigned"
          ? "This assigns the appointment to the truck in JunkWare. Release it separately in Crew Dispatch for Waypoint. The phone uses the truck selected in its daily setup."
          : "This changes the appointment in JunkWare."}
      </p>
      {receipt ? (
        <ChangeReceipt
          receipt={receipt}
          onCheck={() => {
            if (busy) return;
            setBusy(true);
            void checkScheduleChange(receipt.requestId)
              .then((value) => {
                setReceipt(value);
              })
              .catch((failure) => setError(failure.message))
              .finally(() => setBusy(false));
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
            {busy ? "Verifying in JunkWare…" : "Confirm Move"}
          </Button>
        </footer>
      )}
      {error && <p role="alert">{error}</p>}
      {(receipt?.status === 'verified' || receipt?.status === 'reconciled' || receipt?.sourceResult?.assignmentReconciled === true) && <Button variant="outline" disabled={busy} onClick={saved}>Review Current Schedule</Button>}
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
  const [truck, setTruck] = useState(scheduleDisplayTruck(job));
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
    if (busy || (receipt && !['verified','failed','reconciled'].includes(receipt.status))) return;
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
        <strong>Add Appointment Note</strong>
        <small>Notes are saved to this appointment in JunkWare.</small>
      </div>
      <div className="drawer-note-row">
        <label className="drawer-cancel-field">
          <span>Add Appointment Note</span>
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={2000} disabled={blocked} />
        </label>
        <Button className="drawer-cancel-action" variant="outline" disabled={blocked || !note.trim()} onClick={() => { void run("note", { note }); }}>Save Note in JunkWare</Button>
      </div>
      <details className="drawer-secondary-controls">
      <summary>Assignment &amp; call-ahead</summary>
      <small>Assignment changes are verified in JunkWare. Call-ahead is recorded in OpsCenter.</small>
      {assignmentNeedsVerification(job) && (
        <p className="drawer-action-feedback" role="status">
          Assignment Not Verified in JunkWare. Check the source before another move.
        </p>
      )}
      {scheduleTruckMismatch(job) && (
        <p className="drawer-action-feedback" role="status">
          GPS confirms {truckDisplayText(scheduleTruckMismatch(job)!.gpsTruck)} visited this completed appointment. JunkWare still says {truckDisplayText(scheduleTruckMismatch(job)!.junkwareTruck)}; review the prefilled correction below.
        </p>
      )}
      {!/cancel/i.test(job.status) && (
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
                  <option key={value} value={value}>{truckDisplayText(value)}</option>
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
            {!isClosed(job) && <Button
              variant="outline"
              disabled={blocked}
              onClick={() => {
                void run("call_ahead", { called: job.callAhead !== "called" });
              }}
            >
              {job.callAhead === "called" ? "Clear Call Ahead" : "Mark Call Ahead"}
            </Button>}
          </div>
        </>
      )}
      </details>
      {!isClosed(job) && (
        <section className="drawer-cancel-row" id="appointment-cancellation" aria-label="Cancel Appointment">
          <h3>Cancel Appointment</h3>
          <p>Record the reason, then confirm cancellation in JunkWare.</p>
          <label className="drawer-cancel-field">
            <span>Cancellation Reason</span>
            <input
              id="appointment-cancellation-reason"
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
            Review Cancellation
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
        </section>
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
