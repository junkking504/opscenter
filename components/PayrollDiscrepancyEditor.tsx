"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { calculateLivePay } from "@/lib/live-pay";
import type { PayrollCorrection } from "@/lib/payroll-corrections";
import LivePayrollValue, { type LivePayrollRecord } from "@/components/LivePayrollValue";

type SourcePayrollValues = {
  clockIn: string;
  clockOut: string;
  hourlyRate: number | null;
  rateStatus?: string;
};

function clockToInput(value: string): string {
  return String(value || "").trim();
}

function inputToClock(value: string): string {
  const raw = String(value || "").trim().toUpperCase().replace(/\s+/g, " ");
  const twelveHour = raw.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/);
  if (twelveHour) {
    const hour = Number(twelveHour[1]);
    const minute = Number(twelveHour[2]);
    if (hour < 1 || hour > 12 || minute > 59) return "";
    return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${twelveHour[3]}`;
  }

  const match = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return "";
  const hour24 = Number(match[1]);
  const minute = Number(match[2]);
  if (hour24 > 23 || minute > 59) return "";
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${String(hour12).padStart(2, "0")}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "Unavailable";
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function displayClock(value: string, emptyValue: string): string {
  return String(value || "").trim() || emptyValue;
}

export default function PayrollDiscrepancyEditor({
  date,
  employeeName,
  record,
  source,
  correction,
  display = "earnings",
}: {
  date: string;
  employeeName: string;
  record: LivePayrollRecord;
  source: SourcePayrollValues;
  correction: PayrollCorrection | null;
  display?: "earnings" | "time";
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [clockIn, setClockIn] = useState(() => clockToInput(correction?.clockIn || source.clockIn));
  const [clockOut, setClockOut] = useState(() => clockToInput(correction?.clockOut || source.clockOut));
  const [hourlyRate, setHourlyRate] = useState(() => String(correction?.hourlyRate ?? source.hourlyRate ?? ""));
  const [note, setNote] = useState(() => correction?.note || "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setClockIn(clockToInput(correction?.clockIn || source.clockIn));
    setClockOut(clockToInput(correction?.clockOut || source.clockOut));
    setHourlyRate(String(correction?.hourlyRate ?? source.hourlyRate ?? ""));
    setNote(correction?.note || "");
    setMessage("");
  }, [
    correction?.clockIn,
    correction?.clockOut,
    correction?.hourlyRate,
    correction?.note,
    correction?.updatedAt,
    source.clockIn,
    source.clockOut,
    source.hourlyRate,
  ]);

  const pay = useMemo(() => calculateLivePay({
    date,
    clockIn: record.clockIn,
    clockOut: record.clockOut,
    hourlyRate: record.hourlyRate,
    totalBonus: record.totalBonus,
    isSalary: record.isSalary,
    weeklyHoursBeforeShift: record.weeklyHoursBeforeShift,
  }), [date, record]);

  const triggerLabel = correction
    ? "Corrected time · Edit"
    : pay.valid ? "Edit time" : `${pay.message || "Time unavailable"} · Edit time`;

  async function saveCorrection() {
    const rate = Number(hourlyRate);
    const normalizedClockIn = inputToClock(clockIn);
    const normalizedClockOut = inputToClock(clockOut);
    if (!normalizedClockIn || (clockOut && !normalizedClockOut) || !Number.isFinite(rate) || rate <= 0 || !note.trim()) {
      setMessage("Use a valid time such as 7:30 AM, plus an hourly rate and correction reason.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/payroll-corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeName,
          workDate: date,
          clockIn: normalizedClockIn,
          clockOut: normalizedClockOut,
          hourlyRate: rate,
          note: note.trim(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to save correction."));
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save correction.");
    } finally {
      setSaving(false);
    }
  }

  async function removeCorrection() {
    if (!correction) return;
    setSaving(true);
    setMessage("");
    try {
      const query = new URLSearchParams({ date, employee: employeeName });
      const response = await fetch(`/api/payroll-corrections?${query.toString()}`, { method: "DELETE" });
      if (!response.ok) throw new Error("Unable to remove correction.");
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove correction.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-payroll-review">
      {display === "earnings" ? (
        <LivePayrollValue date={date} records={[record]} field="earnings" showIncompleteNote={false} />
      ) : null}
      <button
        type="button"
        className={`ops-payroll-review-trigger ${display === "time" ? "is-time-action" : ""} ${correction ? "is-corrected" : pay.valid ? "" : "is-warning"}`}
        onClick={() => dialogRef.current?.showModal()}
      >
        {triggerLabel}
      </button>

      <dialog ref={dialogRef} className="ops-payroll-review-dialog">
        <div className="ops-payroll-review-dialog-header">
          <div>
            <div className="ops-payroll-review-eyebrow">Krewe time</div>
            <h2>{employeeName}</h2>
            <p>{date}</p>
          </div>
          <form method="dialog">
            <button type="submit" className="ops-payroll-review-close" aria-label="Close payroll correction">×</button>
          </form>
        </div>

        <div className={`ops-payroll-review-status ${pay.valid ? "is-corrected" : "is-warning"}`}>
          <strong>{correction ? "Time correction applied" : pay.valid ? "JunkWare time available" : pay.message}</strong>
          <span>
            {correction
              ? "The corrected clock times below are being used for this employee’s attendance and pay calculations."
              : pay.valid
                ? "OpsCenter is using the current JunkWare clock times shown below. You can override them when a punch is missed or incorrect."
                : "OpsCenter cannot calculate attendance or hourly earnings until the missing or invalid shift value is corrected."}
          </span>
        </div>

        <section className="ops-payroll-review-section">
          <h3>JunkWare source</h3>
          <div className="ops-payroll-source-grid">
            <div><span>Clock in</span><strong>{displayClock(source.clockIn, "Unavailable")}</strong></div>
            <div><span>Clock out</span><strong>{displayClock(source.clockOut, source.clockIn ? "On shift" : "Unavailable")}</strong></div>
            <div>
              <span>Hourly rate</span>
              <strong>{money(source.hourlyRate)}</strong>
              {source.rateStatus ? <small>{source.rateStatus.replaceAll("_", " ")}</small> : null}
            </div>
          </div>
          {!source.clockIn ? (
            <p className="ops-payroll-source-explanation">
              This employee has work credited today, but the JunkWare employee clock export has no matching shift row.
            </p>
          ) : null}
        </section>

        <section className="ops-payroll-review-section">
          <h3>{correction ? "Edit correction" : "Add correction"}</h3>
          <div className="ops-payroll-correction-grid">
            <label>
              <span>Clock in</span>
              <input
                type="text"
                inputMode="text"
                value={clockIn}
                onChange={(event) => setClockIn(event.target.value)}
                placeholder="7:30 AM"
              />
            </label>
            <label>
              <span>Clock out</span>
              <input
                type="text"
                inputMode="text"
                value={clockOut}
                onChange={(event) => setClockOut(event.target.value)}
                placeholder="Optional"
              />
              <small>Leave blank if still on shift.</small>
            </label>
            <label>
              <span>Hourly rate</span>
              <input
                type="number"
                min="0.01"
                step="0.01"
                inputMode="decimal"
                value={hourlyRate}
                onChange={(event) => setHourlyRate(event.target.value)}
              />
            </label>
            <label className="ops-payroll-correction-reason">
              <span>Correction reason</span>
              <input
                type="text"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Missing punch confirmed with employee..."
              />
            </label>
          </div>
          {correction ? (
            <p className="ops-payroll-correction-audit">
              Last edited {new Date(correction.updatedAt).toLocaleString()} by {correction.updatedBy || "OpsCenter user"}.
            </p>
          ) : null}
        </section>

        <div className="ops-payroll-review-actions">
          <button type="button" className="ops-refresh-button" disabled={saving} onClick={saveCorrection}>
            {saving ? "Saving…" : "Save time"}
          </button>
          {correction ? (
            <button type="button" className="ops-button ops-payroll-correction-remove" disabled={saving} onClick={removeCorrection}>
              Remove correction
            </button>
          ) : null}
        </div>
        <div className="ops-payroll-review-message" aria-live="polite">{message}</div>
      </dialog>
    </div>
  );
}
