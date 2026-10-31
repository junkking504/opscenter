import { truckDisplayText } from '../lib/junkware-trucks';
import { useEffect, useRef, useState } from "react";
import './schedule-controls.css';
import { Button } from "@astryxdesign/core/Button";
import { BrandTheme } from "../components/astryx/BrandTheme";
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
export default function ScheduleControls({
  job,
  date,
  trucks,
  onMove,
  saved,
  onBusyChange,
  mode = "all",
}: {
  mode?: "all" | "details" | "cancel";
  job: ScheduleAppointment;
  date: string;
  trucks: string[];
  onMove: (move: MoveProposal) => void;
  saved: (action?: string) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [truck, setTruck] = useState(scheduleDisplayTruck(job));
  const [start, setStart] = useState(
    job.appointmentStartMinutes === null ? "" : String(job.appointmentStartMinutes),
  );
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [confirmCancel, setConfirmCancel] = useState(false);
  const cancelReviewRef = useRef<HTMLDivElement>(null);
  const cancelReasonRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (mode === 'details') { setConfirmCancel(false); return; }
    if (!confirmCancel) return;
    cancelReviewRef.current?.scrollIntoView({ block: 'end', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    cancelReviewRef.current?.focus({ preventScroll: true });
  }, [confirmCancel, mode]);
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
        saved(action);
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
  const assignmentWindow = scheduleMoveWindow(job, start === "" ? null : Number(start));
  return (
    <BrandTheme><section className="drawer-dispatch-controls">
      <div hidden={mode === "cancel"}>
      <div className="drawer-control-heading">
        <strong>Add Appointment Note</strong>
        <small>Notes are saved to this appointment in JunkWare. Up to 500 characters.</small>
      </div>
      <div className="drawer-note-row">
        <label className="drawer-cancel-field">
          <span>Add Appointment Note</span>
          <textarea value={note} onChange={event => setNote(event.target.value)} maxLength={500} disabled={blocked} />
        </label>
        <Button label="Save Note in JunkWare" className="drawer-cancel-action" variant="secondary" isDisabled={blocked || !note.trim()} onClick={() => { void run("note", { note }); }} />
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
            <Button label="Move Appointment"
              variant="secondary"
              isDisabled={blocked || unchangedAssignment || assignmentNeedsVerification(job) || !assignmentWindow.supported}
              onClick={() =>
                onMove({ job, truck, start: start === "" ? null : Number(start), conflicts: [] })
              }
             />
            {!isClosed(job) && <Button label={job.callAhead === "called" ? "Clear Call Ahead" : "Mark Call Ahead"}
              variant="secondary"
              isDisabled={blocked}
              onClick={() => {
                void run("call_ahead", { called: job.callAhead !== "called" });
              }}
            />}
          </div>
        </>
      )}
      </details>
      </div>
      {!isClosed(job) && (
        <section hidden={mode === "details"} className="drawer-cancel-row" id="appointment-cancellation" aria-label="Cancel Appointment">
          <h3>Cancel Appointment</h3>
          <p>Record the reason, then confirm cancellation in JunkWare.</p>
          <label className="drawer-cancel-field">
            <span>Cancellation Reason</span>
            <textarea
              ref={cancelReasonRef}
              rows={3}
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
          {!confirmCancel && <Button label="Review Cancellation"
            className="drawer-cancel-action"
            variant="secondary"
            isDisabled={blocked || !reason.trim()}
            onClick={() => setConfirmCancel(true)}
           />}
          {confirmCancel && (
            <div ref={cancelReviewRef} tabIndex={-1} className="drawer-cancel-confirmation" role="group" aria-label="Review cancellation">
              <strong>{job.jkNumber} · {job.customerName}</strong>
              <p className="drawer-cancel-reason-summary">{reason}</p>
              <p>
                Cancel {job.jkNumber} in JunkWare? This removes the appointment from the active
                plan.
              </p>
              <div className="drawer-quick-actions">
                <Button label="Keep Appointment"
                  variant="secondary"
                  isDisabled={blocked}
                  onClick={() => { setConfirmCancel(false); cancelReasonRef.current?.focus(); }}
                 />
                <Button label={busy ? "Verifying…" : "Confirm Cancellation"}
                  variant="destructive"
                  isDisabled={blocked || !reason.trim()}
                  onClick={() => {
                    void run("cancel", { reason });
                  }}
                />
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
                if (value.status === "verified") { if (value.action === "note") setNote(""); saved(value.action); }
              })
              .catch((failure) => setError(failure.message));
          }}
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section></BrandTheme>
  );
}
