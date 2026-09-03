"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { TruckLoadEvent, TruckLoadResetLocation, TruckLoadStatus } from "@/lib/truck-load-status";
import styles from "@/components/TruckLoadStatusPanel.module.css";

const STARTING_LOAD_OPTIONS = [
  [0, "Empty"],
  [1 / 12, "Minimum / 1/12"],
  [1 / 8, "1/8 full"],
  [1 / 6, "1/6 full"],
  [1 / 4, "1/4 full"],
  [1 / 3, "1/3 full"],
  [3 / 8, "3/8 full"],
  [1 / 2, "1/2 full"],
  [5 / 8, "5/8 full"],
  [2 / 3, "2/3 full"],
  [3 / 4, "3/4 full"],
  [7 / 8, "7/8 full"],
  [1, "Full truck"],
] as const;

function eventLabel(event: TruckLoadEvent | null): string {
  if (!event) return "No load activity recorded";
  if (event.kind === "day_start") return `Day started at ${event.loadSize || "Empty"}`;
  if (event.kind === "yard_reset") return event.resetLocation === "metal_yard" ? "Emptied at metal yard" : "Emptied at dump";
  if (event.kind === "manual_snapshot") return `OpsBot status · ${event.loadSize || "load recorded"}`;
  const job = event.jobNumber || (event.appointmentId ? `Appointment ${event.appointmentId}` : "Job closeout");
  return `${job} · ${event.loadSize || "load recorded"}`;
}

function timeLabel(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export default function TruckLoadStatusPanel({
  date,
  initialStatuses,
}: {
  date: string;
  initialStatuses: TruckLoadStatus[];
}) {
  const router = useRouter();
  const [statuses, setStatuses] = useState(initialStatuses);
  const [savingTruck, setSavingTruck] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => setStatuses(initialStatuses), [initialStatuses]);

  function replaceStatus(status: TruckLoadStatus) {
    setStatuses((current) => current.map((candidate) => candidate.truck === status.truck ? status : candidate));
  }

  async function updateStatus(payload: Record<string, unknown>, successMessage: string) {
    const truck = String(payload.truck || "");
    setSavingTruck(truck);
    setMessage("");
    try {
      const response = await fetch("/api/truck-load-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, date }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.status) throw new Error(result?.error || "The truck load status could not be saved.");
      replaceStatus(result.status as TruckLoadStatus);
      setMessage(successMessage);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The truck load status could not be saved.");
    } finally {
      setSavingTruck("");
    }
  }

  function setStartingLoad(truck: string, loadFraction: string) {
    void updateStatus({ action: "set_start", truck, loadFraction: Number(loadFraction) }, `${truck} starting load saved.`);
  }

  function resetLoad(truck: string, location: TruckLoadResetLocation) {
    const label = location === "metal_yard" ? "metal yard" : "dump";
    void updateStatus({ action: "reset", truck, location }, `${truck} reset to Empty at the ${label}.`);
  }

  return (
    <section className={styles.panel} aria-labelledby="truck-load-status-title">
      <div className={styles.heading}>
        <div>
          <strong id="truck-load-status-title">Truck Load Status</strong>
          <span>Set the morning load once. Job closeouts add their load automatically; dump and metal-yard runs reset it.</span>
        </div>
        {message ? <output className={styles.message} aria-live="polite">{message}</output> : null}
      </div>

      <div className={styles.grid}>
        {statuses.map((status) => {
          const saving = savingTruck === status.truck;
          const meterWidth = `${Math.max(0, Math.min(100, status.capacityPercent))}%`;
          return (
            <article className={`${styles.truck}${status.isOverCapacity ? ` ${styles.overCapacity}` : ""}`} key={status.truck} aria-busy={saving}>
              <div className={styles.current}>
                <div>
                  <strong>{status.truck}</strong>
                  <span>{status.currentLoadLabel}</span>
                </div>
                <b>{status.capacityPercent}%</b>
              </div>
              <div className={styles.meter} aria-label={`${status.truck} is ${status.capacityPercent}% full`}>
                <i style={{ width: meterWidth }} />
              </div>
              <details className={styles.controls}>
                <summary>Update load</summary>
                <div className={styles.controlPopover}>
                  <div className={styles.latest}>
                    <span>{eventLabel(status.lastEvent)}</span>
                    {status.lastEvent?.occurredAt ? <time dateTime={status.lastEvent.occurredAt}>{timeLabel(status.lastEvent.occurredAt)}</time> : null}
                  </div>
                  {status.currentContents ? <p className={styles.contents}>{status.currentContents}</p> : null}
                  <label className={styles.startingLoad}>
                    <span>Start-of-day load</span>
                    <select
                      value={String(status.startingLoadFraction)}
                      onChange={(event) => setStartingLoad(status.truck, event.target.value)}
                      disabled={saving}
                    >
                      {STARTING_LOAD_OPTIONS.map(([value, label]) => <option value={String(value)} key={label}>{label}</option>)}
                    </select>
                  </label>
                  <div className={styles.actions}>
                    <button type="button" onClick={() => resetLoad(status.truck, "dump")} disabled={saving}>Dumped</button>
                    <button type="button" onClick={() => resetLoad(status.truck, "metal_yard")} disabled={saving}>Metal yard</button>
                  </div>
                </div>
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
