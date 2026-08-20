import fs from "fs";
import path from "path";
import { buildAddOnAppointmentFeed, type AddOnAppointment } from "@/lib/add-on-notifications";
import { getDataHealthReport, type DataHealthSource } from "@/lib/data-health";
import { readFleetIssueStore, type FleetIssue } from "@/lib/fleet-issues";
import { buildOperationalExceptions, type OperationalException } from "@/lib/operational-exceptions";
import { chicagoDateKey } from "@/lib/report-dates";

export type SlackAlertSeverity = "critical" | "warning";
export type SlackAlertKind = "add_on" | "unassigned_crew" | "late_job" | "fleet_down" | "stale_data";

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
  version: 1;
  initializedAt: string;
  updatedAt: string;
  active: Record<string, ActiveSlackAlert>;
  suppressedIncidentFingerprints: string[];
  knownAppointmentsByDate: Record<string, string[]>;
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
  bootstrappedIncidents: number;
  posted: SlackOpsAlert[];
  resolved: ActiveSlackAlert[];
  unchanged: number;
  failures: Array<{ fingerprint: string; error: string }>;
  preview: SlackOpsAlert[];
};

const DEFAULT_CHANNELS = {
  crew: "C0BNSDSK89M",
  appointments: "C0BQ294DYHW",
  dispatch: "C0BNRMD25AS",
  fleet: "C0BNQ6J7LER",
  dataHealth: "C0BPN1FVCDN",
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
    version: 1,
    initializedAt: "",
    updatedAt: "",
    active: {},
    suppressedIncidentFingerprints: [],
    knownAppointmentsByDate: {},
  };
}

function readState(): SlackAlertState {
  try {
    const payload = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    return {
      version: 1,
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
    };
  } catch {
    return emptyState();
  }
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

function channel(name: keyof typeof DEFAULT_CHANNELS): string {
  const envNames: Record<keyof typeof DEFAULT_CHANNELS, string> = {
    crew: "SLACK_CREW_CHANNEL_ID",
    appointments: "SLACK_APPOINTMENTS_CHANNEL_ID",
    dispatch: "SLACK_OPS_DISPATCH_CHANNEL_ID",
    fleet: "SLACK_OPS_FLEET_CHANNEL_ID",
    dataHealth: "SLACK_OPS_DATA_HEALTH_CHANNEL_ID",
  };
  return String(process.env[envNames[name]] || DEFAULT_CHANNELS[name]).trim();
}

function origin(): string {
  return String(process.env.SLACK_OPSCENTER_BASE_URL || "https://ops.junk-king.app").replace(/\/$/, "");
}

function absoluteOpsHref(href: string): string {
  if (/^https?:\/\//i.test(href)) return href;
  return `${origin()}${href.startsWith("/") ? href : `/${href}`}`;
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
    channelId: channel(isUnassigned ? "crew" : "appointments"),
    title: exception.title,
    detail: exception.reason,
    nextAction: isUnassigned
      ? "Assign the employee to the correct truck or confirm that the shift should be ended."
      : "Confirm the crew status and close, reschedule, or update the appointment.",
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

function addOnAlert(appointment: AddOnAppointment, date: string): SlackOpsAlert {
  return {
    fingerprint: `add_on:${date}:${appointment.id}`,
    kind: "add_on",
    lifecycle: "notification",
    severity: "warning",
    channelId: channel("appointments"),
    title: `New Appointment: ${appointment.jobNumber}`,
    detail: `${appointment.customerName}\n${appointment.address}`,
    nextAction: "Confirm crew and truck coverage, then update the route plan.",
    href: absoluteOpsHref(appointment.href),
  };
}

function collectIncidentAlerts(date: string): SlackOpsAlert[] {
  const report = buildOperationalExceptions(date);
  const alerts: SlackOpsAlert[] = [];
  for (const exception of report.exceptions) {
    if (exception.rule === "employee_clocked_in_but_not_assigned_to_truck") {
      alerts.push(exceptionAlert(exception, "unassigned_crew"));
    }
    if (exception.rule === "open_appointment_past_scheduled_window") {
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

function slackEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function formatSlackAlert(alert: SlackOpsAlert): string {
  const icon = alert.severity === "critical" ? ":rotating_light:" : ":warning:";
  const iconTitleSeparator = alert.kind === "add_on" ? "" : " ";
  return [
    `${icon}${iconTitleSeparator}*${slackEscape(alert.title)}*`,
    slackEscape(alert.detail),
    `<${alert.href}|Open in OpsCenter>`,
    `_Alert ID: ${slackEscape(alert.fingerprint)}_`,
  ].join("\n");
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

export async function runSlackOpsAlerts(options?: {
  date?: string;
  dryRun?: boolean;
}): Promise<SlackAlertRunResult> {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(options?.date || ""))
    ? String(options?.date)
    : chicagoDateKey();
  const dryRun = Boolean(options?.dryRun);
  const enabled = boolEnv("SLACK_OPSCENTER_ALERTS_ENABLED");
  const state = readState();
  const incidents = collectIncidentAlerts(date);
  const feed = buildAddOnAppointmentFeed(date);
  const hadAppointmentBaseline = Object.prototype.hasOwnProperty.call(state.knownAppointmentsByDate, date);
  const knownAppointments = new Set(state.knownAppointmentsByDate[date] || []);
  const additions = hadAppointmentBaseline
    ? feed.appointments.filter((appointment) => !knownAppointments.has(appointment.id))
    : [];
  const notifications = additions.map((appointment) => addOnAlert(appointment, date));
  const preview = [...incidents, ...notifications];

  const result: SlackAlertRunResult = {
    enabled,
    dryRun,
    date,
    bootstrappedAddOns: hadAppointmentBaseline ? 0 : feed.appointments.length,
    bootstrappedIncidents: state.initializedAt ? 0 : incidents.length,
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
  if (!state.initializedAt) {
    state.initializedAt = now;
    state.updatedAt = now;
    state.suppressedIncidentFingerprints = Array.from(currentFingerprints);
    state.knownAppointmentsByDate[date] = feed.appointments.map((appointment) => appointment.id);
    state.knownAppointmentsByDate = pruneAppointmentDates(state.knownAppointmentsByDate);
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
  for (const alert of notifications) {
    const response = await postSlackMessage(token, alert.channelId, formatSlackAlert(alert));
    if (!response.ok || !response.ts) {
      result.failures.push({ fingerprint: alert.fingerprint, error: response.error || "Slack did not return a message timestamp" });
      continue;
    }
    deliveredAppointmentIds.add(alert.fingerprint.replace(`add_on:${date}:`, ""));
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
  state.knownAppointmentsByDate = pruneAppointmentDates(state.knownAppointmentsByDate);
  state.updatedAt = now;
  writeState(state);
  return result;
}
