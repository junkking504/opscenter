import { createHash } from "node:crypto";
import { INSPECTION_SECTIONS, INSPECTION_STATUSES, inspectionDate, type TruckInspectionReport } from "./truck-inspection";
import { listTruckInspections } from "./truck-inspection-store";
import { formatSlackMessage } from "./slack-message-format";
import type { SlackOpsAlert } from "./slack-alerts";

export function inspectionSlackNotification(report: TruckInspectionReport): SlackOpsAlert {
  const receivedDate = inspectionDate(new Date(report.receivedAt));
  const identity = createHash("sha256").update(`${report.deviceId}:${report.requestId}`).digest("hex");
  const fingerprint = `truck_inspection:${receivedDate}:${identity}`;
  const base = (process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
  const href = `${base}/fleet-inspections?date=${report.inspectionDate}&report=${encodeURIComponent(`${report.deviceId}:${report.requestId}`)}`;
  const fields = [
    { label: "Truck", value: report.truck },
    { label: "Inspector", value: report.inspector },
    { label: "Inspection date", value: report.inspectionDate },
    { label: "Received", value: new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", dateStyle: "medium", timeStyle: "short" }).format(new Date(report.receivedAt)) + " CT" },
    { label: "Reported status", value: INSPECTION_STATUSES[report.status] },
    { label: "Odometer", value: report.odometer },
    { label: "Fuel", value: report.fuel },
    { label: "Truck fullness", value: report.loadLevel || "Not recorded" },
    // Preserve notes even when the inspector marked their section Good.
    ...report.answers.filter(a => a.status === "problem" || a.notes).map(a => ({
      label: `${INSPECTION_SECTIONS.find(s => s.id === a.id)?.label || a.id} (${a.status === "problem" ? "Problem" : "marked Good"})`, value: a.notes || "Problem reported",
    })),
    ...(report.notes ? [{ label: "Notes", value: report.notes }] : []),
    { label: "Photos", value: String(report.photos.length) },
  ];
  const title = `Five Point Inspection Received · ${report.truck}`;
  const nextAction = report.status === "stop" ? "Do not operate. Supervisor review required."
    : report.status === "reported" || report.answers.some(a => a.notes) ? "Review the recorded issues and arrange follow-up." : "";
  return {
    fingerprint, kind: "truck_inspection", lifecycle: "notification", severity: report.status === "stop" ? "critical" : "warning",
    channelId: process.env.SLACK_OPS_FLEET_CHANNEL_ID?.trim() || "C0BNQ6J7LER", title,
    detail: "Inspection received by OpsCenter.", fields, nextAction, href,
    plainText: formatSlackMessage({ icon: report.status === "stop" ? ":rotating_light:" : report.status === "reported" ? ":warning:" : ":clipboard:", title, fields, nextAction, href }) + `\n\n_Alert ID: ${fingerprint}_`,
  };
}

export function truckInspectionSlackNotifications(date: string): SlackOpsAlert[] {
  // Historical replays stay silent. Late drafts received today still notify;
  // submission allows a draft up to seven days old.
  if (date !== inspectionDate()) return [];
  const reports: TruckInspectionReport[] = [];
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(`${date}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - offset);
    reports.push(...listTruckInspections(day.toISOString().slice(0, 10)));
  }
  return reports.filter(r => inspectionDate(new Date(r.receivedAt)) === date)
    .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt)).map(inspectionSlackNotification);
}
