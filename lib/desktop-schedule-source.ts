// Extracted without semantic changes from the deployed Schedule source.
// Keep JunkWare normalization, identity, and source precedence shared with the UI.
/* eslint-disable @next/next/no-img-element -- JunkWare job photos are public closeout media URLs. */
import fs from "fs";
import path from "path";
import { appointmentTerritoryForLocation } from "@/lib/appointment-territory";
import { readVerifiedJobCancellations } from "@/lib/job-cancellations";
import { appointmentNotes, junkItemKeywords, junkwareJobPhotos, junkwarePhotoAuditAvailable, type JunkwareJobPhoto } from "@/lib/junkware-job-details";
import { junkwareBookedAt } from "@/lib/junkware-booking-date";
import { currentJunkwareScheduleSnapshot, readVerifiedJunkwareScheduleSnapshot } from "@/lib/junkware-fast-schedule";

const OPSBOT_DATA_DIR =
  process.env.OPSBOT_DATA_DIR ||
  path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");

type JobRow = {
  appointmentId: string;
  sourceEstimateAppointmentId: string;
  sourceDate: string;
  jkNumber: string;
  appointmentUrl: string;
  appointmentTime: string;
  bookedAt: string;
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
  hasScheduledTime: boolean;
  customerName: string;
  customerEmail: string;
  customerEmailCollected: boolean;
  phone: string;
  address: string;
  territory: string;
  appointmentType: string;
  status: string;
  truck: string;
  assignedTruck?: string;
  junkwareSyncStatus?: "pending" | "verified" | "manual_correction";
  junkwareSyncError?: string;
  driver: string;
  driverName?: string;
  driverNormalizedName?: string;
  navigator: string;
  navigatorName?: string;
  navigatorNormalizedName?: string;
  additionalCrew?: string[];
  crewAssignmentSource?: string;
  crewAssignmentStatus?: string;
  paymentType: string;
  paymentAmount: number;
  tipAmount: number;
  completedAt: string;
  closeout: JobCloseout | null;
  photos: JunkwareJobPhoto[];
  photoAuditAvailable: boolean;
  junkItems: string[];
  appointmentNotes: string[];
  cancellationReason: string;
};

type JobCloseoutCharge = {
  name: string;
  quantity: number;
  unitPrice: number;
  total: number;
};

type JobCloseoutPayment = {
  method: string;
  detail: string;
  amount: number;
};

type JobCloseout = {
  loadQuantity: number;
  loadSize: string;
  loadPrice: number;
  bedloadQuantity: number;
  bedloadSize: string;
  bedloadPrice: number;
  otherCharges: JobCloseoutCharge[];
  discount: number;
  tip: number;
  total: number;
  payments: JobCloseoutPayment[];
  balance: number;
};

function junkwareScheduleUpdatedAt(date: string): string | null {
  return readVerifiedJunkwareScheduleSnapshot(OPSBOT_DATA_DIR, date)?.updatedAt || null;
}

function parseClockMinutes(value: string): number | null {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const normalized = raw.replace(/\s+/g, " ").toUpperCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridian = match[3]?.toUpperCase() || "";

  if (!Number.isFinite(hour) || !Number.isFinite(minute) || minute < 0 || minute >= 60) return null;

  if (meridian === "AM" || meridian === "PM") {
    if (hour < 1 || hour > 12) return null;
    if (meridian === "AM") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return hour * 60 + minute;
  }

  if (hour > 23) return null;
  return hour * 60 + minute;
}

function formatClockMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return "—";
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour24 = Math.floor(normalized / 60);
  const minute = normalized % 60;
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 || 12;
  return `${hour12}:${String(minute).padStart(2, "0")} ${ampm}`;
}

