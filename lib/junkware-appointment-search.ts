import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_FIELD_LENGTH = 120;

export type JunkwareAppointmentSearchQuery = {
  startDate?: string;
  endDate?: string;
  appointmentType?: string;
  status?: string;
  jkNumber?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  checkNumber?: string;
  followupStartDate?: string;
  followupEndDate?: string;
  poNumber?: string;
  franchise?: string;
};

export type JunkwareAppointmentSearchResult = {
  appointmentId: string | null;
  date: string;
  time: string;
  jkNumber: string;
  appointmentType: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentType: string;
  total: string;
  status: string;
};

export type JunkwareAppointmentSearchResponse = {
  query: JunkwareAppointmentSearchQuery;
  results: JunkwareAppointmentSearchResult[];
  hasMorePages: boolean;
  searchedAt: string;
};

const ALLOWED_TYPES = new Set(["", "1", "2"]);
const ALLOWED_STATUSES = new Set(["", "1,4", "8", "9"]);
const ALLOWED_FRANCHISES = new Set(["", "399", "484", "352", "477"]);
const DATE_PATTERN = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

function sanitizeField(value: unknown): string {
  return String(value || "").trim().slice(0, MAX_FIELD_LENGTH);
}

function sanitizeDate(value: unknown): string {
  const trimmed = String(value || "").trim().slice(0, 10);
  return DATE_PATTERN.test(trimmed) ? trimmed : "";
}

function sanitizeEnum(value: unknown, allowed: Set<string>): string {
  const trimmed = String(value || "").trim();
  return allowed.has(trimmed) ? trimmed : "";
}

function sanitizeQuery(query: JunkwareAppointmentSearchQuery): JunkwareAppointmentSearchQuery {
  return {
    startDate: sanitizeDate(query.startDate),
    endDate: sanitizeDate(query.endDate),
    appointmentType: sanitizeEnum(query.appointmentType, ALLOWED_TYPES),
    status: sanitizeEnum(query.status, ALLOWED_STATUSES),
    jkNumber: sanitizeField(query.jkNumber),
    firstName: sanitizeField(query.firstName),
    lastName: sanitizeField(query.lastName),
    company: sanitizeField(query.company),
    email: sanitizeField(query.email),
    phone: sanitizeField(query.phone),
    address: sanitizeField(query.address),
    checkNumber: sanitizeField(query.checkNumber),
    followupStartDate: sanitizeDate(query.followupStartDate),
    followupEndDate: sanitizeDate(query.followupEndDate),
    poNumber: sanitizeField(query.poNumber),
    franchise: sanitizeEnum(query.franchise, ALLOWED_FRANCHISES),
  };
}

const STUB_RESULTS: JunkwareAppointmentSearchResult[] = [
  {
    appointmentId: "4063306",
    date: "08/24/2026",
    time: "08:00 AM - 09:00 AM",
    jkNumber: "JK4063306",
    appointmentType: "Estimate",
    customerName: "Test Customer",
    customerPhone: "(504) 555-0100",
    customerAddress: "1116 Toledano St, New Orleans, LA 70118",
    paymentType: "",
    total: "$400.00",
    status: "Completed",
  },
];

export async function searchJunkwareAppointments(
  queryValue: JunkwareAppointmentSearchQuery,
): Promise<JunkwareAppointmentSearchResponse> {
  const query = sanitizeQuery(queryValue);
  const hasAnyCriterion = Object.values(query).some((value) => Boolean(value));
  if (!hasAnyCriterion) throw new Error("At least one search field is required.");

  if (process.env.JUNKWARE_APPOINTMENT_SEARCH_STUB === "1") {
    return {
      query,
      results: STUB_RESULTS,
      hasMorePages: false,
      searchedAt: new Date().toISOString(),
    };
  }

  const args = ["--import", "tsx", path.join(process.cwd(), "scripts", "search-junkware-appointments.ts")];
  if (query.startDate) args.push("--start", query.startDate);
  if (query.endDate) args.push("--end", query.endDate);
  if (query.appointmentType) args.push("--type", query.appointmentType);
  if (query.status) args.push("--status", query.status);
  if (query.jkNumber) args.push("--jk", query.jkNumber);
  if (query.firstName) args.push("--first-name", query.firstName);
  if (query.lastName) args.push("--last-name", query.lastName);
  if (query.company) args.push("--company", query.company);
  if (query.email) args.push("--email", query.email);
  if (query.phone) args.push("--phone", query.phone);
  if (query.address) args.push("--address", query.address);
  if (query.checkNumber) args.push("--check-no", query.checkNumber);
  if (query.followupStartDate) args.push("--fu-start", query.followupStartDate);
  if (query.followupEndDate) args.push("--fu-end", query.followupEndDate);
  if (query.poNumber) args.push("--po-number", query.poNumber);
  if (query.franchise) args.push("--franchise", query.franchise);

  try {
    const { stdout } = await execFileAsync(process.execPath, args, {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env },
    });
    const payload = JSON.parse(String(stdout || "").trim());
    if (!payload?.ok || payload?.mode !== "appointment-search" || !Array.isArray(payload?.results)) {
      throw new Error("JunkWare did not return a valid appointment search result.");
    }
    return {
      query,
      results: payload.results as JunkwareAppointmentSearchResult[],
      hasMorePages: Boolean(payload.hasMorePages),
      searchedAt: String(payload.searchedAt || new Date().toISOString()),
    };
  } catch (error) {
    const detail = error && typeof error === "object" && "stderr" in error
      ? String(error.stderr || "").trim()
      : error instanceof Error ? error.message : "";
    const safeDetail = detail.split("\n")[0].slice(0, 300);
    throw new Error(safeDetail || "JunkWare appointment search could not be completed.");
  }
}
