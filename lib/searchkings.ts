import fs from "node:fs";
import path from "node:path";
import { addDays } from "@/lib/report-dates";
import { money, readMetrics, type AnyRecord } from "@/lib/opsData";

export type SearchKingsMetric = {
  id: number;
  order: number;
  label: string;
  labelHelpText?: string;
  value: number;
  type: "currency" | "percent" | "number" | string;
  positiveState?: string;
  chartData?: {
    labels?: string[];
    datasets?: Array<{ label: string; data: Array<number | null> }>;
  };
};

export type SearchKingsAccount = {
  id: string;
  name: string;
  type: string;
  status?: string;
  hasMetrics?: boolean;
  metrics: SearchKingsMetric[];
  metadata?: AnyRecord | null;
};

export type SearchKingsCall = {
  id: string;
  name: string;
  callerNumberFormat?: string | null;
  callerNumberComplete?: string | null;
  status?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  source?: string | null;
  score?: number | null;
  tagList: string[];
  conversion?: boolean | null;
  reportingTag?: string | null;
  trackingLabel?: string | null;
  conversionValue?: number | null;
  duration: string;
  calledAtDate: string;
  calledAtTime: string;
  conversionValueFormat?: string | null;
  lsaLeadId?: number | null;
};

export type SearchKingsCallQuality = {
  label: "Bad Leads" | "Unknown Leads" | "Relevant Leads" | "Great Leads" | string;
  currentTotalCalls: number;
  currentCallPercentage: number;
  comparisonTotalCalls?: number;
  trend?: number;
};

export type SearchKingsSnapshot = {
  version: 1;
  source: "searchkings_reports_api" | "searchkings_signed_in_report";
  fetchedAt: string;
  customerId: string;
  customerName?: string;
  range: {
    startDate: string;
    endDate: string;
    timezone: string;
    label?: string;
  };
  accounts: SearchKingsAccount[];
  calls: {
    range?: AnyRecord;
    total?: {
      currentScoredCalls?: number;
      currentCalls?: number;
    };
    callsQuality: SearchKingsCallQuality[];
    sources?: string[];
    labels?: string[];
    tags?: string[];
    calls: SearchKingsCall[];
  };
};

export type LostLeadStatus =
  | "needs_follow_up"
  | "booked"
  | "lost"
  | "recovered"
  | "unqualified";

export type LostLeadReason =
  | "availability"
  | "pricing"
  | "missed_call"
  | "no_follow_up"
  | "competitor"
  | "out_of_area"
  | "service_not_offered"
  | "customer_declined"
  | "other"
  | "";

export type LostLeadOverride = {
  callId: string;
  status: LostLeadStatus;
  reason: LostLeadReason;
  note: string;
  franchiseContacted: boolean;
  updatedAt: string;
  updatedBy: string;
};

type LostLeadStore = {
  version: 1;
  updatedAt: string;
  entries: LostLeadOverride[];
};

export type SearchKingsAppointmentMatch = {
  date: string;
  appointmentId: string;
  jobId: string;
  customerName: string;
  phone: string;
  territory: string;
  revenue: number;
  status: string;
};

export type SearchKingsLead = {
  callId: string;
  calledAt: string;
  calledDate: string;
  callerName: string;
  phone: string;
  city: string;
  territory: string;
  source: string;
  trackingLabel: string;
  score: number | null;
  summary: string;
  tags: string[];
  qualified: boolean;
  status: LostLeadStatus;
  reason: LostLeadReason;
  note: string;
  franchiseContacted: boolean;
  potentialRevenue: number;
  matchedAppointment: SearchKingsAppointmentMatch | null;
  searchKingsUrl: string;
  updatedAt: string;
};

export type SearchKingsTerritoryRow = {
  territory: string;
  spend: number;
  conversions: number;
  costPerConversion: number;
  qualifiedCalls: number;
  bookedJobs: number;
  attributedRevenue: number;
  lostLeads: number;
};

