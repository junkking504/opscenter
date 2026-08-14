"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type AppointmentCancelTarget = {
  date: string;
  appointmentId: string;
  jobKey: string;
  jkNumber: string;
  customerName: string;
  appointmentTime: string;
};

export default function AppointmentCancelDialog({
  target,
  onClose,
  onCanceled,
}: {
  target: AppointmentCancelTarget | null;
  onClose: () => void;
  onCanceled: (target: AppointmentCancelTarget) => void;
}) {
  const keepButton = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!target) return;
    setError("");
    setSaving(false);
    const frame = window.requestAnimationFrame(() => keepButton.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [target]);

  useEffect(() => {
    if (!target) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !saving) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, saving, target]);

  if (!target || typeof document === "undefined") return null;

  async function cancelAppointment() {
    const appointment = target;
    if (saving || !appointment) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/job-cancellation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(appointment),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok || !payload?.junkwareSynced) {
        throw new Error(payload?.error || "The appointment could not be canceled.");
      }
      onCanceled(appointment);
      onClose();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : "The appointment could not be canceled.");
    } finally {
      setSaving(false);
    }
  }

  return createPortal(
    <div
      className="ops-appointment-cancel-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !saving) onClose();
      }}
    >
      <section
        className="ops-appointment-cancel-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ops-appointment-cancel-title"
        aria-describedby="ops-appointment-cancel-description"
      >
        <div className="ops-appointment-cancel-icon" aria-hidden="true">×</div>
        <div className="ops-appointment-cancel-copy">
          <span>Cancel appointment</span>
          <h2 id="ops-appointment-cancel-title">Cancel {target.jkNumber || "this appointment"}?</h2>
          <p id="ops-appointment-cancel-description">
            {target.customerName || "Customer"}{target.appointmentTime ? ` · ${target.appointmentTime}` : ""}
          </p>
          <strong>This changes the appointment to Cancelled in JunkWare.</strong>
        </div>
        {error ? <div className="ops-appointment-cancel-error" role="alert">{error}</div> : null}
        <div className="ops-appointment-cancel-actions">
          <button ref={keepButton} type="button" disabled={saving} onClick={onClose}>Keep appointment</button>
          <button
            type="button"
            className="is-destructive"
            disabled={saving}
            onClick={() => void cancelAppointment()}
          >
            {saving ? "Canceling in JunkWare…" : "Cancel appointment"}
          </button>
        </div>
      </section>
    </div>,
    document.body,
  );
}