function parseAppointmentWindowRow(row: Record<string, string>): {
  display: string;
  startMinutes: number | null;
  endMinutes: number | null;
  hasScheduledTime: boolean;
} {
  const startFields = [
    "appointment_start_time",
    "appt_start_time",
    "scheduled_start_time",
    "schedule_start_time",
    "start_time",
    "start",
    "arrival_window_start",
    "window_start",
    "time_start",
  ];
  const endFields = [
    "appointment_end_time",
    "appt_end_time",
    "scheduled_end_time",
    "schedule_end_time",
    "end_time",
    "end",
    "arrival_window_end",
    "window_end",
    "time_end",
  ];
  const windowFields = [
    "appointment_time",
    "appt_time",
    "scheduled_time",
    "schedule_time",
    "time_window",
    "schedule_window",
    "arrival_window",
    "window",
    "time_slot",
    "timeslot",
  ];

  const startRaw = firstValue(row, startFields);
  const endRaw = firstValue(row, endFields);

  const startMinutes = parseClockMinutes(startRaw);
  const endMinutes = parseClockMinutes(endRaw);
  if (startMinutes !== null || endMinutes !== null) {
    const displayStart = formatClockMinutes(startMinutes);
    const displayEnd = formatClockMinutes(endMinutes);
    const display = startMinutes !== null && endMinutes !== null
      ? `${displayStart}–${displayEnd}`
      : startMinutes !== null
        ? displayStart
        : displayEnd;
    return {
      display,
      startMinutes,
      endMinutes,
      hasScheduledTime: startMinutes !== null,
    };
  }

  const raw = firstValue(row, windowFields);
  if (!raw) {
    return {
      display: "Time unavailable",
      startMinutes: null,
      endMinutes: null,
      hasScheduledTime: false,
    };
  }

  const normalized = String(raw).replace(/\s+/g, " ").trim();
  const rangeMatch = normalized.match(
    /^(.+?)\s*(?:-|–|—|to)\s*(.+)$/i,
  );
  if (rangeMatch) {
    const left = rangeMatch[1].trim();
    const right = rangeMatch[2].trim();
    const rightMeridian = right.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() || "";
    const leftMeridian = left.match(/\b(AM|PM)\b/i)?.[1]?.toUpperCase() || rightMeridian;

    const leftValue = parseClockMinutes(leftMeridian && !/\b(AM|PM)\b/i.test(left) ? `${left} ${leftMeridian}` : left);
    const rightValue = parseClockMinutes(right);
    const displayLeft = formatClockMinutes(leftValue);
    const displayRight = formatClockMinutes(rightValue ?? (rightMeridian && !/\b(AM|PM)\b/i.test(right) ? parseClockMinutes(`${right} ${rightMeridian}`) : null));

    if (leftValue !== null || rightValue !== null) {
      return {
        display: leftValue !== null && rightValue !== null ? `${displayLeft}–${displayRight}` : leftValue !== null ? displayLeft : displayRight,
        startMinutes: leftValue,
        endMinutes: rightValue,
        hasScheduledTime: leftValue !== null,
      };
    }
  }

  const singleValue = parseClockMinutes(normalized);
  if (singleValue !== null) {
    return {
      display: formatClockMinutes(singleValue),
      startMinutes: singleValue,
      endMinutes: null,
      hasScheduledTime: true,
    };
  }

  return {
    display: normalized,
    startMinutes: null,
    endMinutes: null,
    hasScheduledTime: false,
  };
}

function compareJobSchedule(a: JobRow, b: JobRow): number {
  const aTimed = a.hasScheduledTime || a.appointmentStartMinutes !== null;
  const bTimed = b.hasScheduledTime || b.appointmentStartMinutes !== null;
  if (aTimed !== bTimed) return aTimed ? -1 : 1;

  if (aTimed && bTimed) {
    const startA = a.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
    const startB = b.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
    if (startA !== startB) return startA - startB;

    const endA = a.appointmentEndMinutes ?? Number.MAX_SAFE_INTEGER;
    const endB = b.appointmentEndMinutes ?? Number.MAX_SAFE_INTEGER;
    if (endA !== endB) return endA - endB;
  }

  const jkCompare = a.jkNumber.localeCompare(b.jkNumber, undefined, { numeric: true, sensitivity: "base" });
  if (jkCompare !== 0) return jkCompare;
  return a.customerName.localeCompare(b.customerName, undefined, { sensitivity: "base" });
}

function normalizeAddressLine(row: Record<string, string>): string {
  const street = firstValue(row, [
    "street_address",
    "address",
    "service_address",
    "job_address",
    "customer_address",
    "Address",
    "Service Address",
    "Customer Address",
  ]);
  const city = firstValue(row, ["city", "City"]);
  const state = firstValue(row, ["state", "State"]);
  const zip = firstValue(row, ["zip", "zipcode", "postal_code", "Zip", "ZIP"]);

  const cityState = [city, state ? [state, zip].filter(Boolean).join(" ") : zip].filter(Boolean).join(", ");
  const parts = [street, cityState].filter(Boolean);

  if (!parts.length) return "Address unavailable";
  return parts.join(", ");
}