export type SearchKingsView = {
  available: boolean;
  error?: string;
  snapshot: SearchKingsSnapshot | null;
  rangeLabel: string;
  spend: number;
  platformConversions: number;
  costPerConversion: number;
  totalCalls: number;
  scoredCalls: number;
  qualifiedCalls: number;
  qualifiedRate: number;
  bookedJobs: number;
  attributedRevenue: number;
  costPerBookedJob: number;
  roas: number;
  lostLeads: number;
  needsFollowUp: number;
  recoveredLeads: number;
  estimatedLostRevenue: number;
  accountRows: Array<{
    id: string;
    name: string;
    type: string;
    territory: string;
    spend: number;
    conversions: number;
    costPerConversion: number;
    responsiveness: number | null;
    impressions: number | null;
    clicks: number | null;
    absoluteTopImpressionShare: number | null;
  }>;
  territoryRows: SearchKingsTerritoryRow[];
  qualityRows: SearchKingsCallQuality[];
  leads: SearchKingsLead[];
};

const CUSTOMER_ID = String(process.env.SEARCHKINGS_CUSTOMER_ID || "SKC1002034843").trim();
const DEFAULT_TIMEZONE = "America/Chicago";
const LOST_AFTER_HOURS = Math.max(
  1,
  Math.min(24 * 30, Number(process.env.SEARCHKINGS_LOST_AFTER_HOURS || 72)),
);
const QUALIFIED_SCORE = Math.max(
  1,
  Math.min(5, Number(process.env.SEARCHKINGS_QUALIFIED_SCORE || 3)),
);

function dataRoots(): string[] {
  const configured = String(process.env.OPSBOT_DATA_DIR || "").trim();
  return [
    configured,
    path.join(process.cwd(), "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ].filter(Boolean);
}

function snapshotCandidates(monthKey?: string): string[] {
  const names = monthKey
    ? [path.join("history", "searchkings", `searchkings_${monthKey}.json`)]
    : [path.join("searchkings", "current.json")];
  return dataRoots().flatMap((root) => names.map((name) => path.join(root, name)));
}

function lostLeadStorePath(): string {
  return path.join(process.cwd(), "data", "searchkings-overrides", "lost-leads.json");
}

function validDateKey(value: unknown): value is string {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ""));
}

