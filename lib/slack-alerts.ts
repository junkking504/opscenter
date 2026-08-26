import fs from "fs";
import path from "path";
import {
  buildAddOnAppointmentFeed,
  buildCancelledAppointmentFeed,
  type AddOnAppointment,
  type CancelledAppointment,
} from "@/lib/add-on-notifications";
import { getDataHealthReport, type DataHealthSource } from "@/lib/data-health";
import { readFleetIssueStore, type FleetIssue } from "@/lib/fleet-issues";
import { buildOperationalExceptions, type OperationalException } from "@/lib/operational-exceptions";
import { crewRows, readMetrics, type AnyRecord } from "@/lib/opsData";
import { money as moneyText } from "@/lib/money";
import { chicagoDateKey } from "@/lib/report-dates";
import { readCompletedJunkwareRows, truckCloseoutDetails } from "@/lib/slack-closeout-details";
import { formatSlackMessage, slackEscape, type SlackMessageField } from "@/lib/slack-message-format";
import { normalizeSlackTruckNumber, truckSlackChannelId } from "@/lib/slack-truck-channels";

export type SlackAlertSeverity = "critical" | "warning";
export type SlackAlertKind =
  | "add_on"
  | "cancellation"
  | "job_closed"
  | "job_closed_payment"
  | "unassigned_crew"
  | "late_job"
  | "fleet_down"
  | "stale_data"
  | "truck_arrival"
  | "crew_clock_in"
  | "crew_clock_out"
  | "crew_daily_pay";

export type SlackOpsAlert = {
  fingerprint: string;
  kind: SlackAlertKind;
  lifecycle: "incident" | "notification";
  severity: SlackAlertSeverity;
  channelId: string;
  title: string;
  detail: string;
  nextAction: string;
  href: string;
  fields?: SlackMessageField[];
  plainText?: string;
};

type ActiveSlackAlert = {
  fingerprint: string;
  kind: SlackAlertKind;
  channelId: string;
  threadTs: string;
  openedAt: string;
  lastSeenAt: string;
};

type SlackAlertState = {
  version: 4;
  initializedAt: string;
  updatedAt: string;
  active: Record<string, ActiveSlackAlert>;
  suppressedIncidentFingerprints: string[];
  knownAppointmentsByDate: Record<string, string[]>;
  knownCancellationsByDate: Record<string, string[]>;
  crewNotificationsInitializedAt: string;
  deliveredCrewNotificationsByDate: Record<string, string[]>;
  truckArrivalNotificationsInitializedAt: string;
  deliveredTruckArrivalsByDate: Record<string, string[]>;
  truckCloseoutNotificationsInitializedAt: string;
  deliveredTruckCloseoutsByDate: Record<string, string[]>;
  paymentNotificationsInitializedAt: string;
  deliveredPaymentNotificationsByDate: Record<string, string[]>;
};

type SlackApiResponse = {
  ok: boolean;
  error?: string;
  channel?: string;
  ts?: string;
};

export type SlackAlertRunResult = {
  enabled: boolean;
  dryRun: boolean;
  date: string;
  bootstrappedAddOns: number;
  bootstrappedCancellations: number;
  bootstrappedIncidents: number;
  bootstrappedTruckCloseouts: number;
  bootstrappedPayments: number;
  posted: SlackOpsAlert[];
  resolved: ActiveSlackAlert[];
  unchanged: number;
  failures: Array<{ fingerprint: string; error: string }>;
  preview: SlackOpsAlert[];
};

export type VerifiedTruckCloseout = {
  appointmentId: string;
  jobNumber: string;
  truck: string;
  closeout: AnyRecord;
  date?: string;
};

export type VerifiedTruckCloseoutPublishResult = {
  attempted: boolean;
  posted: boolean;
  duplicate: boolean;
  reason?: string;
};

const DEFAULT_CHANNELS = {
  command: "C0BNMDJNYV9",
  dispatch: "C0BNRMD25AS",
  crew: "C0BNMDJNYV9",
  fleet: "C0BNQ6J7LER",
  dataHealth: "C0BPN1FVCDN",
  jobsNewOrleans: "C0BPRML654N",
  jobsBatonRouge: "C0BPQ30C8LD",
  jobsNorthshore: "C0BPC9M5GLX",
  payment: "C0BPS5MS406",
} as const;

function boolEnv(name: string): boolean {
  return /^(1|true|yes|on)$/i.test(String(process.env[name] || "").trim());
}

function stateFile(): string {
  const configured = String(process.env.SLACK_OPSCENTER_STATE_FILE || "").trim();
  return configured || path.join(process.cwd(), "data", "slack", "ops_alert_state.json");
}

function emptyState(): SlackAlertState {
  return {
    version: 4,
    initializedAt: "",
    updatedAt: "",
    active: {},
    suppressedIncidentFingerprints: [],
    knownAppointmentsByDate: {},
    knownCancellationsByDate: {},
    crewNotificationsInitializedAt: "",
    deliveredCrewNotificationsByDate: {},
    truckArrivalNotificationsInitializedAt: "",
    deliveredTruckArrivalsByDate: {},
    truckCloseoutNotificationsInitializedAt: "",
    deliveredTruckCloseoutsByDate: {},
    paymentNotificationsInitializedAt: "",
    deliveredPaymentNotificationsByDate: {},
  };
}

function readState(): SlackAlertState {
  try {
    const payload = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return {
      version: 4,
      initializedAt: String(payload?.initializedAt || ""),
      updatedAt: String(payload?.updatedAt || ""),
      active: payload?.active && typeof payload.active === "object" ? payload.active : {},
      suppressedIncidentFingerprints: Array.isArray(payload?.suppressedIncidentFingerprints)
        ? payload.suppressedIncidentFingerprints.map(String)
        : [],
      knownAppointmentsByDate:
        payload?.knownAppointmentsByDate && typeof payload.knownAppointmentsByDate === "object"
          ? payload.knownAppointmentsByDate
          : {},
      knownCancellationsByDate:
        payload?.knownCancellationsByDate && typeof payload.knownCancellationsByDate === "object"
          ? payload.knownCancellationsByDate
          : {},
      crewNotificationsInitializedAt: String(payload?.crewNotificationsInitializedAt || ""),
      deliveredCrewNotificationsByDate:
        payload?.deliveredCrewNotificationsByDate && typeof payload.deliveredCrewNotificationsByDate === "object"
          ? payload.deliveredCrewNotificationsByDate
          : {},
      truckArrivalNotificationsInitializedAt: String(payload?.truckArrivalNotificationsInitializedAt || ""),
      deliveredTruckArrivalsByDate:
        payload?.deliveredTruckArrivalsByDate && typeof payload.deliveredTruckArrivalsByDate === "object"
          ? payload.deliveredTruckArrivalsByDate
          : {},
      truckCloseoutNotificationsInitializedAt: String(payload?.truckCloseoutNotificationsInitializedAt || ""),
      deliveredTruckCloseoutsByDate:
        payload?.deliveredTruckCloseoutsByDate && typeof payload.deliveredTruckCloseoutsByDate === "object"
          ? payload.deliveredTruckCloseoutsByDate
          : {},
      paymentNotificationsInitializedAt: String(payload?.paymentNotificationsInitializedAt || ""),
      deliveredPaymentNotificationsByDate:
        payload?.deliveredPaymentNotificationsByDate && typeof payload.deliveredPaymentNotificationsByDate === "object"
          ? payload.deliveredPaymentNotificationsByDate
          : {},
    };
  } catch {
    return emptyState();
  }
}

