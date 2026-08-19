import fs from "node:fs";
import path from "node:path";
import {
  appointmentChannelId,
  buildAddOnSlackNotification,
  buildCancellationSlackNotification,
  formatSlackAlert,
  type SlackOpsAlert,
} from "@/lib/slack-alerts";
import type { AnyRecord } from "@/lib/opsData";

type Snapshot = {
  date: string;
  scrapedAt: string;
  appointments: AnyRecord[];
  cancelled: AnyRecord[];
};

type DetectorState = {
  version: 3;
  snapshots: Record<string, Snapshot | null>;
  delivered: string[];
  pendingCloseouts: Record<string, { date: string; row: AnyRecord }>;
};

export type ScheduleChange = {
  fingerprint: string;
  kind: "new_appointment" | "cancelled" | "rescheduled";
  alert: SlackOpsAlert;
};

export type PendingScheduleCloseout = {
  date: string;
  row: AnyRecord;
};

function clean(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function first(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = clean(row[key]);
    if (value) return value;
  }
  return "";
}

function identifier(row: AnyRecord): string {
  const appointmentId = first(row, ["appt_id", "appointment_id", "appointmentId"]);
  if (appointmentId) return `appt-${appointmentId}`;
  const jobNumber = first(row, ["job_id", "jk_number", "job_number"]);
  return jobNumber ? `job-${jobNumber.toLowerCase()}` : "";
}

function jobNumber(row: AnyRecord): string {
  return first(row, ["job_id", "jk_number", "job_number"]) || "Appointment";
}

function complete(row: AnyRecord): boolean {
  return first(row, ["final_status", "job_status", "status"]).toLowerCase().includes("complete");
}

function newlyCompletedRows(previous: Snapshot | null, current: Snapshot): AnyRecord[] {
  if (!previous) return [];
  const priorAppointments = rowMap(previous.appointments);
  return current.appointments.filter((row) => {
    const id = identifier(row);
    const prior = id ? priorAppointments.get(id) : null;
    return Boolean(id && prior && !complete(prior) && complete(row));
  });
}

function cancelled(row: AnyRecord): boolean {
  return first(row, ["final_status", "job_status", "status"]).toLowerCase().includes("cancel");
}

function scheduleShape(row: AnyRecord): string {
  return [
    first(row, ["appointment_time", "scheduled_time", "time_window"]),
    first(row, ["appointment_date", "date"]),
    first(row, ["truck", "assigned_truck", "truck_number"]),
    first(row, ["address", "service_address"]),
    first(row, ["market", "territory", "normalized_territory"]),
  ].join("|").toLowerCase();
}