function finiteNumber(value: unknown): number {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function normalizedPhone(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (digits.length < 10) return "";
  return digits.slice(-10);
}

function callFingerprintHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function canonicalSearchKingsCallId(call: SearchKingsCall): string {
  const fingerprint = [
    parseCalledDate(call),
    String(call.calledAtTime || "").trim().toLowerCase(),
    normalizedPhone(call.callerNumberComplete || call.callerNumberFormat),
    String(call.duration || "").trim(),
  ].join("|");
  return `sk-${callFingerprintHash(fingerprint)}`;
}

function moneyNumber(value: unknown): number {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? finiteNumber(match[0]) : 0;
}

function metricValue(account: SearchKingsAccount, label: string): number {
  const normalized = label.trim().toLowerCase();
  return finiteNumber(
    account.metrics.find((metric) => metric.label.trim().toLowerCase() === normalized)?.value,
  );
}

function optionalMetricValue(account: SearchKingsAccount, label: string): number | null {
  const normalized = label.trim().toLowerCase();
  const metric = account.metrics.find((item) => item.label.trim().toLowerCase() === normalized);
  return metric ? finiteNumber(metric.value) : null;
}

export function normalizeSearchKingsTerritory(value: unknown): string {
  const raw = String(value || "").trim();
  const normalized = raw.toLowerCase().replace(/[^a-z0-9]+/g, " ");
  if (normalized.includes("baton rouge")) return "Baton Rouge";
  if (normalized.includes("jefferson parish") || normalized.includes("jefferson parrish")) {
    return "Jefferson Parish";
  }
  if (normalized.includes("north shore") || normalized.includes("northshore")) return "Northshore";
  if (normalized.includes("new orleans")) return "New Orleans";
  return raw || "Unassigned";
}

function territoryForAccount(account: SearchKingsAccount): string {
  return normalizeSearchKingsTerritory(account.name);
}

function territoryForCall(call: SearchKingsCall): string {
  const knownTerritories = new Set(["Baton Rouge", "Jefferson Parish", "Northshore", "New Orleans"]);
  for (const candidate of [call.trackingLabel, call.source, call.city]) {
    const territory = normalizeSearchKingsTerritory(candidate);
    if (knownTerritories.has(territory)) return territory;
  }
  return normalizeSearchKingsTerritory(call.city);
}

function parseCalledDate(call: SearchKingsCall): string {
  const direct = String(call.calledAtDate || "").trim();
  if (validDateKey(direct)) return direct;
  const parsed = new Date(`${direct} ${String(call.calledAtTime || "").trim()}`.trim());
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function parseCalledAt(call: SearchKingsCall): string {
  const date = parseCalledDate(call);
  if (!date) return "";
  const raw = `${date} ${String(call.calledAtTime || "").trim()}`.trim();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? `${date}T12:00:00.000Z` : parsed.toISOString();
}

function inferredReason(call: SearchKingsCall): LostLeadReason {
  const text = [call.reportingTag, ...(call.tagList || [])].join(" ").toLowerCase();
  if (text.includes("availability")) return "availability";
  if (text.includes("pricing") || text.includes("price")) return "pricing";
  if (text.includes("missed") || text.includes("unanswered")) return "missed_call";
  if (text.includes("out of area")) return "out_of_area";
  if (text.includes("service not offered")) return "service_not_offered";
  if (text.includes("competitor")) return "competitor";
  return "";
}

function emptyStore(): LostLeadStore {
  return { version: 1, updatedAt: "", entries: [] };
}

function readLostLeadStore(): LostLeadStore {
  try {
    const file = lostLeadStorePath();
    if (!fs.existsSync(file)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const entries = (Array.isArray(payload?.entries) ? payload.entries : [])
      .map((entry: AnyRecord): LostLeadOverride | null => {
        const callId = String(entry.callId || "").trim();
        const status = String(entry.status || "") as LostLeadStatus;
        if (!callId || !["needs_follow_up", "booked", "lost", "recovered", "unqualified"].includes(status)) {
          return null;
        }
        return {
          callId,
          status,
          reason: String(entry.reason || "") as LostLeadReason,
          note: String(entry.note || "").slice(0, 1000),
          franchiseContacted: entry.franchiseContacted === true,
          updatedAt: String(entry.updatedAt || ""),
          updatedBy: String(entry.updatedBy || ""),
        };
      })
      .filter((entry: LostLeadOverride | null): entry is LostLeadOverride => Boolean(entry));
    return { version: 1, updatedAt: String(payload?.updatedAt || ""), entries };
  } catch {
    return emptyStore();
  }
}

function writeLostLeadStore(store: LostLeadStore): void {
  const file = lostLeadStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

export function saveLostLeadOverride(input: {
  callId: string;
  status: LostLeadStatus;
  reason?: LostLeadReason;
  note?: string;
  franchiseContacted?: boolean;
  updatedBy: string;
}): LostLeadOverride | null {
  const callId = String(input.callId || "").trim();
  const status = String(input.status || "") as LostLeadStatus;
  if (!callId || callId.length > 200 || !["needs_follow_up", "booked", "lost", "recovered", "unqualified"].includes(status)) {
    return null;
  }
  const allowedReasons = [
    "",
    "availability",
    "pricing",
    "missed_call",
    "no_follow_up",
    "competitor",
    "out_of_area",
    "service_not_offered",
    "customer_declined",
    "other",
  ];
  const reason = allowedReasons.includes(String(input.reason || ""))
    ? String(input.reason || "") as LostLeadReason
    : "other";
  const saved: LostLeadOverride = {
    callId,
    status,
    reason,
    note: String(input.note || "").trim().slice(0, 1000),
    franchiseContacted: input.franchiseContacted === true,
    updatedAt: new Date().toISOString(),
    updatedBy: String(input.updatedBy || "").trim().slice(0, 320),
  };
  const store = readLostLeadStore();
  const entries = store.entries.filter((entry) => entry.callId !== callId);
  entries.push(saved);
  entries.sort((a, b) => a.callId.localeCompare(b.callId));
  writeLostLeadStore({ version: 1, updatedAt: saved.updatedAt, entries });
  return saved;
}

export function readSearchKingsSnapshot(monthKey?: string): SearchKingsSnapshot | null {
  for (const file of snapshotCandidates(monthKey)) {
    try {
      if (!fs.existsSync(file)) continue;
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      if (
        payload?.version !== 1
        || !["searchkings_reports_api", "searchkings_signed_in_report"].includes(payload?.source)
      ) continue;
      if (!Array.isArray(payload.accounts) || !Array.isArray(payload?.calls?.calls)) continue;
      return payload as SearchKingsSnapshot;
    } catch {
      // Keep checking the other mirrored data roots.
    }
  }
  return null;
}

function dateKeys(start: string, end: string): string[] {
  if (!validDateKey(start) || !validDateKey(end) || start > end) return [];
  const keys: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) keys.push(cursor);
  return keys;
}

function appointmentRows(start: string, end: string): SearchKingsAppointmentMatch[] {
  const rows: SearchKingsAppointmentMatch[] = [];
  for (const date of dateKeys(start, addDays(end, 7))) {
    const metrics = readMetrics(date);
    const appointments = Array.isArray(metrics?.appointments) ? metrics.appointments : [];
    for (const appointment of appointments) {
      const phone = normalizedPhone(
        appointment?.customer_phone || appointment?.phone || appointment?.phone_number,
      );
      if (!phone) continue;
      rows.push({
        date,
        appointmentId: String(appointment?.appt_id || appointment?.appointment_id || ""),
        jobId: String(appointment?.job_id || appointment?.jk_number || ""),
        customerName: String(appointment?.customer_name || appointment?.customer || ""),
        phone,
        territory: normalizeSearchKingsTerritory(
          appointment?.normalized_territory || appointment?.territory || appointment?.market,
        ),
        revenue: roundMoney(moneyNumber(appointment?.revenue || appointment?.amount)),
        status: String(appointment?.job_status || appointment?.status || ""),
      });
    }
  }
  return rows;
}

function averageRevenueByTerritory(appointments: SearchKingsAppointmentMatch[]): Map<string, number> {
  const totals = new Map<string, { revenue: number; jobs: number }>();
  for (const appointment of appointments) {
    if (appointment.revenue <= 0) continue;
    const current = totals.get(appointment.territory) || { revenue: 0, jobs: 0 };
    current.revenue += appointment.revenue;
    current.jobs += 1;
    totals.set(appointment.territory, current);
  }
  return new Map(
    Array.from(totals.entries()).map(([territory, value]) => [
      territory,
      value.jobs ? roundMoney(value.revenue / value.jobs) : 0,
    ]),
  );
}

function matchAppointment(
  call: SearchKingsCall,
  appointments: SearchKingsAppointmentMatch[],
): SearchKingsAppointmentMatch | null {
  const phone = normalizedPhone(call.callerNumberComplete || call.callerNumberFormat);
  const calledDate = parseCalledDate(call);
  if (!phone || !calledDate) return null;
  return appointments
    .filter((appointment) => appointment.phone === phone && appointment.date >= calledDate && appointment.date <= addDays(calledDate, 7))
    .sort((left, right) => left.date.localeCompare(right.date))[0] || null;
}

function formatRange(snapshot: SearchKingsSnapshot): string {
  const start = new Date(`${snapshot.range.startDate}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  const end = new Date(`${snapshot.range.endDate}T12:00:00Z`).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${start} – ${end}`;
}

function emptyView(error: string): SearchKingsView {
  return {
    available: false,
    error,
    snapshot: null,
    rangeLabel: "Unavailable",
    spend: 0,
    platformConversions: 0,
    costPerConversion: 0,
    totalCalls: 0,
    scoredCalls: 0,
    qualifiedCalls: 0,
    qualifiedRate: 0,
    bookedJobs: 0,
    attributedRevenue: 0,
    costPerBookedJob: 0,
    roas: 0,
    lostLeads: 0,
    needsFollowUp: 0,
    recoveredLeads: 0,
    estimatedLostRevenue: 0,
    accountRows: [],
    territoryRows: [],
    qualityRows: [],
    leads: [],
  };
}

export function buildSearchKingsViewFromData(
  snapshot: SearchKingsSnapshot,
  appointments: SearchKingsAppointmentMatch[],
  overrides: LostLeadOverride[],
  now = new Date(),
): SearchKingsView {
  const overrideByCall = new Map(overrides.map((entry) => [entry.callId, entry]));
  const territoryAverages = averageRevenueByTerritory(appointments);
  const allRevenue = appointments.reduce((sum, appointment) => sum + appointment.revenue, 0);
  const revenueJobs = appointments.filter((appointment) => appointment.revenue > 0).length;
  const overallAverage = revenueJobs ? roundMoney(allRevenue / revenueJobs) : 0;

  const leads = snapshot.calls.calls.map((call): SearchKingsLead => {
    const calledAt = parseCalledAt(call);
    const calledDate = parseCalledDate(call);
    const matchedAppointment = matchAppointment(call, appointments);
    const qualified = finiteNumber(call.score) >= QUALIFIED_SCORE;
    const callId = canonicalSearchKingsCallId(call);
    const override = overrideByCall.get(callId) || overrideByCall.get(String(call.id));
    const callAgeHours = calledAt ? Math.max(0, (now.getTime() - new Date(calledAt).getTime()) / 3_600_000) : 0;
    let status: LostLeadStatus = qualified ? "needs_follow_up" : "unqualified";
    if (matchedAppointment) status = override?.status === "lost" ? "recovered" : "booked";
    else if (qualified && callAgeHours >= LOST_AFTER_HOURS) status = "lost";
    if (override && !matchedAppointment) status = override.status;
    const territory = territoryForCall(call);
    return {
      callId,
      calledAt,
      calledDate,
      callerName: String(call.name || "Unknown caller"),
      phone: String(call.callerNumberFormat || call.callerNumberComplete || ""),
      city: [call.city, call.state].filter(Boolean).join(", "),
      territory,
      source: String(call.source || ""),
      trackingLabel: String(call.trackingLabel || ""),
      score: call.score == null ? null : finiteNumber(call.score),
      summary: String(call.reportingTag || ""),
      tags: Array.isArray(call.tagList) ? call.tagList.map(String) : [],
      qualified,
      status,
      reason: override?.reason || inferredReason(call),
      note: override?.note || "",
      franchiseContacted: override?.franchiseContacted === true,
      potentialRevenue: territoryAverages.get(territory) || overallAverage,
      matchedAppointment,
      searchKingsUrl: String(call.id).startsWith("browser-")
        ? `https://searchkings.app/customers/${encodeURIComponent(snapshot.customerId)}/calls?dateRange=${snapshot.range.startDate},${snapshot.range.endDate}`
        : `https://searchkings.app/customers/${encodeURIComponent(snapshot.customerId)}/calls/${encodeURIComponent(String(call.id))}/detail`,
      updatedAt: override?.updatedAt || snapshot.fetchedAt,
    };
  }).sort((left, right) => right.calledAt.localeCompare(left.calledAt));

  const accountRows = snapshot.accounts.map((account) => ({
    id: String(account.id),
    name: String(account.name),
    type: String(account.type),
    territory: territoryForAccount(account),
    spend: roundMoney(metricValue(account, "Cost")),
    conversions: finiteNumber(metricValue(account, "Conversions")),
    costPerConversion: roundMoney(metricValue(account, "Cost Per Conversion")),
    responsiveness: optionalMetricValue(account, "Responsiveness"),
    impressions: optionalMetricValue(account, "Impressions"),
    clicks: optionalMetricValue(account, "Clicks"),
    absoluteTopImpressionShare: optionalMetricValue(account, "Impr. (Abs. Top) %"),
  }));
  const spend = roundMoney(accountRows.reduce((sum, row) => sum + row.spend, 0));
  const platformConversions = accountRows.reduce((sum, row) => sum + row.conversions, 0);
  const qualifiedLeads = leads.filter((lead) => lead.qualified);
  const bookedLeads = leads.filter((lead) => lead.status === "booked" || lead.status === "recovered");
  const attributedRevenue = roundMoney(
    bookedLeads.reduce((sum, lead) => sum + finiteNumber(lead.matchedAppointment?.revenue), 0),
  );
  const territories = new Set<string>([
    ...accountRows.map((row) => row.territory),
    ...leads.map((lead) => lead.territory),
  ]);
  const territoryRows = Array.from(territories)
    .map((territory): SearchKingsTerritoryRow => {
      const accounts = accountRows.filter((row) => row.territory === territory);
      const territoryLeads = leads.filter((lead) => lead.territory === territory);
      const territorySpend = accounts.reduce((sum, row) => sum + row.spend, 0);
      const conversions = accounts.reduce((sum, row) => sum + row.conversions, 0);
      return {
        territory,
        spend: roundMoney(territorySpend),
        conversions,
        costPerConversion: conversions ? roundMoney(territorySpend / conversions) : 0,
        qualifiedCalls: territoryLeads.filter((lead) => lead.qualified).length,
        bookedJobs: territoryLeads.filter((lead) => lead.status === "booked" || lead.status === "recovered").length,
        attributedRevenue: roundMoney(
          territoryLeads.reduce((sum, lead) => sum + finiteNumber(lead.matchedAppointment?.revenue), 0),
        ),
        lostLeads: territoryLeads.filter((lead) => lead.status === "lost").length,
      };
    })
    .sort((left, right) => right.spend - left.spend || left.territory.localeCompare(right.territory));

  return {
    available: true,
    snapshot,
    rangeLabel: formatRange(snapshot),
    spend,
    platformConversions,
    costPerConversion: platformConversions ? roundMoney(spend / platformConversions) : 0,
    totalCalls: finiteNumber(snapshot.calls.total?.currentCalls) || leads.length,
    scoredCalls: finiteNumber(snapshot.calls.total?.currentScoredCalls) || leads.filter((lead) => lead.score != null).length,
    qualifiedCalls: qualifiedLeads.length,
    qualifiedRate: leads.length ? (qualifiedLeads.length / leads.length) * 100 : 0,
    bookedJobs: bookedLeads.length,
    attributedRevenue,
    costPerBookedJob: bookedLeads.length ? roundMoney(spend / bookedLeads.length) : 0,
    roas: spend ? attributedRevenue / spend : 0,
    lostLeads: leads.filter((lead) => lead.status === "lost").length,
    needsFollowUp: leads.filter((lead) => lead.status === "needs_follow_up").length,
    recoveredLeads: leads.filter((lead) => lead.status === "recovered").length,
    estimatedLostRevenue: roundMoney(
      leads.filter((lead) => lead.status === "lost").reduce((sum, lead) => sum + lead.potentialRevenue, 0),
    ),
    accountRows,
    territoryRows,
    qualityRows: snapshot.calls.callsQuality || [],
    leads,
  };
}

export function buildSearchKingsView(monthKey?: string): SearchKingsView {
  const snapshot = readSearchKingsSnapshot(monthKey);
  if (!snapshot) {
    return emptyView(
      `SearchKings has not published a verified ${monthKey ? `${monthKey} ` : ""}snapshot yet.`,
    );
  }
  const appointments = appointmentRows(snapshot.range.startDate, snapshot.range.endDate);
  return buildSearchKingsViewFromData(snapshot, appointments, readLostLeadStore().entries);
}

export function searchKingsSetupSummary(): string {
  return [
    `Customer ${CUSTOMER_ID || "not configured"}`,
    `qualified score ${QUALIFIED_SCORE}+`,
    `lost after ${LOST_AFTER_HOURS} hours`,
    DEFAULT_TIMEZONE,
  ].join(" · ");
}

export function formatSearchKingsMoney(value: number): string {
  return money(value);
}