function deliveredFastScheduleCloseouts(date: string): string[] {
  const configured = String(process.env.OPSCENTER_DATA_DIR || "").trim();
  const candidates = Array.from(new Set([
    ...(configured ? [configured] : []),
    path.join(process.cwd(), "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ]));
  for (const dataDirectory of candidates) {
    try {
      const payload = JSON.parse(fs.readFileSync(
        path.join(dataDirectory, "slack", "junkware_schedule_change_state.json"),
        "utf8",
      ));
      return (Array.isArray(payload?.delivered) ? payload.delivered.map(String) : [])
        .filter((fingerprint: string) => fingerprint.startsWith(`job_closed:${date}:`));
    } catch {
      // Try the next known runtime data location.
    }
  }
  return [];
}

function writeState(state: SlackAlertState): void {
  const file = stateFile();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.ops_alert_state.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
}

function pruneAppointmentDates(values: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => right.localeCompare(left)).slice(0, 8));
}

function pruneCrewNotificationDates(values: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => right.localeCompare(left)).slice(0, 8));
}

function pruneTruckArrivalDates(values: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => right.localeCompare(left)).slice(0, 8));
}

function pruneTruckCloseoutDates(values: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => right.localeCompare(left)).slice(0, 8));
}

function prunePaymentNotificationDates(values: Record<string, string[]>): Record<string, string[]> {
  return Object.fromEntries(Object.entries(values).sort(([left], [right]) => right.localeCompare(left)).slice(0, 8));
}

function channel(name: keyof typeof DEFAULT_CHANNELS): string {
  const envNames: Record<keyof typeof DEFAULT_CHANNELS, string> = {
    command: "SLACK_OPS_COMMAND_CHANNEL_ID",
    dispatch: "SLACK_OPS_DISPATCH_CHANNEL_ID",
    crew: "SLACK_OPS_CREW_CHANNEL_ID",
    fleet: "SLACK_OPS_FLEET_CHANNEL_ID",
    dataHealth: "SLACK_OPS_DATA_HEALTH_CHANNEL_ID",
    jobsNewOrleans: "SLACK_JOBS_NO_CHANNEL_ID",
    jobsBatonRouge: "SLACK_JOBS_BR_CHANNEL_ID",
    jobsNorthshore: "SLACK_JOBS_NS_CHANNEL_ID",
    payment: "SLACK_OPS_PAYMENT_CHANNEL_ID",
  };
  return String(process.env[envNames[name]] || DEFAULT_CHANNELS[name]).trim();
}

function crewChannelId(): string {
  return String(
    process.env.SLACK_OPS_CREW_CHANNEL_ID
      || process.env.SLACK_OPS_COMMAND_CHANNEL_ID
      || DEFAULT_CHANNELS.crew,
  ).trim();
}

export function appointmentChannelId(territory: string): string {
  const normalized = String(territory || "").trim().toLowerCase();
  if (
    normalized.includes("new orleans")
    || normalized.includes("jefferson parish")
    || normalized.includes("westbank")
    || normalized === "no"
    || normalized === "jp"
  ) {
    return channel("jobsNewOrleans");
  }
  if (normalized.includes("baton rouge") || normalized === "br") {
    return channel("jobsBatonRouge");
  }
  if (normalized.includes("northshore") || normalized.includes("north shore") || normalized === "ns") {
    return channel("jobsNorthshore");
  }
  return channel("dispatch");
}

export function slackAlertKindEnabled(kind: SlackAlertKind): boolean {
  return kind !== "late_job" && kind !== "unassigned_crew";
}

