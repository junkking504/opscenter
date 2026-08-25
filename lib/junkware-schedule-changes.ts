import fs from "node:fs";
import path from "node:path";
import { appointmentChannelId, buildAddOnSlackNotification, buildCancellationSlackNotification, formatSlackAlert, type SlackOpsAlert } from "@/lib/slack-alerts";
import { formatSlackMessage } from "@/lib/slack-message-format";
import { truckSlackChannelId } from "@/lib/slack-truck-channels";
import type { AnyRecord } from "@/lib/opsData";

type Snapshot = {
  date: string;
  scrapedAt: string;
  appointments: AnyRecord[];
  cancelled: AnyRecord[];
};

type DetectorState = {
  version: 1;
  snapshot: Snapshot | null;
  delivered: string[];
};

export type ScheduleChange = {
  fingerprint: string;
  kind: "new_appointment" | "cancelled" | "rescheduled" | "job_closed";
  alert: SlackOpsAlert;
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
  const origin = String(process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
  return `${origin}/jobs?date=${encodeURIComponent(date)}#job-${jobNumber(row).replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
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

function closeoutAlert(date: string, row: AnyRecord): SlackOpsAlert {
  const truck = first(row, ["truck", "assigned_truck", "truck_number"]);
  const number = jobNumber(row);
  return {
    fingerprint: "",
    kind: "job_closed",
    lifecycle: "notification",
    severity: "warning",
    channelId: truckSlackChannelId(truck, appointmentChannelId(first(row, ["normalized_territory", "territory", "source_territory", "market"]))),
    title: "Job Closed",
    detail: "",
    nextAction: "",
    href: "",
    plainText: formatSlackMessage({
      icon: ":white_check_mark:",
      title: "Job Closed",
      fields: [{ label: "Job", value: number, href: href(date, row) }],
    }),
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
    if (!complete(previousRow) && complete(row)) {
      events.push({ fingerprint: `job_closed:${current.date}:${id}`, kind: "job_closed", alert: closeoutAlert(current.date, row) });
    } else if (!complete(row) && scheduleShape(previousRow) !== scheduleShape(row)) {
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
    return {
      version: 1,
      snapshot: value?.snapshot || null,
      delivered: Array.isArray(value?.delivered) ? value.delivered.map(String).slice(-2_000) : [],
    };
  } catch {
    return { version: 1, snapshot: null, delivered: [] };
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

export async function publishScheduleChanges(dataDir: string, snapshot: Snapshot, token: string): Promise<{ baselined: boolean; posted: ScheduleChange[]; failed: ScheduleChange[] }> {
  const state = readState(dataDir);
  if (!state.snapshot) {
    writeState(dataDir, { ...state, snapshot });
    return { baselined: true, posted: [], failed: [] };
  }
  const delivered = new Set(state.delivered);
  const posted: ScheduleChange[] = [];
  const failed: ScheduleChange[] = [];
  for (const event of detectScheduleChanges(state.snapshot, snapshot)) {
    if (delivered.has(event.fingerprint)) continue;
    if (await post(token, event.alert)) {
      delivered.add(event.fingerprint);
      posted.push(event);
    } else {
      failed.push(event);
    }
  }
  writeState(dataDir, { version: 1, snapshot, delivered: Array.from(delivered).slice(-2_000) });
  return { baselined: false, posted, failed };
}
