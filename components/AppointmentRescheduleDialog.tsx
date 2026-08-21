"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AppointmentRescheduleTarget = { appointmentId: string; jobKey: string; jkNumber: string; customerName: string; date: string; appointmentTime: string; appointmentStartMinutes: number };

function timeValue(minutes: number): string { return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:00`; }
function clockLabel(minutes: number): string { const hour = Math.floor(minutes / 60); return `${hour % 12 || 12}:00 ${hour >= 12 ? "PM" : "AM"}`; }

export default function AppointmentRescheduleDialog({ target, onClose, onRescheduled }: {
  target: AppointmentRescheduleTarget | null;
  onClose: () => void;
  onRescheduled: (result: { date: string; appointmentStartMinutes: number }) => void;
}) {
  const dateField = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!target) return;
    setDate(target.date); setTime(timeValue(target.appointmentStartMinutes)); setSaving(false); setError("");
    const frame = window.requestAnimationFrame(() => dateField.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [target]);
  useEffect(() => {
    if (!target) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !saving) onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving, target]);
  if (!target || typeof document === "undefined") return null;
  const appointment = target;
  const appointmentStartMinutes = /^\d{2}:00$/.test(time) ? Number(time.slice(0, 2)) * 60 : Number.NaN;
  const changed = date !== appointment.date || appointmentStartMinutes !== appointment.appointmentStartMinutes;
  async function rescheduleAppointment() {
    if (saving || !changed || !Number.isInteger(appointmentStartMinutes)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/job-reschedule", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ appointmentId: appointment.appointmentId, jobKey: appointment.jobKey, date, appointmentStartMinutes }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.junkwareSynced) throw new Error(payload?.error || "The appointment could not be rescheduled.");
      onRescheduled({ date, appointmentStartMinutes }); onClose();
    } catch (rescheduleError) {
      setError(rescheduleError instanceof Error ? rescheduleError.message : "The appointment could not be rescheduled.");
    } finally { setSaving(false); }
  }
  return createPortal(
    <div className="ops-appointment-reschedule-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose(); }}>
      <section className="ops-appointment-reschedule-dialog" role="dialog" aria-modal="true" aria-labelledby="ops-appointment-reschedule-title">
        <div className="ops-appointment-reschedule-icon" aria-hidden="true">↻</div>
        <div className="ops-appointment-reschedule-copy"><span>Reschedule appointment</span><h2 id="ops-appointment-reschedule-title">Reschedule {appointment.jkNumber || "this appointment"}?</h2><p>{appointment.customerName || "Customer"}{appointment.appointmentTime ? ` · Currently ${appointment.appointmentTime}` : ""}</p><strong>OpsCenter saves this in JunkWare, then reads it back to verify it.</strong></div>
        <div className="ops-appointment-reschedule-fields">
          <label><span>New date</span><input ref={dateField} type="date" value={date} disabled={saving} onChange={(event) => setDate(event.target.value)} /></label>
          <label><span>New start time</span><select value={time} disabled={saving} onChange={(event) => setTime(event.target.value)}>{Array.from({ length: 24 }, (_, hour) => <option value={`${String(hour).padStart(2, "0")}:00`} key={hour}>{clockLabel(hour * 60)}</option>)}</select></label>
        </div>
        {error ? <div className="ops-appointment-reschedule-error" role="alert">{error}</div> : null}
        <div className="ops-appointment-reschedule-actions"><button type="button" disabled={saving} onClick={onClose}>Keep appointment</button><button type="button" className="is-primary" disabled={saving || !changed || !date || !Number.isInteger(appointmentStartMinutes)} onClick={() => void rescheduleAppointment()}>{saving ? "Saving in JunkWare…" : "Reschedule appointment"}</button></div>
      </section>
    </div>, document.body,
  );
}