function href(date: string, row: AnyRecord): string {
  return `/jobs?date=${encodeURIComponent(date)}#job-${jobNumber(row).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

function rescheduleAlert(date: string, previous: AnyRecord, current: AnyRecord): SlackOpsAlert {
  const oldTime = first(previous, ["appointment_time", "scheduled_time", "time_window"]) || "Unavailable";
  const newTime = first(current, ["appointment_time", "scheduled_time", "time_window"]) || "Unavailable";
  const truck = first(current, ["truck", "assigned_truck", "truck_number"]);
  return {
    fingerprint: "",
    kind: "add_on",
    lifecycle: "notification",
    severity: "warning",
    channelId: appointmentChannelId(first(current, ["normalized_territory", "territory", "source_territory", "market"])),
    title: `${jobNumber(current)} rescheduled`,
    detail: [`Previous: ${oldTime}`, `New: ${newTime}`, truck ? `Truck: ${truck}` : ""].filter(Boolean).join("\n"),
    nextAction: "Update the route plan.",
    href: href(date, current),
  };
}

function rowMap(rows: AnyRecord[]): Map<string, AnyRecord> {
  const result = new Map<string, AnyRecord>();
  for (const row of rows) {
    const key = identifier(row);
    if (key) result.set(key, row);
  }
  return result;
}

export function detectScheduleChanges(previous: Snapshot | null, current: Snapshot): ScheduleChange[] {
  if (!previous) return [];
  const priorAppointments = rowMap(previous.appointments);
  const priorCancelled = rowMap(previous.cancelled);
  const events: ScheduleChange[] = [];

  for (const row of current.appointments) {
    const id = identifier(row);
    if (!id) continue;
    const previousRow = priorAppointments.get(id);
    if (!previousRow) {
      if (complete(row)) continue;
      const alert = buildAddOnSlackNotification({
        id: `appt:${id}`,
        appointmentId: first(row, ["appt_id", "appointment_id", "appointmentId"]),
        jobNumber: jobNumber(row),
        territory: first(row, ["normalized_territory", "territory", "source_territory", "market"]),
        customerName: first(row, ["customer_name", "customer", "name"]),
        phone: first(row, ["phone", "customer_phone"]),
        address: first(row, ["address", "service_address"]),
        appointmentTime: first(row, ["appointment_time", "scheduled_time", "time_window"]),
        appointmentType: first(row, ["appointment_type", "type"]),
        assignedTruck: first(row, ["truck", "assigned_truck", "truck_number"]),
        items: [],
        href: href(current.date, row),
      }, current.date);
      events.push({ fingerprint: `new_appointment:${current.date}:${id}`, kind: "new_appointment", alert });
      continue;
    }
    if (!complete(row) && scheduleShape(previousRow) !== scheduleShape(row)) {
      events.push({ fingerprint: `rescheduled:${current.date}:${id}:${scheduleShape(row)}`, kind: "rescheduled", alert: rescheduleAlert(current.date, previousRow, row) });
    }
  }

  for (const row of current.cancelled) {
    const id = identifier(row);
    if (!id || priorCancelled.has(id)) continue;
    const alert = buildCancellationSlackNotification({
      id: `appt:${id}`,
      appointmentId: first(row, ["appt_id", "appointment_id", "appointmentId"]),
      jobNumber: jobNumber(row),
      territory: first(row, ["normalized_territory", "territory", "source_territory", "market"]),
      customerName: first(row, ["customer_name", "customer", "name"]),
      phone: first(row, ["phone", "customer_phone"]),
      address: first(row, ["address", "service_address"]),
      appointmentTime: first(row, ["appointment_time", "scheduled_time", "time_window"]),
      appointmentType: first(row, ["appointment_type", "type"]),
      assignedTruck: first(row, ["truck", "assigned_truck", "truck_number"]),
      items: [],
      href: href(current.date, row),
      cancelledBy: first(row, ["cancelled_by", "canceled_by"]),
      cancellationReason: first(row, ["cancellation_reason", "cancel_reason"]),
    }, current.date);
    events.push({ fingerprint: `cancelled:${current.date}:${id}`, kind: "cancelled", alert });
  }
  return events;
}

function stateFile(dataDir: string): string {
  return path.join(dataDir, "slack", "junkware_schedule_change_state.json");
}

function readState(dataDir: string): DetectorState {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile(dataDir), "utf8"));
    if ((value?.version === 2 || value?.version === 3) && value?.snapshots && typeof value.snapshots === "object") {
      return {
        version: 3,
        snapshots: value.snapshots,
        delivered: Array.isArray(value?.delivered) ? value.delivered.map(String).slice(-2_000) : [],
        pendingCloseouts: value?.pendingCloseouts && typeof value.pendingCloseouts === "object" ? value.pendingCloseouts : {},
      };
    }
    return {
      version: 3,
      snapshots: { legacy: value?.snapshot || null },
      delivered: Array.isArray(value?.delivered) ? value.delivered.map(String).slice(-2_000) : [],
      pendingCloseouts: {},
    };
  } catch {
    return { version: 3, snapshots: {}, delivered: [], pendingCloseouts: {} };
  }
}

function writeState(dataDir: string, state: DetectorState): void {
  const file = stateFile(dataDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

async function post(token: string, alert: SlackOpsAlert): Promise<boolean> {
  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ channel: alert.channelId, text: formatSlackAlert(alert), mrkdwn: true, unfurl_links: false, unfurl_media: false }),
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean };
  return Boolean(response.ok && payload.ok);
}

function normalizedScope(value: string | undefined): string {
  const scope = clean(value || "legacy").toLowerCase();
  if (!/^[a-z0-9_-]{1,80}$/.test(scope)) throw new Error("Invalid schedule detector scope.");
  return scope;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function withStateLock<T>(dataDir: string, callback: () => Promise<T>): Promise<T> {
  const lock = `${stateFile(dataDir)}.lock`;
  const deadline = Date.now() + 20_000;
  fs.mkdirSync(path.dirname(lock), { recursive: true });

  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > 120_000) fs.rmSync(lock, { recursive: true, force: true });
      } catch {
        // Another publisher may have released the lock between stat and removal.
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the schedule alert state lock.");
      await sleep(50);
    }
  }
  try {
    return await callback();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

export async function publishScheduleChanges(
  dataDir: string,
  snapshot: Snapshot,
  token: string,
  options: {
    scope?: string;
    resolveCloseout?: (closeout: PendingScheduleCloseout) => Promise<boolean>;
  } = {},
): Promise<{
  baselined: boolean;
  posted: ScheduleChange[];
  failed: ScheduleChange[];
  closeoutsResolved: number;
  closeoutFailures: string[];
}> {
  const scope = normalizedScope(options.scope);
  return withStateLock(dataDir, async () => {
    const state = readState(dataDir);
    const previous = state.snapshots[scope] || null;
    if (!previous) {
      writeState(dataDir, { ...state, snapshots: { ...state.snapshots, [scope]: snapshot } });
      return { baselined: true, posted: [], failed: [], closeoutsResolved: 0, closeoutFailures: [] };
    }
    const delivered = new Set(state.delivered);
    const posted: ScheduleChange[] = [];
    const failed: ScheduleChange[] = [];
    for (const event of detectScheduleChanges(previous, snapshot)) {
      if (delivered.has(event.fingerprint)) continue;
      if (await post(token, event.alert)) {
        delivered.add(event.fingerprint);
        posted.push(event);
      } else {
        failed.push(event);
      }
    }
    const pendingCloseouts = { ...state.pendingCloseouts };
    for (const row of newlyCompletedRows(previous, snapshot)) {
      const id = identifier(row);
      if (id) pendingCloseouts[`${scope}:${snapshot.date}:${id}`] = { date: snapshot.date, row };
    }
    let closeoutsResolved = 0;
    const closeoutFailures: string[] = [];
    if (options.resolveCloseout) {
      for (const [key, pending] of Object.entries(pendingCloseouts)) {
        if (!key.startsWith(`${scope}:`) || pending.date !== snapshot.date) continue;
        try {
          if (await options.resolveCloseout(pending)) {
            delete pendingCloseouts[key];
            closeoutsResolved += 1;
          }
        } catch (error) {
          closeoutFailures.push(error instanceof Error ? error.message : "The fast closeout check failed.");
        }
      }
    }
    writeState(dataDir, {
      version: 3,
      snapshots: { ...state.snapshots, [scope]: snapshot },
      delivered: Array.from(delivered).slice(-2_000),
      pendingCloseouts,
    });
    return { baselined: false, posted, failed, closeoutsResolved, closeoutFailures };
  });
}