function addressFromCancellationText(value: string): string {
  const match = String(value || "").match(
    /\b(\d{1,6}\s+(?:[\w.'’-]+\s+){0,6}(?:st(?:reet)?|rd|road|dr(?:ive)?|ave(?:nue)?|blvd|boulevard|ln|lane|ct|court|hwy|highway|way|pkwy|parkway|pl|place|cir|circle|loop)\.?)\s+([A-Za-z.'’ -]+?),\s*([A-Z]{2})\s*(\d{5}(?:-\d{4})?)\b/i,
  );
  if (!match) return "Address unavailable";
  const [, street, city, state, zip] = match;
  return `${street.replace(/\s+/g, " ").trim()}, ${city.replace(/\s+/g, " ").trim()}, ${state.toUpperCase()} ${zip}`;
}

function cancellationReasonText(value: string, customerName: string, phone: string, address: string): string {
  let reason = String(value || "").replace(/\s+/g, " ").trim();
  if (!reason) return "Cancellation reason unavailable";

  const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  const name = String(customerName || "").trim();
  const phoneDigits = String(phone || "").replace(/\D/g, "");
  if (name && new RegExp(`^${escape(name)}\\s+`, "i").test(reason)) {
    reason = reason.replace(new RegExp(`^${escape(name)}\\s+`, "i"), "");
  }
  if (phoneDigits) {
    const phonePattern = phoneDigits.split("").map((digit) => `${digit}\\D*`).join("");
    reason = reason.replace(new RegExp(`^${phonePattern}\\s*`, "i"), "");
  }

  const addressMatch = String(address || "").match(/^(.+?),\s*([^,]+?)(?:,\s*([A-Z]{2}))?\s*,?\s*(\d{5}(?:-\d{4})?)$/i);
  if (addressMatch) {
    const [, street, city, state, zip] = addressMatch;
    reason = reason.replace(
      new RegExp(`^${escape(street)}\\s*,?\\s*${escape(city)}\\s*,?\\s*${state ? `${escape(state)}\\s*,?\\s*` : "(?:[A-Z]{2}\\s*,?\\s*)?"}${escape(zip)}\\s*`, "i"),
      "",
    );
  }
  return reason.replace(/^[-,:;\s]+/, "").replace(/\s+Followup\.?$/i, "").trim() || "Cancellation reason unavailable";
}

function jobKey(job: JobRow): string {
  const appointmentId = String(job.appointmentId || "").trim();
  if (appointmentId) return `appt:${appointmentId}`;
  const jk = String(job.jkNumber || "").trim().toLowerCase();
  if (jk && jk !== "—") return `job:${jk}`;
  return [
    job.customerName,
    job.appointmentTime,
    job.address,
    job.territory,
  ]
    .map((value) => String(value || "").trim().toLowerCase())
    .join("|");
}

function firstValue(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function moneyNumber(value: unknown): number {
  if (value === undefined || value === null) return 0;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

function parseJobCloseout(row: Record<string, any>): JobCloseout | null {
  let raw = row?.closeout;
  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;

  const otherCharges = (Array.isArray(raw.otherCharges) ? raw.otherCharges : [])
    .map((charge: Record<string, unknown>): JobCloseoutCharge | null => {
      const name = String(charge?.name || "").trim();
      if (!name) return null;
      return {
        name,
        quantity: moneyNumber(charge.quantity),
        unitPrice: moneyNumber(charge.unitPrice),
        total: moneyNumber(charge.total),
      };
    })
    .filter((charge: JobCloseoutCharge | null): charge is JobCloseoutCharge => Boolean(charge));

  const payments = (Array.isArray(raw.payments) ? raw.payments : [])
    .map((payment: Record<string, unknown>): JobCloseoutPayment | null => {
      const method = String(payment?.method || "").trim();
      if (!method) return null;
      return {
        method,
        detail: String(payment?.detail || "").trim(),
        amount: moneyNumber(payment.amount),
      };
    })
    .filter((payment: JobCloseoutPayment | null): payment is JobCloseoutPayment => Boolean(payment));

  const closeout: JobCloseout = {
    loadQuantity: moneyNumber(raw.loadQuantity),
    loadSize: String(raw.loadSize || "").trim(),
    loadPrice: moneyNumber(raw.loadPrice),
    bedloadQuantity: moneyNumber(raw.bedloadQuantity),
    bedloadSize: String(raw.bedloadSize || "").trim(),
    bedloadPrice: moneyNumber(raw.bedloadPrice),
    otherCharges,
    discount: moneyNumber(raw.discount),
    tip: moneyNumber(raw.tip),
    total: moneyNumber(raw.total),
    payments,
    balance: moneyNumber(raw.balance),
  };

  return closeout.total > 0
    || closeout.loadPrice > 0
    || closeout.bedloadPrice > 0
    || closeout.otherCharges.length > 0
    || closeout.payments.length > 0
    ? closeout
    : null;
}

function buildJunkwareAppointmentUrl(row: Record<string, string>): string {
  const directUrl = firstValue(row, [
    "appointment_url",
    "appt_url",
    "job_url",
    "junkware_url",
    "source_url",
    "url",
    "Appointment URL",
    "Job URL",
    "Junkware URL",
    "URL",
  ]);

  if (directUrl && directUrl.startsWith("http")) {
    return directUrl;
  }

  const appointmentId = firstValue(row, [
    "appt_id",
    "appointment_id",
    "Appointment ID",
    "Appt ID",
  ]);

  if (appointmentId && appointmentId !== "—") {
    return `https://junkware.junk-king.com/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}`;
  }

  return "";
}

function junkwareAppointmentId(appointmentUrl: string): string {
  const match = String(appointmentUrl || "").match(/[?&]id=(\d{1,12})(?:&|$)/i);
  return match?.[1] || "";
}

function formatPhone(value: string): string {
  const raw = String(value || "").trim();
  if (!raw || raw === "—") return "";
  const digits = raw.replace(/\D/g, "");
  const national = digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits;
  if (national.length !== 10) return raw;
  return `(${national.slice(0, 3)}) ${national.slice(3, 6)}-${national.slice(6)}`;
}

function validCustomerEmail(value: unknown): string {
  const email = String(value || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function firstCustomerEmail(...rows: Record<string, string>[]): string {
  const keys = [
    "customerEmail",
    "customer_email",
    "email",
    "email_address",
    "emailAddress",
    "Email",
    "Customer Email",
  ];
  for (const row of rows) {
    for (const key of keys) {
      const email = validCustomerEmail(row?.[key]);
      if (email) return email;
    }
  }
  return "";
}

function hasCustomerEmailField(...rows: Record<string, string>[]): boolean {
  const keys = ["customerEmail", "customer_email", "email", "email_address", "emailAddress", "Email", "Customer Email"];
  return rows.some((row) => keys.some((key) => Object.prototype.hasOwnProperty.call(row || {}, key)));
}

function rawJunkwareFile(date: string): string {
  return path.join(
    OPSBOT_DATA_DIR,
    "history",
    "junkware",
    `junkware_${date}_raw.json`,
  );
}

function readRawCancelledRows(date: string): Record<string, string>[] {
  const file = rawJunkwareFile(date);
  if (!fs.existsSync(file)) return [];

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    return (Array.isArray(payload?.cancelled) ? payload.cancelled : [])
      .filter((row: unknown) => row && typeof row === "object") as Record<string, string>[];
  } catch {
    return [];
  }
}

function readRawAppointmentLookup(date: string): Map<string, Record<string, any>> {
  const file = rawJunkwareFile(date);
  const lookup = new Map<string, Record<string, any>>();
  if (!fs.existsSync(file)) return lookup;

  try {
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const rows = [
      ...(Array.isArray(payload?.appointments) ? payload.appointments : []),
      ...(Array.isArray(payload?.completed) ? payload.completed : []),
      ...(Array.isArray(payload?.cancelled) ? payload.cancelled : []),
    ];
    for (const source of rows) {
      const row = source && typeof source === "object" ? source as Record<string, any> : {};
      const apptId = firstValue(row, ["appt_id", "appointment_id"]);
      const jobId = firstValue(row, ["job_id", "jk_number"]);
      if (apptId) lookup.set(`appt:${apptId}`, row);
      if (jobId) lookup.set(`job:${jobId.toLowerCase()}`, row);
    }
  } catch {
    return lookup;
  }
  return lookup;
}

function findAppointmentTime(row: Record<string, string>): string {
  return parseAppointmentWindowRow(row).display;
}

function normalizeJobRow(row: Record<string, string>): JobRow {
  const jkNumber =
    firstValue(row, [
      "jk_number",
      "jk",
      "job_number",
      "job_id",
      "appointment_id",
      "appointment_number",
      "confirmation_number",
      "work_order",
      "work_order_number",
      "JK Number",
      "JK",
      "Job Number",
      "Job ID",
      "Appointment ID",
      "Appointment Number",
      "Confirmation Number",
      "Work Order",
      "Work Order Number",
    ]) || "—";

  const appointmentUrl = buildJunkwareAppointmentUrl(row);

  const parsedTime = parseAppointmentWindowRow(row);
  const appointmentTime = parsedTime.display;

  const customerName =
    firstValue(row, [
      "customer_name",
      "customer",
      "name",
      "client_name",
      "contact_name",
      "Customer Name",
      "Customer",
      "Name",
    ]) || "—";

  const customerEmail = firstCustomerEmail(row) || "—";
  const customerEmailCollected = hasCustomerEmailField(row);

  const phone =
    firstValue(row, [
      "phone",
      "phone_number",
      "customer_phone",
      "client_phone",
      "contact_phone",
      "Phone",
      "Phone Number",
      "Customer Phone",
    ]) || "—";

  const address = normalizeAddressLine(row);

  const territory = appointmentTerritoryForLocation(
    firstValue(row, [
      "territory",
      "market",
      "franchise",
      "location",
      "Territory",
      "Market",
    ]) || "—",
    address,
  );

  const appointmentType =
    firstValue(row, [
      "appointment_type",
      "appt_type",
      "job_type",
      "type",
      "Appointment Type",
      "Type",
    ]) || "—";

  const status =
    firstValue(row, [
      "job_status",
      "status",
      "schedule_status",
      "appointment_status",
      "appt_status",
      "Status",
      "Job Status",
    ]) || "—";

  const paymentType =
    firstValue(row, [
      "payment_type",
      "payment_method",
      "payment",
      "method",
      "Payment Type",
      "Payment Method",
    ]) || "—";

  const paymentAmount = moneyNumber(
    firstValue(row, [
      "payment_amount",
      "payments_collected",
      "amount_collected",
      "collected",
      "amount",
      "total",
      "revenue",
      "sales",
      "job_revenue",
      "gross_revenue",
      "total_revenue",
      "Payment Amount",
      "Amount",
      "Total",
      "Revenue",
    ])
  );

  return {
    appointmentId: junkwareAppointmentId(appointmentUrl),
    sourceEstimateAppointmentId: firstValue(row, ["source_estimate_appointment_id", "sourceEstimateAppointmentId"]),
    sourceDate: "",
    jkNumber,
    appointmentUrl,
    appointmentTime,
    bookedAt: junkwareBookedAt(row),
    appointmentStartMinutes: parsedTime.startMinutes,
    appointmentEndMinutes: parsedTime.endMinutes,
    hasScheduledTime: parsedTime.hasScheduledTime,
    customerName,
    customerEmail,
    customerEmailCollected,
    phone,
    address,
    territory,
    appointmentType,
    status,
    truck: firstValue(row, ["truck", "assigned_truck", "truck_name"]) || "—",
    assignedTruck: firstValue(row, ["assigned_truck", "truck", "truck_name"]) || "—",
    driver: firstValue(row, ["driver", "driver_name", "driver_normalized_name", "assigned_driver"]) || "—",
    driverName: firstValue(row, ["driver_name", "driver"]) || "—",
    driverNormalizedName: firstValue(row, ["driver_normalized_name", "driver_name", "driver"]) || "—",
    navigator: firstValue(row, ["navigator", "navigator_name", "navigator_normalized_name", "assigned_navigator"]) || "—",
    navigatorName: firstValue(row, ["navigator_name", "navigator"]) || "—",
    navigatorNormalizedName: firstValue(row, ["navigator_normalized_name", "navigator_name", "navigator"]) || "—",
    additionalCrew: parseCrewList(row.additional_crew),
    crewAssignmentSource: firstValue(row, ["crew_assignment_source"]) || "—",
    crewAssignmentStatus: firstValue(row, ["crew_assignment_status"]) || "—",
    paymentType,
    paymentAmount,
    tipAmount: moneyNumber(firstValue(row, ["tip", "Tip", "customer_tip", "Customer Tip"]) || "0"),
    completedAt: firstValue(row, ["completed_at", "closed_at", "closeout_at", "checkout_at"]),
    closeout: null,
    photos: junkwareJobPhotos(row),
    photoAuditAvailable: junkwarePhotoAuditAvailable(row),
    junkItems: junkItemKeywords(row),
    appointmentNotes: appointmentNotes(row),
    cancellationReason: cancellationReasonText(
      firstValue(row, ["cancellation_reason", "cancel_reason", "Cancellation Reason", "Cancel Reason"]),
      customerName,
      phone,
      address,
    ),
  };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i++;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function readCsv(filePath: string): Record<string, string>[] {
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const raw = fs.readFileSync(filePath, "utf8").trim();

  if (!raw) {
    return [];
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);

  if (lines.length < 2) {
    return [];
  }

  const headers = parseCsvLine(lines[0]);

  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    const row: Record<string, string> = {};

    headers.forEach((header, index) => {
      row[header] = values[index] || "";
    });

    return row;
  });
}

function readJobRows(date: string): JobRow[] {
  const junkwareDir = path.join(OPSBOT_DATA_DIR, "history", "junkware");

  const completedCsv = path.join(
    junkwareDir,
    `junkware_completed_${date}_summary.csv`,
  );

  const liveCsv = path.join(
    junkwareDir,
    `junkware_live_${date}_summary.csv`,
  );

  const files = [
    { path: completedCsv, source: "completed" },
    { path: liveCsv, source: "live" },
  ].filter((file) => fs.existsSync(file.path));

  const seen = new Set<string>();
  const jobs: JobRow[] = [];
  const rawAppointmentLookup = readRawAppointmentLookup(date);
  const rowSources = [
    { rows: readRawCancelledRows(date), source: "cancelled" },
    ...files.map((file) => ({ rows: readCsv(file.path), source: file.source })),
  ];

  function cleanMoneyValue(value: string): string {
    return String(value || "")
      .replace(/[$,]/g, "")
      .trim();
  }

  function jobKey(row: Record<string, string>): string {
    const apptId = firstValue(row, [
      "appt_id",
      "appointment_id",
      "Appointment ID",
      "Appt ID",
    ]);

    const jobId = firstValue(row, [
      "job_id",
      "jk_number",
      "job_number",
      "Job ID",
      "Job Number",
      "JK Number",
    ]);

    if (apptId && apptId !== "—") return `appt:${apptId}`;
    if (jobId && jobId !== "—") return `job:${jobId}`;

    return [
      firstValue(row, ["customer_name", "customer", "Customer Name", "Customer"]),
      firstValue(row, ["address", "Address"]),
      findAppointmentTime(row),
      firstValue(row, ["appointment_type", "type", "Appointment Type", "Type"]),
    ].join("|");
  }

  for (const rowSource of rowSources) {
    for (const row of rowSource.rows) {
      const key = jobKey(row);

      // Cancellation rows are authoritative and loaded first. If JunkWare
      // briefly returns the same appointment in another table, retain the
      // canceled state instead of the stale scheduled/completed state.
      if (seen.has(key)) continue;
      seen.add(key);

      const apptId = firstValue(row, ["appt_id", "appointment_id", "Appointment ID", "Appt ID"]);
      const rowJobId = firstValue(row, ["job_id", "jk_number", "job_number", "Job ID", "JK Number"]);
      const sourceRow =
        (apptId ? rawAppointmentLookup.get(`appt:${apptId}`) : undefined) ||
        (rowJobId ? rawAppointmentLookup.get(`job:${rowJobId.toLowerCase()}`) : undefined) ||
        {};

      const sourceValue = (keys: string[]) => firstValue(sourceRow, keys) || firstValue(row, keys);
      const parsedTime = parseAppointmentWindowRow({ ...row, ...sourceRow });

      const jkNumber =
        firstValue(row, [
          "jk_number",
          "jk",
          "job_number",
          "job_id",
          "appointment_id",
          "appointment_number",
          "confirmation_number",
          "work_order",
          "work_order_number",
          "JK Number",
          "JK",
          "Job Number",
          "Job ID",
          "Appointment ID",
          "Appointment Number",
          "Confirmation Number",
          "Work Order",
          "Work Order Number",
        ]) || "—";

      const customerName =
        sourceValue([
          "customer_name",
          "customer",
          "name",
          "Customer Name",
          "Customer",
          "Name",
        ]) || "—";

      const paymentAmountRaw =
        firstValue(row, [
          "payment_amount",
          "payment",
          "revenue",
          "total",
          "quote",
          "amount",
          "sales",
          "Payment Amount",
          "Payment",
          "Revenue",
          "Total",
          "Quote",
          "Amount",
          "Sales",
        ]) || "0";

      const cancellationReasonRaw = sourceValue(["cancellation_reason", "cancel_reason", "Cancellation Reason", "Cancel Reason"]);
      const sourceAddress = normalizeAddressLine({ ...row, ...sourceRow });
      const address = sourceAddress !== "Address unavailable"
        ? sourceAddress
        : addressFromCancellationText(cancellationReasonRaw);
      const phone = formatPhone(sourceValue([
        "phone",
        "customer_phone",
        "Phone",
        "Customer Phone",
      ])) || "—";

      jobs.push({
        appointmentId: apptId || "",
        sourceEstimateAppointmentId: sourceValue(["source_estimate_appointment_id", "sourceEstimateAppointmentId"]),
        sourceDate: date,
        jkNumber,
        appointmentUrl: buildJunkwareAppointmentUrl({ ...row, ...sourceRow }),
        appointmentTime: parsedTime.display,
        bookedAt: junkwareBookedAt(sourceRow, row),
        appointmentStartMinutes: parsedTime.startMinutes,
        appointmentEndMinutes: parsedTime.endMinutes,
        hasScheduledTime: parsedTime.hasScheduledTime,
        customerName,
        customerEmail: firstCustomerEmail(sourceRow, row) || "—",
        customerEmailCollected: hasCustomerEmailField(sourceRow, row),
        phone,
        address,
        territory: appointmentTerritoryForLocation(
          sourceValue([
            "normalized_territory",
            "territory",
            "market",
            "franchise",
            "Territory",
            "Market",
            "Franchise",
          ]) || "—",
          address,
        ),
        appointmentType:
          firstValue(row, [
            "appointment_type",
            "type",
            "job_type",
            "Appointment Type",
            "Type",
            "Job Type",
          ]) || (rowSource.source === "live"
            ? "Open Appointment"
            : rowSource.source === "cancelled"
              ? "Canceled Appointment"
              : "Completed Job"),
        status:
          firstValue(row, [
            "job_status",
            "status",
            "appointment_status",
            "schedule_status",
            "Job Status",
            "Status",
            "Appointment Status",
            "Schedule Status",
          ]) || (rowSource.source === "live"
            ? "Open"
            : rowSource.source === "cancelled"
              ? "Canceled"
              : "Completed"),
        truck:
          sourceValue(["truck", "assigned_truck", "truck_name", "vehicle"]) || "—",
        driver:
          sourceValue(["driver_name", "driver", "driver_normalized_name", "assigned_driver"]) || "—",
        navigator:
          sourceValue(["navigator_name", "navigator", "navigator_normalized_name", "assigned_navigator"]) || "—",
        assignedTruck:
          sourceValue(["assigned_truck", "truck", "truck_name", "vehicle"]) || "—",
        driverName:
          sourceValue(["driver_name", "driver"]) || "—",
        driverNormalizedName:
          sourceValue(["driver_normalized_name", "driver_name", "driver"]) || "—",
        navigatorName:
          sourceValue(["navigator_name", "navigator"]) || "—",
        navigatorNormalizedName:
          sourceValue(["navigator_normalized_name", "navigator_name", "navigator"]) || "—",
        additionalCrew: parseCrewList(sourceValue(["additional_crew"])),
        crewAssignmentSource:
          sourceValue(["crew_assignment_source"]) || "—",
        crewAssignmentStatus:
          sourceValue(["crew_assignment_status"]) || "—",
        paymentType:
          firstValue(row, [
            "payment_type",
            "payment_method",
            "Payment Type",
            "Payment Method",
          ]) || "—",
        paymentAmount: Number(cleanMoneyValue(paymentAmountRaw).replace(/[^0-9.-]/g, "")) || 0,
        tipAmount: Number(
          cleanMoneyValue(firstValue(sourceRow, ["tip", "Tip", "customer_tip", "Customer Tip"]) || firstValue(row, ["tip", "Tip", "customer_tip", "Customer Tip"]) || "0")
            .replace(/[^0-9.-]/g, "")
        ) || 0,
        completedAt: sourceValue(["completed_at", "closed_at", "closeout_at", "checkout_at"]) || firstValue(row, ["completed_at", "closed_at", "closeout_at", "checkout_at"]),
        closeout: parseJobCloseout(sourceRow),
        photos: junkwareJobPhotos(sourceRow),
        photoAuditAvailable: junkwarePhotoAuditAvailable(sourceRow),
        junkItems: junkItemKeywords(sourceRow),
        appointmentNotes: appointmentNotes(sourceRow),
        cancellationReason: cancellationReasonText(cancellationReasonRaw, customerName, phone, address),
      });
    }
  }

  // Bridge the short collector delay after a verified JunkWare write. After
  // thirty minutes the collected schedule becomes authoritative again, so a
  // later manual reactivation in JunkWare cannot be masked forever.
  const recentCancellationCutoff = Date.now() - 30 * 60_000;
  const verifiedCancellationIds = new Set(
    readVerifiedJobCancellations(date)
      .filter((entry) => Date.parse(entry.canceledAt) >= recentCancellationCutoff)
      .map((entry) => entry.appointmentId),
  );
  const resolvedJobs = verifiedCancellationIds.size
    ? jobs.map((job) => verifiedCancellationIds.has(job.appointmentId) ? { ...job, status: "Canceled" } : job)
    : jobs;

  const fastSnapshot = currentJunkwareScheduleSnapshot(OPSBOT_DATA_DIR, date);
  const currentJobs = fastSnapshot
    ? mergeFastScheduleRows(resolvedJobs, fastSnapshot.appointments, fastSnapshot.cancelled, date)
    : resolvedJobs;

  return currentJobs.sort((a, b) => {
    const territoryCompare = a.territory.localeCompare(b.territory);
    if (territoryCompare !== 0) return territoryCompare;
    return compareJobSchedule(a, b);
  });
}

function fastScheduleIdentity(row: Record<string, any>): string {
  const appointmentId = firstValue(row, ["appt_id", "appointment_id", "appointmentId"]);
  if (appointmentId) return `appt:${appointmentId}`;
  const jobNumber = firstValue(row, ["job_id", "jk_number", "job_number"]);
  return jobNumber ? `job:${jobNumber.toLowerCase()}` : "";
}

function jobRowIdentity(job: JobRow): string {
  if (job.appointmentId) return `appt:${job.appointmentId}`;
  return job.jkNumber && job.jkNumber !== "—" ? `job:${job.jkNumber.toLowerCase()}` : "";
}

function present(value: unknown): boolean {
  const normalized = String(value ?? "").trim();
  return Boolean(normalized && normalized !== "—");
}

function mergeFastScheduleRows(
  canonicalJobs: JobRow[],
  appointmentRows: Record<string, any>[],
  cancelledRows: Record<string, any>[],
  date: string,
): JobRow[] {
  const canonicalByIdentity = new Map<string, JobRow>();
  for (const job of canonicalJobs) {
    const identity = jobRowIdentity(job);
    if (identity) canonicalByIdentity.set(identity, job);
  }

  return [...cancelledRows, ...appointmentRows].flatMap((row) => {
    const identity = fastScheduleIdentity(row);
    if (!identity) return [];
    const existing = canonicalByIdentity.get(identity);
    const fresh = normalizeJobRow(row);
    fresh.sourceDate = date;
    fresh.appointmentId = firstValue(row, ["appt_id", "appointment_id", "appointmentId"]) || fresh.appointmentId;
    if (!existing) return [fresh];

    return [{
      ...existing,
      appointmentId: fresh.appointmentId || existing.appointmentId,
      jkNumber: present(fresh.jkNumber) ? fresh.jkNumber : existing.jkNumber,
      appointmentUrl: fresh.appointmentUrl || existing.appointmentUrl,
      appointmentTime: present(fresh.appointmentTime) ? fresh.appointmentTime : existing.appointmentTime,
      appointmentStartMinutes: fresh.hasScheduledTime ? fresh.appointmentStartMinutes : existing.appointmentStartMinutes,
      appointmentEndMinutes: fresh.hasScheduledTime ? fresh.appointmentEndMinutes : existing.appointmentEndMinutes,
      hasScheduledTime: fresh.hasScheduledTime || existing.hasScheduledTime,
      customerName: present(fresh.customerName) ? fresh.customerName : existing.customerName,
      customerEmail: present(fresh.customerEmail) ? fresh.customerEmail : existing.customerEmail,
      customerEmailCollected: fresh.customerEmailCollected || existing.customerEmailCollected,
      phone: present(fresh.phone) ? fresh.phone : existing.phone,
      address: present(fresh.address) && fresh.address !== "Address unavailable" ? fresh.address : existing.address,
      territory: present(fresh.territory) ? fresh.territory : existing.territory,
      appointmentType: present(fresh.appointmentType) ? fresh.appointmentType : existing.appointmentType,
      status: present(fresh.status) ? fresh.status : existing.status,
      truck: present(fresh.truck) ? fresh.truck : existing.truck,
      assignedTruck: present(fresh.assignedTruck) ? fresh.assignedTruck : existing.assignedTruck,
      driver: present(fresh.driver) ? fresh.driver : existing.driver,
      driverName: present(fresh.driverName) ? fresh.driverName : existing.driverName,
      driverNormalizedName: present(fresh.driverNormalizedName) ? fresh.driverNormalizedName : existing.driverNormalizedName,
      navigator: present(fresh.navigator) ? fresh.navigator : existing.navigator,
      navigatorName: present(fresh.navigatorName) ? fresh.navigatorName : existing.navigatorName,
      navigatorNormalizedName: present(fresh.navigatorNormalizedName) ? fresh.navigatorNormalizedName : existing.navigatorNormalizedName,
      paymentType: present(fresh.paymentType) ? fresh.paymentType : existing.paymentType,
      paymentAmount: fresh.paymentAmount || existing.paymentAmount,
      tipAmount: fresh.tipAmount || existing.tipAmount,
      cancellationReason: fresh.cancellationReason || existing.cancellationReason,
    }];
  });
}

function parseCrewList(value: unknown): string[] {
  const raw = String(value ?? "").trim();
  if (!raw || raw === "[]" || raw === "[ ]") return [];
  if (raw.startsWith("[") && raw.endsWith("]")) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed
          .map((entry) => String(entry || "").trim())
          .filter(Boolean);
      }
    } catch {
      // fall back to delimiter parsing below
    }
  }
  return raw
    .split("|")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((entry) => entry !== "[]" && entry !== "[ ]");
}

export { readJobRows, mergeFastScheduleRows, junkwareScheduleUpdatedAt };
export type { JobRow };