function origin(): string {
  return String(process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
}

function absoluteOpsHref(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${origin()}${href.startsWith("/") ? href : `/${href}`}`;
}

function closeoutOpsHref(date: string, jobNumber: string): string {
  const jobAnchor = jobNumber.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return absoluteOpsHref(`/jobs?date=${encodeURIComponent(date)}#job-${jobAnchor}`);
}

function exceptionAlert(
  exception: OperationalException,
  kind: "unassigned_crew" | "late_job",
): SlackOpsAlert {
  const isUnassigned = kind === "unassigned_crew";
  return {
    fingerprint: `${kind}:${exception.id}`,
    kind,
    lifecycle: "incident",
    severity: isUnassigned ? "critical" : "warning",
    channelId: channel("dispatch"),
    title: exception.title,
    detail: exception.reason,
    nextAction: isUnassigned
      ? "Assign the employee to the correct truck or confirm that the shift should be ended."
      : "Confirm the Krewe status and close, reschedule, or update the appointment.",
    href: absoluteOpsHref(exception.href || `/jobs?date=${encodeURIComponent(exception.timestamp.slice(0, 10))}`),
  };
}

function fleetDownAlert(issue: FleetIssue): SlackOpsAlert {
  return {
    fingerprint: `fleet_down:${issue.issueId}`,
    kind: "fleet_down",
    lifecycle: "incident",
    severity: "critical",
    channelId: channel("fleet"),
    title: `${issue.truck} is out of service`,
    detail: `${issue.title}${issue.description ? ` — ${issue.description}` : ""}`,
    nextAction: issue.owner
      ? `${issue.owner} owns the repair. Confirm the operating plan and update the issue status.`
      : "Assign a repair owner, confirm the replacement-truck plan, and update the issue status.",
    href: absoluteOpsHref("/fleet"),
  };
}

function staleDataAlert(source: DataHealthSource): SlackOpsAlert {
  const age = source.ageMinutes == null ? "an unknown amount of time" : `${Math.round(source.ageMinutes)} minutes`;
  return {
    fingerprint: `stale_data:${source.key}`,
    kind: "stale_data",
    lifecycle: "incident",
    severity: "critical",
    channelId: channel("dataHealth"),
    title: `${source.label} data needs attention`,
    detail: source.missingToday
      ? `${source.label} has no current-day files available to OpsCenter.`
      : `${source.label} has not refreshed for ${age}. ${source.details}`,
    nextAction: "Check the collector and source login, then verify that a current file reaches OpsCenter.",
    href: absoluteOpsHref("/"),
  };
}

export function buildAddOnSlackNotification(appointment: AddOnAppointment, date: string): SlackOpsAlert {
  const href = absoluteOpsHref(appointment.href);
  const plainText = [
    ":warning: *New Appointment*",
    `<${href}|${slackEscape(appointment.jobNumber)}>`,
    slackEscape(appointment.appointmentTime),
    `*${slackEscape(appointment.customerName)}*`,
    slackPhoneLink(appointment.phone),
    slackEscape(appointment.address),
    ...(appointment.items.length ? [`*Items:* ${slackEscape(appointment.items.join("; "))}`] : []),
  ].filter(Boolean).join("\n");

  return {
    fingerprint: `add_on:${date}:${appointment.id}`,
    kind: "add_on",
    lifecycle: "notification",
    severity: "warning",
    channelId: appointmentChannelId(appointment.territory),
    title: "New Appointment",
    detail: "",
    nextAction: "",
    href: "",
    plainText,
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type CancellationDisplayDetails = Pick<CancelledAppointment, "customerName" | "phone" | "address">;

function missingCancellationField(value: string, unavailableLabel: string): boolean {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return !normalized || normalized.toLowerCase() === unavailableLabel.toLowerCase();
}

/**
 * The JunkWare cancelled schedule table can collapse customer, phone, address,
 * and reason into one cell. Recover the individual facts before the shared
 * formatter turns them into an alert.
 */
function cancellationDisplayDetails(appointment: CancelledAppointment): CancellationDisplayDetails {
  const fallback = {
    customerName: String(appointment.customerName || "").replace(/\s+/g, " ").trim(),
    phone: String(appointment.phone || "").replace(/\s+/g, " ").trim(),
    address: String(appointment.address || "").replace(/\s+/g, " ").trim(),
  };
  const needsContactRecovery = missingCancellationField(fallback.phone, "Phone unavailable")
    || missingCancellationField(fallback.address, "Address unavailable");
  if (!needsContactRecovery) return fallback;

  const sources = [appointment.cancellationReason, appointment.customerName]
    .map((value) => String(value || "").replace(/\s+/g, " ").trim())
    .filter(Boolean);

  for (const source of sources) {
    const phoneMatch = /(?:\+?1[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4})(?:\s*(?:x|ext\.?)\s*\d{1,6})?/i.exec(source);
    if (!phoneMatch || phoneMatch.index == null) continue;

    const afterPhone = source.slice(phoneMatch.index + phoneMatch[0].length).replace(/^[\s,;:-]+/, "");
    const zipMatch = /\b\d{5}(?:-\d{4})?\b/.exec(afterPhone);
    if (!zipMatch || zipMatch.index == null) continue;

    const customerName = source.slice(0, phoneMatch.index).replace(/[\s,;:-]+$/, "").trim();
    const address = afterPhone.slice(0, zipMatch.index + zipMatch[0].length).replace(/[\s,;:-]+$/, "").trim();
    if (!customerName || !address) continue;

    return {
      customerName,
      phone: fallback.phone || phoneMatch[0].trim(),
      address: fallback.address || address,
    };
  }

  return fallback;
}

function normalizedCancellationReason(appointment: CancelledAppointment): string {
  const original = String(appointment.cancellationReason || "").replace(/\s+/g, " ").trim();
  if (!original) return "";

  let reason = original;
  let strippedContact = false;
  const customerName = String(appointment.customerName || "").replace(/\s+/g, " ").trim();
  if (customerName && reason.toLowerCase().startsWith(customerName.toLowerCase())) {
    reason = reason.slice(customerName.length).replace(/^[\s,;:-]+/, "");
    strippedContact = true;
  }

  const phoneDigits = String(appointment.phone || "").replace(/\D/g, "");
  if (phoneDigits.length >= 7) {
    const phonePattern = phoneDigits.split("").map(escapeRegExp).join("\\D*");
    const phonePrefix = new RegExp(`^\\D*${phonePattern}(?:\\D+|$)`, "i");
    if (phonePrefix.test(reason)) {
      reason = reason.replace(phonePrefix, "").trim();
      strippedContact = true;
    }
  }

  if (strippedContact && /^\d{1,6}\s+/.test(reason)) {
    // Street numbers can also be five digits. Use the final ZIP-code match so
    // we remove the whole repeated address, not just its street number.
    const addressPrefix = reason.match(/^.*\b\d{5}(?:-\d{4})?\b[\s,;:-]*/);
    if (addressPrefix) reason = reason.slice(addressPrefix[0].length).trim();
  }

  return reason || original;
}

export function buildCancellationSlackNotification(appointment: CancelledAppointment, date: string): SlackOpsAlert {
  const href = absoluteOpsHref(appointment.href);
  const display = cancellationDisplayDetails(appointment);
  const reason = normalizedCancellationReason({ ...appointment, ...display });
  const plainText = [
    ":x: *Cancellation*",
    `*<${href}|${slackEscape(appointment.jobNumber)}>*`,
    slackEscape(appointment.appointmentTime),
    slackEscape(display.customerName),
    slackPhoneLink(display.phone),
    slackEscape(display.address),
    ...(reason ? [`*Reason:* ${slackEscape(reason)}`] : []),
  ].filter(Boolean).join("\n");

  return {
    fingerprint: `cancellation:${date}:${appointment.id}`,
    kind: "cancellation",
    lifecycle: "notification",
    severity: "warning",
    channelId: appointmentChannelId(appointment.territory),
    title: "Cancellation",
    detail: "",
    nextAction: "",
    href: "",
    plainText,
  };
}

function firstText(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = String(row?.[key] ?? "").trim();
    if (value) return value;
  }
  return "";
}

function firstFiniteNumber(row: AnyRecord, keys: string[]): number | null {
  for (const key of keys) {
    if (row?.[key] === null || row?.[key] === undefined || row?.[key] === "") continue;
    const value = Number(String(row[key]).replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function employeeKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[,]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join("-");
}

function crewNotification(
  kind: "crew_clock_in" | "crew_clock_out" | "crew_daily_pay",
  date: string,
  name: string,
  fields: SlackMessageField[],
): SlackOpsAlert {
  const title = kind === "crew_clock_in"
    ? "Krewe clocked in"
    : kind === "crew_clock_out"
      ? "Krewe clocked out"
      : "Final daily pay";
  return {
    fingerprint: `${kind}:${date}:${employeeKey(name)}`,
    kind,
    lifecycle: "notification",
    severity: "warning",
    channelId: crewChannelId(),
    title,
    detail: "",
    nextAction: "",
    href: "",
    plainText: formatSlackMessage({ icon: ":bust_in_silhouette:", title, fields }),
  };
}

export function buildCrewSlackNotifications(date: string, rows: AnyRecord[]): SlackOpsAlert[] {
  const notifications: SlackOpsAlert[] = [];
  const seenEmployees = new Set<string>();

  for (const row of rows) {
    const name = firstText(row, ["name", "employee", "employee_name", "crew_member"]);
    const key = employeeKey(name);
    if (!name || !key || seenEmployees.has(key)) continue;
    seenEmployees.add(key);

    const clockIn = firstText(row, ["clock_in", "time_in", "clockIn", "timeIn"]);
    const clockOut = firstText(row, ["clock_out", "time_out", "clockOut", "timeOut"]);
    if (!clockIn) continue;

    notifications.push(crewNotification("crew_clock_in", date, name, [
      { label: "Krewe member", value: name },
      { label: "Clock in", value: clockIn },
    ]));
    if (!clockOut) continue;

    const hoursWorked = firstFiniteNumber(row, ["hours_worked", "hours"]);
    if (hoursWorked !== null && hoursWorked >= 0) {
      notifications.push(crewNotification(
        "crew_clock_out",
        date,
        name,
        [
          { label: "Krewe member", value: name },
          { label: "Clock out", value: clockOut },
          { label: "Hours", value: hoursWorked.toFixed(2) },
        ],
      ));
    }

    const payIsFinal = row?.pay_is_final === true
      || String(row?.pay_status || "").trim().toLowerCase() === "final";
    if (!payIsFinal) continue;

    const hourlyPay = firstFiniteNumber(row, ["hourly_pay", "regular_pay", "base_pay", "pay"]);
    const tips = firstFiniteNumber(row, ["tip", "tips"]);
    const bonuses = firstFiniteNumber(row, ["total_bonus", "bonuses", "bonus", "daily_bonus"]);
    const supplementalPay = firstFiniteNumber(row, ["supplemental_daily_pay"]) ?? 0;
    const totalPay = firstFiniteNumber(row, ["total_pay", "total_daily_pay", "employee_total_earnings"]);
    if (hourlyPay === null || tips === null || bonuses === null || totalPay === null) continue;
    if (Math.abs(totalPay - (hourlyPay + tips + bonuses + supplementalPay)) > 0.01) continue;

      notifications.push(crewNotification(
        "crew_daily_pay",
        date,
        name,
        [
          { label: "Krewe member", value: name },
          { label: "Total pay", value: moneyText(totalPay) },
          { label: "Hourly pay", value: moneyText(hourlyPay) },
          { label: "Tips", value: moneyText(tips) },
          { label: "Bonuses", value: moneyText(bonuses) },
          ...(supplementalPay ? [{ label: "Other pay", value: moneyText(supplementalPay) }] : []),
        ],
    ));
  }

  return notifications;
}

function closeoutPaymentDescription(payment: AnyRecord): string {
  const method = firstText(payment, ["method", "payment_method", "paymentMethod"]);
  if (!method) return "";

  const detail = firstText(payment, ["detail", "payment_detail", "paymentDetail"]);
  const amount = firstFiniteNumber(payment, ["amount", "payment_amount", "paymentAmount"]);
  const amountText = amount !== null ? ` (${moneyText(amount)})` : "";
  const normalizedMethod = method.toLowerCase();

  if (normalizedMethod.includes("card")) {
    const lastFour = detail.match(/(\d{4})(?!.*\d)/)?.[1] || "";
    return `Card${lastFour ? ` ending ${lastFour}` : " (last four unavailable)"}${amountText}`;
  }
  if (normalizedMethod.includes("check")) {
    const checkNumber = detail.replace(/^\s*#\s*/, "").replace(/\s+/g, " ").trim().slice(0, 32);
    return `Check${checkNumber ? ` #${checkNumber}` : " (number unavailable)"}${amountText}`;
  }
  if (normalizedMethod.includes("cash")) return `Cash${amountText}`;
  return `${method.replace(/\s+/g, " ").trim().slice(0, 40)}${amountText}`;
}

function closeoutIdentity(row: AnyRecord): string {
  const appointmentId = firstText(row, ["appt_id", "appointment_id", "appointmentId"]);
  if (appointmentId) return `appt-${appointmentId.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"]);
  return jobNumber ? `job-${jobNumber.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}` : "";
}

function closeoutTruck(row: AnyRecord): string {
  return firstText(row, ["truck", "assigned_truck", "truck_number", "truckNumber"]);
}

function closeoutCustomer(row: AnyRecord): string {
  return firstText(row, ["customer_name", "customerName", "customer", "name"]);
}

function closeoutCrewMember(row: AnyRecord, role: "driver" | "navigator"): string {
  return role === "driver"
    ? firstText(row, ["driver_normalized_name", "driver_name", "driver"])
    : firstText(row, ["navigator_normalized_name", "navigator_name", "navigator"]);
}

/**
 * The single approved truck-closeout presentation.  Keep the job link and
 * customer/crew facts with the financial detail so every publisher (the
 * collector, direct verified writes, and digest repair) renders identically.
 */
export function formatTruckCloseoutSlackNotification(date: string, row: AnyRecord): string | null {
  const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"]);
  if (!jobNumber) return null;

  const closeout = truckCloseoutDetails(row);
  const detailLines = parseSlackDetailLines(closeout?.lines || []).map(({ label, value }) => (
    label === "Tips" && !value ? "*Tips:*" : `*${slackEscape(label)}:* ${slackEscape(value)}`
  ));
  const customer = closeoutCustomer(row);
  const driver = closeoutCrewMember(row, "driver");
  const navigator = closeoutCrewMember(row, "navigator");

  return [
    ":moneybag: *Job Closed*",
    `*<${closeoutOpsHref(date, jobNumber)}|${slackEscape(jobNumber)}>*`,
    customer ? `*${slackEscape(customer)}*` : "",
    `*Driver:*${driver ? ` ${slackEscape(driver)}` : ""}`,
    `*Navigator:*${navigator ? ` ${slackEscape(navigator)}` : ""}`,
    ...detailLines,
  ].filter(Boolean).join("\n");
}

export function buildTruckCloseoutSlackNotifications(date: string, rows: AnyRecord[]): SlackOpsAlert[] {
  const notifications: SlackOpsAlert[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const identity = closeoutIdentity(row);
    const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"]);
    const truck = closeoutTruck(row);
    const truckNumber = normalizeSlackTruckNumber(truck);
    if (!identity || !jobNumber || !truckNumber) continue;

    const status = firstText(row, ["final_status", "job_status", "status"]).toLowerCase();
    if (!status.includes("complete")) continue;

    const fingerprint = `job_closed:${date}:${identity}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const plainText = formatTruckCloseoutSlackNotification(date, row);
    if (!plainText) continue;
    notifications.push({
      fingerprint,
      kind: "job_closed",
      lifecycle: "notification",
      severity: "warning",
      channelId: truckSlackChannelId(truck, ""),
      title: plainText,
      detail: "",
      nextAction: "",
      href: "",
      plainText,
    });
  }

  return notifications.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

export function buildPaymentCloseoutSlackNotifications(date: string, rows: AnyRecord[]): SlackOpsAlert[] {
  const notifications: SlackOpsAlert[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const identity = closeoutIdentity(row);
    const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"]);
    if (!identity || !jobNumber) continue;

    const status = firstText(row, ["final_status", "job_status", "status"]).toLowerCase();
    if (!status.includes("complete")) continue;

    const closeout = row?.closeout && typeof row.closeout === "object" ? row.closeout as AnyRecord : {};
    const paymentRows = Array.isArray(closeout.payments) ? closeout.payments : [];
    const paymentDescriptions = paymentRows
      .filter((payment): payment is AnyRecord => Boolean(payment) && typeof payment === "object")
      .map(closeoutPaymentDescription)
      .filter(Boolean);
    if (!paymentDescriptions.length) continue;

    const fingerprint = `job_closed_payment:${date}:${identity}`;
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const tip = firstFiniteNumber(closeout, ["tip"])
      ?? firstFiniteNumber(row, ["tip", "tips"])
      ?? 0;
    const paymentLabel = paymentDescriptions.length === 1 ? "Payment" : "Payments";
    const plainText = formatSlackMessage({
      icon: ":credit_card:",
      title: "Payment recorded",
      fields: [
        { label: "Job", value: jobNumber },
        { label: paymentLabel, value: paymentDescriptions.join("; ") },
        ...(tip > 0 ? [{ label: "Tip", value: moneyText(tip) }] : []),
      ],
    });

    notifications.push({
      fingerprint,
      kind: "job_closed_payment",
      lifecycle: "notification",
      severity: "warning",
      channelId: channel("payment"),
      title: plainText,
      detail: "",
      nextAction: "",
      href: "",
      plainText,
    });
  }

  return notifications.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function readTruckArrivalVisitRows(date: string): AnyRecord[] {
  const dataDirectory = String(process.env.OPSCENTER_DATA_DIR || "").trim()
    || path.join(process.cwd(), "data");
  const file = path.join(
    dataDirectory,
    "history",
    "linxup",
    "appointment_visits",
    `linxup_appointment_visits_${date}.json`,
  );
  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(payload?.visits) ? payload.visits : [];
  } catch {
    return [];
  }
}

type TruckArrivalAppointmentDetails = {
  customerName: string;
  phone: string;
  address: string;
};

function readTruckArrivalAppointmentDetails(date: string): Map<string, TruckArrivalAppointmentDetails> {
  const configured = String(process.env.OPSCENTER_DATA_DIR || "").trim();
  const dataDirectories = Array.from(new Set([
    ...(configured ? [configured] : []),
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "opsbot", "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ]));

  for (const dataDirectory of dataDirectories) {
    const file = path.join(dataDirectory, "history", "junkware", `junkware_${date}_raw.json`);
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      const rows = [payload?.appointments, payload?.completed, payload?.cancelled]
        .flatMap((group) => Array.isArray(group) ? group : [])
        .filter((row): row is AnyRecord => Boolean(row) && typeof row === "object");
      const detailsByAppointment = new Map<string, TruckArrivalAppointmentDetails>();

      for (const row of rows) {
        const details = {
          customerName: firstText(row, ["customer_name", "customerName", "service_contact_name"]),
          phone: firstText(row, ["phone", "customer_phone", "customerPhone", "service_contact_phone"]),
          address: firstText(row, ["service_address", "address", "serviceAddress"]),
        };
        if (!details.customerName && !details.phone && !details.address) continue;

        for (const key of [
          firstText(row, ["appt_id", "appointment_id", "appointmentId"]),
          firstText(row, ["job_id", "jk_number", "job_number"]),
        ]) {
          if (key) detailsByAppointment.set(key, details);
        }
      }
      return detailsByAppointment;
    } catch {
      // Try the next known OpsBot data location.
    }
  }

  return new Map();
}

function truckArrivalKeyPart(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatTruckArrivalTime(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function phoneDisplayParts(value: string): { label: string; digits: string; extension: string } {
  const raw = String(value || "").trim();
  const slackTelLabel = raw.match(/^<tel:[^|>]*\|([^>]+)>$/i)?.[1]?.trim();
  const unwrapped = slackTelLabel || raw;
  const extensionMatch = /(?:\bext\.?|x)\s*(\d{1,6})\b/i.exec(unwrapped);
  const phoneText = extensionMatch ? unwrapped.slice(0, extensionMatch.index).trim() : unwrapped;
  let digits = phoneText.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  const extension = extensionMatch?.[1] || "";
  const label = digits.length === 10
    ? `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}${extension ? ` x${extension}` : ""}`
    : unwrapped;
  return { label, digits, extension };
}

function displayPhone(value: string): string {
  return phoneDisplayParts(value).label;
}

export function slackPhoneLink(value: string): string {
  const { label, digits, extension } = phoneDisplayParts(value);
  if (!label || digits.length < 7) return slackEscape(label);
  const phoneNumber = digits.length === 10 ? `+1${digits}` : `+${digits}`;
  return `<tel:${phoneNumber}${extension ? `;ext=${extension}` : ""}|${slackEscape(label)}>`;
}

export function buildTruckArrivalSlackNotifications(date: string, rows: AnyRecord[]): SlackOpsAlert[] {
  const notifications: SlackOpsAlert[] = [];
  const seen = new Set<string>();
  const appointmentDetails = readTruckArrivalAppointmentDetails(date);

  for (const row of rows) {
    if (String(row?.match_confidence || "").trim().toLowerCase() !== "confirmed") continue;
    if (Number(row?.visit_count || 0) <= 0) continue;

    const appointmentId = firstText(row, ["appointment_id", "appt_id", "appointmentId"]);
    const jkNumber = firstText(row, ["jk_number", "job_id", "job_number"]) || appointmentId || "Appointment";
    const truck = firstText(row, ["truck_number", "truck", "truckNumber"]);
    if (!appointmentId || !truck) continue;
    const details = appointmentDetails.get(appointmentId) || appointmentDetails.get(jkNumber);
    const customerName = firstText(row, ["customer_name", "customerName", "service_contact_name"])
      || details?.customerName
      || "Unknown";
    const phone = firstText(row, ["phone", "customer_phone", "customerPhone", "service_contact_phone"])
      || details?.phone
      || "";
    const address = firstText(row, ["service_address", "address", "serviceAddress"])
      || details?.address
      || "Unknown";

    const intervalArrivals = (Array.isArray(row?.visit_intervals) ? row.visit_intervals : [])
      .map((interval: AnyRecord) => firstText(interval, ["arrival"]))
      .filter(Boolean);
    const arrivals = intervalArrivals.length
      ? intervalArrivals
      : [firstText(row, ["first_arrival", "arrival"])].filter(Boolean);

    for (const arrival of arrivals) {
      if (!Number.isFinite(Date.parse(arrival))) continue;
      const fingerprint = [
        "truck_arrival",
        date,
        truckArrivalKeyPart(appointmentId),
        truckArrivalKeyPart(truck),
        arrival,
      ].join(":");
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      const truckNumber = normalizeSlackTruckNumber(truck);
      const title = `${truckNumber ? `Truck ${truckNumber}` : truck} On-site`;
      const href = closeoutOpsHref(date, jkNumber);
      const plainText = [
        `:truck: *${slackEscape(title)}*`,
        `*<${href}|${slackEscape(jkNumber)}>*`,
        formatTruckArrivalTime(arrival),
        slackEscape(customerName),
        slackPhoneLink(phone),
        slackEscape(address),
      ].filter(Boolean).join("\n");
      notifications.push({
        fingerprint,
        kind: "truck_arrival",
        lifecycle: "notification",
        severity: "warning",
        channelId: truckSlackChannelId(truck, channel("dispatch")),
        title: plainText,
        detail: "",
        nextAction: "",
        href: "",
        plainText,
      });
    }
  }

  return notifications.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
}

function collectIncidentAlerts(date: string): SlackOpsAlert[] {
  const report = buildOperationalExceptions(date);
  const alerts: SlackOpsAlert[] = [];
  for (const exception of report.exceptions) {
    if (
      exception.rule === "employee_clocked_in_but_not_assigned_to_truck"
      && slackAlertKindEnabled("unassigned_crew")
    ) {
      alerts.push(exceptionAlert(exception, "unassigned_crew"));
    }
    if (
      exception.rule === "open_appointment_past_scheduled_window"
      && slackAlertKindEnabled("late_job")
    ) {
      alerts.push(exceptionAlert(exception, "late_job"));
    }
  }

  for (const issue of readFleetIssueStore().issues) {
    if (issue.severity === "out_of_service" && issue.status !== "resolved") {
      alerts.push(fleetDownAlert(issue));
    }
  }

  const health = getDataHealthReport();
  for (const key of ["junkware", "linxup"] as const) {
    const source = health.sources[key];
    if (source.status === "red") alerts.push(staleDataAlert(source));
  }

  return alerts;
}

function parseSlackDetailLines(lines: string[]): Array<{ label: string; value: string }> {
  return lines.flatMap((line) => {
    const match = line.match(/^([^:]+):\s*(.*?)\.?$/);
    return match ? [{ label: match[1], value: match[2] }] : [];
  });
}

export function formatSlackAlert(alert: SlackOpsAlert): string {
  if (alert.plainText) return alert.plainText;
  const icon = alert.severity === "critical" ? ":rotating_light:" : ":warning:";
  return formatSlackMessage({
    icon,
    title: alert.title,
    fields: alert.fields,
    body: alert.detail,
    nextAction: alert.nextAction,
    href: alert.href,
  });
}

function slackAlertRunResult(date: string, dryRun: boolean, enabled: boolean, preview: SlackOpsAlert[]): SlackAlertRunResult {
  return {
    enabled,
    dryRun,
    date,
    bootstrappedAddOns: 0,
    bootstrappedCancellations: 0,
    bootstrappedIncidents: 0,
    bootstrappedTruckCloseouts: 0,
    bootstrappedPayments: 0,
    posted: [],
    resolved: [],
    unchanged: 0,
    failures: [],
    preview,
  };
}

async function postSlackMessage(
  token: string,
  channelId: string,
  text: string,
  threadTs?: string,
): Promise<SlackApiResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel: channelId,
        text,
        mrkdwn: true,
        unfurl_links: false,
        unfurl_media: false,
        ...(threadTs ? { thread_ts: threadTs } : {}),
      }),
      signal: controller.signal,
    });
    const payload = (await response.json().catch(() => ({ ok: false, error: `http_${response.status}` }))) as SlackApiResponse;
    if (!response.ok && payload.ok) return { ok: false, error: `http_${response.status}` };
    return payload;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Slack request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Publish the truck-channel closeout as part of a verified OpsCenter write.
 *
 * The regular collector remains the authoritative retry path. This fast path
 * exists so a successfully verified closeout is not delayed behind unrelated
 * GPS, payroll, accounting, marketing, and VPS refresh work.
 */
export async function publishVerifiedTruckCloseout(
  input: VerifiedTruckCloseout,
): Promise<VerifiedTruckCloseoutPublishResult> {
  if (!boolEnv("SLACK_OPSCENTER_ALERTS_ENABLED")) {
    return { attempted: false, posted: false, duplicate: false, reason: "Slack alerts are disabled." };
  }

  const appointmentId = String(input.appointmentId || "").trim();
  const jobNumber = String(input.jobNumber || "").trim();
  const truck = String(input.truck || "").trim();
  const truckNumber = normalizeSlackTruckNumber(truck);
  if (!appointmentId || !jobNumber || !truckNumber) {
    return { attempted: false, posted: false, duplicate: false, reason: "Verified closeout has no mapped truck or job number." };
  }

  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(input.date || ""))
    ? String(input.date)
    : chicagoDateKey();
  const fingerprint = `job_closed:${date}:appt-${appointmentId.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  const state = readState();
  const delivered = new Set(state.deliveredTruckCloseoutsByDate[date] || []);
  if (delivered.has(fingerprint)) return { attempted: false, posted: false, duplicate: true };

  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) return { attempted: false, posted: false, duplicate: false, reason: "Slack bot token is unavailable." };

  const sourceRow = readCompletedJunkwareRows(date).find((candidate) => (
    firstText(candidate, ["appt_id", "appointment_id", "appointmentId"]) === appointmentId
    || firstText(candidate, ["job_id", "jk_number", "job_number"]).toLowerCase() === jobNumber.toLowerCase()
  ));
  if (!sourceRow) {
    return {
      attempted: false,
      posted: false,
      duplicate: false,
      reason: "Closeout details are awaiting the verified JunkWare record.",
    };
  }
  if (!closeoutCustomer(sourceRow) || (!closeoutCrewMember(sourceRow, "driver") && !closeoutCrewMember(sourceRow, "navigator"))) {
    return {
      attempted: false,
      posted: false,
      duplicate: false,
      reason: "Closeout customer and crew details are awaiting the verified JunkWare record.",
    };
  }

  const row: AnyRecord = {
    ...sourceRow,
    appt_id: appointmentId,
    job_id: jobNumber,
    truck,
    job_status: "Complete",
    closeout: input.closeout,
  };
  const [alert] = buildTruckCloseoutSlackNotifications(date, [row]);
  if (!alert) return { attempted: false, posted: false, duplicate: false, reason: "Verified closeout could not be formatted." };

  const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
  if (!response.ok || !response.ts) {
    return { attempted: true, posted: false, duplicate: false, reason: response.error || "Slack did not return a message timestamp." };
  }

  delivered.add(fingerprint);
  state.truckCloseoutNotificationsInitializedAt ||= new Date().toISOString();
  state.deliveredTruckCloseoutsByDate[date] = Array.from(delivered);
  state.deliveredTruckCloseoutsByDate = pruneTruckCloseoutDates(state.deliveredTruckCloseoutsByDate);
  state.updatedAt = new Date().toISOString();
  writeState(state);
  return { attempted: true, posted: true, duplicate: false };
}

async function runTruckArrivalSlackAlerts(options: {
  date: string;
  dryRun: boolean;
  enabled: boolean;
}): Promise<SlackAlertRunResult> {
  const { date, dryRun, enabled } = options;
  const state = readState();
  const allNotifications = buildTruckArrivalSlackNotifications(date, readTruckArrivalVisitRows(date));
  const initialized = Boolean(state.truckArrivalNotificationsInitializedAt);
  const delivered = new Set(state.deliveredTruckArrivalsByDate[date] || []);
  const pending = initialized
    ? allNotifications.filter((alert) => !delivered.has(alert.fingerprint))
    : [];
  const result = slackAlertRunResult(
    date,
    dryRun,
    enabled,
    initialized ? pending : allNotifications,
  );

  if (dryRun || !enabled) return result;

  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN is required when Slack OpsCenter alerts are enabled.");

  const now = new Date().toISOString();
  if (!initialized) {
    state.truckArrivalNotificationsInitializedAt = now;
    state.deliveredTruckArrivalsByDate[date] = allNotifications.map((alert) => alert.fingerprint);
    state.deliveredTruckArrivalsByDate = pruneTruckArrivalDates(state.deliveredTruckArrivalsByDate);
    state.updatedAt = now;
    writeState(state);
    return result;
  }

  for (const alert of pending) {
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    delivered.add(alert.fingerprint);
    result.posted.push(alert);
  }

  state.deliveredTruckArrivalsByDate[date] = Array.from(delivered);
  state.deliveredTruckArrivalsByDate = pruneTruckArrivalDates(state.deliveredTruckArrivalsByDate);
  state.updatedAt = now;
  writeState(state);
  return result;
}

export async function runSlackOpsAlerts(options?: {
  date?: string;
  dryRun?: boolean;
  onlyKinds?: SlackAlertKind[];
}): Promise<SlackAlertRunResult> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.date || ""))
    ? String(options?.date)
    : chicagoDateKey();
  const dryRun = Boolean(options?.dryRun);
  const enabled = boolEnv("SLACK_OPSCENTER_ALERTS_ENABLED");
  const onlyKinds = new Set(options?.onlyKinds || []);
  if (onlyKinds.size) {
    if (onlyKinds.size !== 1 || !onlyKinds.has("truck_arrival")) {
      throw new Error("Only truck_arrival can be published independently.");
    }
    return runTruckArrivalSlackAlerts({ date, dryRun, enabled });
  }
  const state = readState();
  const incidents = collectIncidentAlerts(date);
  const feed = buildAddOnAppointmentFeed(date);
  const cancellationFeed = buildCancelledAppointmentFeed(date);
  const allCrewNotifications = buildCrewSlackNotifications(date, crewRows(readMetrics(date)));
  const crewNotificationsInitialized = Boolean(state.crewNotificationsInitializedAt);
  const deliveredCrewNotifications = new Set(state.deliveredCrewNotificationsByDate[date] || []);
  const crewNotifications = crewNotificationsInitialized
    ? allCrewNotifications.filter((alert) => !deliveredCrewNotifications.has(alert.fingerprint))
    : [];
  const allTruckArrivalNotifications = buildTruckArrivalSlackNotifications(date, readTruckArrivalVisitRows(date));
  const truckArrivalNotificationsInitialized = Boolean(state.truckArrivalNotificationsInitializedAt);
  const deliveredTruckArrivals = new Set(state.deliveredTruckArrivalsByDate[date] || []);
  const truckArrivalNotifications = truckArrivalNotificationsInitialized
    ? allTruckArrivalNotifications.filter((alert) => !deliveredTruckArrivals.has(alert.fingerprint))
    : [];
  const completedRows = readCompletedJunkwareRows(date);
  const allTruckCloseoutNotifications = buildTruckCloseoutSlackNotifications(date, completedRows);
  const truckCloseoutNotificationsInitialized = Boolean(state.truckCloseoutNotificationsInitializedAt);
  const deliveredTruckCloseouts = new Set([
    ...(state.deliveredTruckCloseoutsByDate[date] || []),
    ...deliveredFastScheduleCloseouts(date),
  ]);
  const truckCloseoutNotifications = truckCloseoutNotificationsInitialized
    ? allTruckCloseoutNotifications.filter((alert) => !deliveredTruckCloseouts.has(alert.fingerprint))
    : [];
  const allPaymentNotifications = buildPaymentCloseoutSlackNotifications(date, completedRows);
  const paymentNotificationsInitialized = Boolean(state.paymentNotificationsInitializedAt);
  const deliveredPaymentNotifications = new Set(state.deliveredPaymentNotificationsByDate[date] || []);
  const paymentNotifications = paymentNotificationsInitialized
    ? allPaymentNotifications.filter((alert) => !deliveredPaymentNotifications.has(alert.fingerprint))
    : [];
  const hadAppointmentBaseline = Object.prototype.hasOwnProperty.call(state.knownAppointmentsByDate, date);
  const hadCancellationBaseline = Object.prototype.hasOwnProperty.call(state.knownCancellationsByDate, date);
  const knownAppointments = new Set(state.knownAppointmentsByDate[date] || []);
  const knownCancellations = new Set(state.knownCancellationsByDate[date] || []);
  const additions = hadAppointmentBaseline
    ? feed.appointments.filter((appointment) => !knownAppointments.has(appointment.id))
    : [];
  const cancellations = hadCancellationBaseline
    ? cancellationFeed.appointments.filter((appointment) => !knownCancellations.has(appointment.id))
    : [];
  const notificationDeliveries = [
    ...additions.map((appointment) => ({
      appointmentId: appointment.id,
      stateKind: "addition" as const,
      alert: buildAddOnSlackNotification(appointment, date),
    })),
    ...cancellations.map((appointment) => ({
      appointmentId: appointment.id,
      stateKind: "cancellation" as const,
      alert: buildCancellationSlackNotification(appointment, date),
    })),
  ];
  const notifications = notificationDeliveries.map(({ alert }) => alert);
  const preview = [
    ...incidents,
    ...notifications,
    ...(truckArrivalNotificationsInitialized ? truckArrivalNotifications : allTruckArrivalNotifications),
    ...(truckCloseoutNotificationsInitialized ? truckCloseoutNotifications : allTruckCloseoutNotifications),
    ...(crewNotificationsInitialized ? crewNotifications : allCrewNotifications),
    ...(paymentNotificationsInitialized ? paymentNotifications : allPaymentNotifications),
  ];

  const result: SlackAlertRunResult = {
    enabled,
    dryRun,
    date,
    bootstrappedAddOns: hadAppointmentBaseline ? 0 : feed.appointments.length,
    bootstrappedCancellations: hadCancellationBaseline ? 0 : cancellationFeed.appointments.length,
    bootstrappedIncidents: state.initializedAt ? 0 : incidents.length,
    bootstrappedTruckCloseouts: truckCloseoutNotificationsInitialized ? 0 : allTruckCloseoutNotifications.length,
    bootstrappedPayments: paymentNotificationsInitialized ? 0 : allPaymentNotifications.length,
    posted: [],
    resolved: [],
    unchanged: 0,
    failures: [],
    preview,
  };

  if (dryRun) return result;
  if (!enabled) return result;

  const token = String(process.env.SLACK_BOT_TOKEN || "").trim();
  if (!token) throw new Error("SLACK_BOT_TOKEN is required when Slack OpsCenter alerts are enabled.");

  const now = new Date().toISOString();
  const currentFingerprints = new Set(incidents.map((alert) => alert.fingerprint));
  if (!crewNotificationsInitialized) {
    state.crewNotificationsInitializedAt = now;
    state.deliveredCrewNotificationsByDate[date] = allCrewNotifications.map((alert) => alert.fingerprint);
    for (const alert of allCrewNotifications) deliveredCrewNotifications.add(alert.fingerprint);
    state.deliveredCrewNotificationsByDate = pruneCrewNotificationDates(state.deliveredCrewNotificationsByDate);
  }
  if (!truckArrivalNotificationsInitialized) {
    state.truckArrivalNotificationsInitializedAt = now;
    state.deliveredTruckArrivalsByDate[date] = allTruckArrivalNotifications.map((alert) => alert.fingerprint);
    for (const alert of allTruckArrivalNotifications) deliveredTruckArrivals.add(alert.fingerprint);
    state.deliveredTruckArrivalsByDate = pruneTruckArrivalDates(state.deliveredTruckArrivalsByDate);
  }
  if (!truckCloseoutNotificationsInitialized) {
    state.truckCloseoutNotificationsInitializedAt = now;
    state.deliveredTruckCloseoutsByDate[date] = allTruckCloseoutNotifications.map((alert) => alert.fingerprint);
    for (const alert of allTruckCloseoutNotifications) deliveredTruckCloseouts.add(alert.fingerprint);
    state.deliveredTruckCloseoutsByDate = pruneTruckCloseoutDates(state.deliveredTruckCloseoutsByDate);
  }
  if (!paymentNotificationsInitialized) {
    state.paymentNotificationsInitializedAt = now;
    state.deliveredPaymentNotificationsByDate[date] = allPaymentNotifications.map((alert) => alert.fingerprint);
    for (const alert of allPaymentNotifications) deliveredPaymentNotifications.add(alert.fingerprint);
    state.deliveredPaymentNotificationsByDate = prunePaymentNotificationDates(state.deliveredPaymentNotificationsByDate);
  }
  for (const [fingerprint, active] of Object.entries(state.active)) {
    if (!slackAlertKindEnabled(active.kind)) delete state.active[fingerprint];
  }
  if (!state.initializedAt) {
    state.initializedAt = now;
    state.updatedAt = now;
    state.suppressedIncidentFingerprints = Array.from(currentFingerprints);
    state.knownAppointmentsByDate[date] = feed.appointments.map((appointment) => appointment.id);
    state.knownCancellationsByDate[date] = cancellationFeed.appointments.map((appointment) => appointment.id);
    state.knownAppointmentsByDate = pruneAppointmentDates(state.knownAppointmentsByDate);
    state.knownCancellationsByDate = pruneAppointmentDates(state.knownCancellationsByDate);
    writeState(state);
    return result;
  }

  const suppressedIncidents = new Set(state.suppressedIncidentFingerprints);

  for (const alert of incidents) {
    if (suppressedIncidents.has(alert.fingerprint)) {
      result.unchanged += 1;
      continue;
    }
    const existing = state.active[alert.fingerprint];
    if (existing) {
      state.active[alert.fingerprint] = { ...existing, lastSeenAt: now };
      result.unchanged += 1;
      continue;
    }

    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    state.active[alert.fingerprint] = {
      fingerprint: alert.fingerprint,
      kind: alert.kind,
      channelId: alert.channelId,
      threadTs: response.ts,
      openedAt: now,
      lastSeenAt: now,
    };
    result.posted.push(alert);
  }

  state.suppressedIncidentFingerprints = state.suppressedIncidentFingerprints.filter((fingerprint) =>
    currentFingerprints.has(fingerprint),
  );

  for (const [fingerprint, active] of Object.entries(state.active)) {
    if (currentFingerprints.has(fingerprint)) continue;
    const response = await postSlackMessage(
      token,
      active.channelId,
      `:white_check_mark: *Resolved in OpsCenter*\n_${now}_`,
      active.threadTs,
    );
    if (!response.ok) {
      result.failures.push({ fingerprint, error: response.error || "Unable to post recovery notice" });
      continue;
    }
    delete state.active[fingerprint];
    result.resolved.push(active);
  }

  const deliveredAppointmentIds = new Set<string>();
  const deliveredCancellationIds = new Set<string>();
  for (const delivery of notificationDeliveries) {
    const { alert } = delivery;
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    if (delivery.stateKind === "addition") deliveredAppointmentIds.add(delivery.appointmentId);
    else deliveredCancellationIds.add(delivery.appointmentId);
    result.posted.push(alert);
  }

  for (const alert of crewNotifications) {
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    deliveredCrewNotifications.add(alert.fingerprint);
    result.posted.push(alert);
  }

  for (const alert of truckArrivalNotifications) {
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    deliveredTruckArrivals.add(alert.fingerprint);
    result.posted.push(alert);
  }

  for (const alert of truckCloseoutNotifications) {
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    deliveredTruckCloseouts.add(alert.fingerprint);
    result.posted.push(alert);
  }

  for (const alert of paymentNotifications) {
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    deliveredPaymentNotifications.add(alert.fingerprint);
    result.posted.push(alert);
  }

  if (!hadAppointmentBaseline) {
    state.knownAppointmentsByDate[date] = feed.appointments.map((appointment) => appointment.id);
  } else {
    state.knownAppointmentsByDate[date] = Array.from(new Set([
      ...knownAppointments,
      ...deliveredAppointmentIds,
    ]));
  }
  if (!hadCancellationBaseline) {
    state.knownCancellationsByDate[date] = cancellationFeed.appointments.map((appointment) => appointment.id);
  } else {
    state.knownCancellationsByDate[date] = Array.from(new Set([
      ...knownCancellations,
      ...deliveredCancellationIds,
    ]));
  }
  state.knownAppointmentsByDate = pruneAppointmentDates(state.knownAppointmentsByDate);
  state.knownCancellationsByDate = pruneAppointmentDates(state.knownCancellationsByDate);
  state.deliveredCrewNotificationsByDate[date] = Array.from(deliveredCrewNotifications);
  state.deliveredCrewNotificationsByDate = pruneCrewNotificationDates(state.deliveredCrewNotificationsByDate);
  state.deliveredTruckArrivalsByDate[date] = Array.from(deliveredTruckArrivals);
  state.deliveredTruckArrivalsByDate = pruneTruckArrivalDates(state.deliveredTruckArrivalsByDate);
  state.deliveredTruckCloseoutsByDate[date] = Array.from(deliveredTruckCloseouts);
  state.deliveredTruckCloseoutsByDate = pruneTruckCloseoutDates(state.deliveredTruckCloseoutsByDate);
  state.deliveredPaymentNotificationsByDate[date] = Array.from(deliveredPaymentNotifications);
  state.deliveredPaymentNotificationsByDate = prunePaymentNotificationDates(state.deliveredPaymentNotificationsByDate);
  state.updatedAt = now;
  writeState(state);
  return result;
}
