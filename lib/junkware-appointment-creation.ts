import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const JUNKWARE_FRANCHISES = [
  "Baton Rouge",
  "Jefferson Parish",
  "New Orleans",
  "Northshore",
] as const;

export const JUNKWARE_APPOINTMENT_TYPES = ["Job", "Estimate"] as const;

export type JunkwareFranchise = (typeof JUNKWARE_FRANCHISES)[number];
export type JunkwareAppointmentType = (typeof JUNKWARE_APPOINTMENT_TYPES)[number];

export type JunkwareAppointmentCreationInput = {
  requestId: string;
  franchise: JunkwareFranchise;
  date: string;
  startTime: string;
  durationHours: number;
  truck: string;
  appointmentType: JunkwareAppointmentType;
  firstName: string;
  lastName: string;
  business: boolean;
  company: string;
  phone: string;
  email: string;
  billingAddress: string;
  billingZip: string;
  billingEmail: string;
  howHeard: string;
  serviceAddress: string;
  serviceZip: string;
  serviceContactName: string;
  serviceContactPhone: string;
  estimatedPickups: number;
  scope: string;
  notes: string;
  duplicateOverrideReason: string;
};

export type JunkwareAppointmentCreationResult = {
  appointmentId: string;
  jkNumber: string;
  appointmentUrl: string;
  franchise: JunkwareFranchise;
  date: string;
  startTime: string;
  durationHours: number;
  truck: string;
  appointmentType: JunkwareAppointmentType;
  customerMode: "existing" | "new";
  verifiedAt: string;
};

type CreationRecord = {
  version: 1;
  requestId: string;
  fingerprint: string;
  status: "creating" | "failed" | "uncertain" | "verified";
  createdAt: string;
  updatedAt: string;
  error?: string;
  result?: JunkwareAppointmentCreationResult;
};

export class JunkwareAppointmentCreationError extends Error {
  code: string;
  stage: "validation" | "preflight" | "saving" | "verifying";

  constructor(message: string, code = "appointment_creation_failed", stage: JunkwareAppointmentCreationError["stage"] = "preflight") {
    super(message);
    this.name = "JunkwareAppointmentCreationError";
    this.code = code;
    this.stage = stage;
  }
}

const CREATION_DIRECTORY = String(process.env.JUNKWARE_APPOINTMENT_CREATION_DIR || "").trim()
  || path.join(process.cwd(), "data", "appointment-creations");
const GLOBAL_LOCK_DIRECTORY = path.join(CREATION_DIRECTORY, ".junkware-create.lock");
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(value: unknown, maximum = 500): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maximum);
}

function cleanMultiline(value: unknown, maximum = 2_000): string {
  return String(value || "").replace(/\r\n?/g, "\n").trim().slice(0, maximum);
}

function digits(value: unknown): string {
  const normalized = String(value || "").replace(/\D/g, "");
  return normalized.length === 11 && normalized.startsWith("1") ? normalized.slice(1) : normalized;
}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function operatingDate(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function required(value: unknown, label: string, maximum = 200): string {
  const normalized = clean(value, maximum);
  if (!normalized) throw new JunkwareAppointmentCreationError(`${label} is required.`, "invalid_appointment", "validation");
  return normalized;
}

export function normalizeJunkwareAppointmentCreationInput(value: unknown): JunkwareAppointmentCreationInput {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const requestId = clean(input.requestId, 64);
  const franchise = clean(input.franchise, 50) as JunkwareFranchise;
  const date = clean(input.date, 10);
  const startTime = clean(input.startTime, 5);
  const durationHours = Number(input.durationHours);
  const truck = clean(input.truck, 20);
  const appointmentType = clean(input.appointmentType, 20) as JunkwareAppointmentType;
  const firstName = required(input.firstName, "Customer first name", 80);
  const lastName = required(input.lastName, "Customer last name", 80);
  const business = input.business === true;
  const company = clean(input.company, 150);
  const phone = digits(input.phone);
  const email = clean(input.email, 200).toLowerCase();
  const billingAddress = required(input.billingAddress, "Billing address", 180);
  const billingZip = clean(input.billingZip, 10);
  const billingEmail = clean(input.billingEmail, 200).toLowerCase();
  const howHeard = required(input.howHeard, "How heard", 100);
  const serviceAddress = required(input.serviceAddress, "Service address", 180);
  const serviceZip = clean(input.serviceZip, 10);
  const serviceContactName = clean(input.serviceContactName, 160);
  const serviceContactPhone = digits(input.serviceContactPhone);
  const estimatedPickups = Number(input.estimatedPickups);
  const scope = required(input.scope, "Work description", 300);
  const notes = cleanMultiline(input.notes);
  const duplicateOverrideReason = cleanMultiline(input.duplicateOverrideReason, 500);

  if (!UUID_PATTERN.test(requestId)) throw new JunkwareAppointmentCreationError("The appointment request ID is invalid.", "invalid_appointment", "validation");
  if (!JUNKWARE_FRANCHISES.includes(franchise)) throw new JunkwareAppointmentCreationError("Choose a JunkWare franchise.", "invalid_appointment", "validation");
  if (!validDate(date) || date < operatingDate()) throw new JunkwareAppointmentCreationError("Choose today or a future appointment date.", "invalid_appointment", "validation");
  if (!/^(?:0[8-9]|1[0-7]):00$/.test(startTime)) throw new JunkwareAppointmentCreationError("Choose a JunkWare appointment start time from 8:00 AM through 5:00 PM.", "invalid_appointment", "validation");
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 12) throw new JunkwareAppointmentCreationError("Choose an appointment duration from 1 to 12 hours.", "invalid_appointment", "validation");
  if (!/^Truck [1-9]$/.test(truck)) throw new JunkwareAppointmentCreationError("Choose a JunkWare truck.", "invalid_appointment", "validation");
  if (!JUNKWARE_APPOINTMENT_TYPES.includes(appointmentType)) throw new JunkwareAppointmentCreationError("Choose Job or Estimate as the appointment category.", "invalid_appointment", "validation");
  if (business && !company) throw new JunkwareAppointmentCreationError("Company is required for a business customer.", "invalid_appointment", "validation");
  if (phone.length !== 10) throw new JunkwareAppointmentCreationError("Enter a 10-digit customer phone number.", "invalid_appointment", "validation");
  if (email && !EMAIL_PATTERN.test(email)) throw new JunkwareAppointmentCreationError("Enter a valid customer email address.", "invalid_appointment", "validation");
  if (billingEmail && !EMAIL_PATTERN.test(billingEmail)) throw new JunkwareAppointmentCreationError("Enter a valid billing email address.", "invalid_appointment", "validation");
  if (!/^\d{5}(?:-\d{4})?$/.test(billingZip)) throw new JunkwareAppointmentCreationError("Enter a valid billing ZIP code.", "invalid_appointment", "validation");
  if (!/^\d{5}(?:-\d{4})?$/.test(serviceZip)) throw new JunkwareAppointmentCreationError("Enter a valid service ZIP code.", "invalid_appointment", "validation");
  if (serviceContactPhone && serviceContactPhone.length !== 10) throw new JunkwareAppointmentCreationError("Enter a valid service-contact phone number.", "invalid_appointment", "validation");
  if (!Number.isFinite(estimatedPickups) || estimatedPickups < 0.5 || estimatedPickups > 6 || estimatedPickups * 2 % 1 !== 0) {
    throw new JunkwareAppointmentCreationError("Choose an estimated volume from 0.5 to 6 pickup-truck loads.", "invalid_appointment", "validation");
  }

  return {
    requestId,
    franchise,
    date,
    startTime,
    durationHours,
    truck,
    appointmentType,
    firstName,
    lastName,
    business,
    company,
    phone,
    email,
    billingAddress,
    billingZip,
    billingEmail,
    howHeard,
    serviceAddress,
    serviceZip,
    serviceContactName,
    serviceContactPhone,
    estimatedPickups,
    scope,
    notes,
    duplicateOverrideReason,
  };
}

function fingerprint(input: JunkwareAppointmentCreationInput): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function recordFile(requestId: string): string {
  return path.join(CREATION_DIRECTORY, `${requestId}.json`);
}

function readRecord(requestId: string): CreationRecord | null {
  try {
    return JSON.parse(fs.readFileSync(recordFile(requestId), "utf8")) as CreationRecord;
  } catch {
    return null;
  }
}

function writeRecord(record: CreationRecord): void {
  fs.mkdirSync(CREATION_DIRECTORY, { recursive: true, mode: 0o770 });
  const target = recordFile(record.requestId);
  const temporary = path.join(CREATION_DIRECTORY, `.${record.requestId}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, target);
}

async function ownerIsGone(lockDirectory: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await fs.promises.readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    const pid = Number(owner?.pid);
    if (!Number.isInteger(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ESRCH";
    }
  } catch {
    return false;
  }
}

async function withCreationLock<T>(callback: () => Promise<T>): Promise<T> {
  await fs.promises.mkdir(CREATION_DIRECTORY, { recursive: true, mode: 0o770 });
  const deadline = Date.now() + 5 * 60_000;
  while (true) {
    try {
      await fs.promises.mkdir(GLOBAL_LOCK_DIRECTORY, { mode: 0o770 });
      await fs.promises.writeFile(
        path.join(GLOBAL_LOCK_DIRECTORY, "owner.json"),
        JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
        { encoding: "utf8", mode: 0o660 },
      );
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - (await fs.promises.stat(GLOBAL_LOCK_DIRECTORY)).mtimeMs;
        if (age > 10 * 60_000 || await ownerIsGone(GLOBAL_LOCK_DIRECTORY)) {
          await fs.promises.rm(GLOBAL_LOCK_DIRECTORY, { recursive: true, force: true });
        }
      } catch {
        // Another writer may have released the lock between checks.
      }
      if (Date.now() >= deadline) throw new JunkwareAppointmentCreationError("Timed out waiting for another JunkWare appointment creation to finish.", "create_lock_timeout", "preflight");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  try {
    return await callback();
  } finally {
    await fs.promises.rm(GLOBAL_LOCK_DIRECTORY, { recursive: true, force: true }).catch(() => undefined);
  }
}

function normalizeAddress(value: unknown): string {
  return clean(value, 240).toLowerCase().replace(/[^a-z0-9]/g, "");
}

function time24(value: unknown): string {
  const text = clean(value, 40);
  const direct = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (direct && !/[ap]m/i.test(text)) return `${direct[1].padStart(2, "0")}:${direct[2]}`;
  const twelveHour = text.match(/\b(1[0-2]|0?\d):([0-5]\d)\s*([ap])\.?m\.?/i);
  if (!twelveHour) return "";
  let hour = Number(twelveHour[1]) % 12;
  if (twelveHour[3].toLowerCase() === "p") hour += 12;
  return `${String(hour).padStart(2, "0")}:${twelveHour[2]}`;
}

function duplicateAppointment(input: JunkwareAppointmentCreationInput): { jkNumber: string; appointmentId: string } | null {
  const dataDirectory = String(process.env.OPSBOT_DATA_DIR || "").trim()
    || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
  const source = path.join(dataDirectory, "history", "junkware", `junkware_${input.date}_raw.json`);
  try {
    const payload = JSON.parse(fs.readFileSync(source, "utf8")) as Record<string, unknown>;
    const rows = [
      ...(Array.isArray(payload.appointments) ? payload.appointments : []),
      ...(Array.isArray(payload.completed) ? payload.completed : []),
    ] as Array<Record<string, unknown>>;
    const match = rows.find((row) => {
      if (/cancel/i.test(clean(row.job_status || row.status, 40))) return false;
      return digits(row.phone || row.customer_phone) === input.phone
        && normalizeAddress(row.address || row.service_address || row.appointment_address) === normalizeAddress(input.serviceAddress)
        && time24(row.appointment_time || row.start_time) === input.startTime;
    });
    return match ? {
      jkNumber: clean(match.job_id || match.jk_number, 40),
      appointmentId: clean(match.appt_id || match.appointment_id, 20),
    } : null;
  } catch {
    return null;
  }
}

function parseScriptFailure(stderr: string): JunkwareAppointmentCreationError {
  const lines = stderr.trim().split("\n").filter(Boolean);
  try {
    const payload = JSON.parse(lines.at(-1) || "") as { error?: unknown; code?: unknown; stage?: unknown };
    const stage = payload.stage === "saving" || payload.stage === "verifying" ? payload.stage : "preflight";
    return new JunkwareAppointmentCreationError(
      clean(payload.error, 300) || "JunkWare could not create the appointment.",
      clean(payload.code, 80) || "appointment_creation_failed",
      stage,
    );
  } catch {
    return new JunkwareAppointmentCreationError(lines.at(-1)?.slice(0, 300) || "JunkWare could not create the appointment.");
  }
}

async function runCreationScript(input: JunkwareAppointmentCreationInput): Promise<JunkwareAppointmentCreationResult> {
  const script = path.join(process.cwd(), "scripts", "create-junkware-appointment.ts");
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", script], {
      cwd: process.cwd(),
      env: { ...process.env },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new JunkwareAppointmentCreationError("JunkWare did not finish appointment creation within three minutes.", "appointment_creation_timeout", "verifying"));
    }, 180_000);
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout = `${stdout}${chunk}`.slice(-1024 * 1024); });
    child.stderr.on("data", (chunk) => { stderr = `${stderr}${chunk}`.slice(-1024 * 1024); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(new JunkwareAppointmentCreationError(error.message));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(parseScriptFailure(stderr));
        return;
      }
      try {
        const payload = JSON.parse(stdout.trim()) as { ok?: boolean; result?: JunkwareAppointmentCreationResult };
        if (!payload.ok || !payload.result || !/^JK\d{4,12}$/.test(payload.result.jkNumber)) {
          throw new Error("JunkWare did not return a verified JK number.");
        }
        resolve(payload.result);
      } catch (error) {
        reject(new JunkwareAppointmentCreationError(error instanceof Error ? error.message : "JunkWare returned an invalid appointment result.", "invalid_junkware_result", "verifying"));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}

function stubResult(input: JunkwareAppointmentCreationInput): JunkwareAppointmentCreationResult {
  const jkNumber = String(process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_JK || "JK4999999").trim();
  const numeric = Number(jkNumber.replace(/^JK/i, ""));
  const appointmentId = Number.isSafeInteger(numeric) && numeric > 13_178 ? String(numeric - 13_178) : "4986821";
  return {
    appointmentId,
    jkNumber,
    appointmentUrl: `https://junkware.junk-king.com/franchise/appointment.aspx?id=${appointmentId}`,
    franchise: input.franchise,
    date: input.date,
    startTime: input.startTime,
    durationHours: input.durationHours,
    truck: input.truck,
    appointmentType: input.appointmentType,
    customerMode: "new",
    verifiedAt: new Date().toISOString(),
  };
}

export async function createJunkwareAppointment(value: unknown): Promise<{ result: JunkwareAppointmentCreationResult; replayed: boolean }> {
  const input = normalizeJunkwareAppointmentCreationInput(value);
  const inputFingerprint = fingerprint(input);
  const earlyRecord = readRecord(input.requestId);
  if (earlyRecord && earlyRecord.fingerprint !== inputFingerprint) {
    throw new JunkwareAppointmentCreationError("This appointment request changed after it was submitted. Review it again before creating.", "request_changed", "validation");
  }
  if (earlyRecord?.status === "verified" && earlyRecord.result) return { result: earlyRecord.result, replayed: true };

  return withCreationLock(async () => {
    const existing = readRecord(input.requestId);
    if (existing && existing.fingerprint !== inputFingerprint) {
      throw new JunkwareAppointmentCreationError("This appointment request changed after it was submitted. Review it again before creating.", "request_changed", "validation");
    }
    if (existing?.status === "verified" && existing.result) return { result: existing.result, replayed: true };
    if (existing?.status === "uncertain" || existing?.status === "creating") {
      throw new JunkwareAppointmentCreationError(
        "The previous JunkWare write could not be conclusively verified. Search JunkWare before creating another appointment.",
        "verification_required",
        "verifying",
      );
    }
    const duplicate = duplicateAppointment(input);
    if (duplicate && input.duplicateOverrideReason.length < 10) {
      const reference = duplicate.jkNumber || "an existing appointment";
      throw new JunkwareAppointmentCreationError(
        `${reference} already matches this phone, service address, date, and start time. Open it or enter a reason to create another appointment.`,
        "duplicate_appointment",
        "preflight",
      );
    }

    const now = new Date().toISOString();
    const creating: CreationRecord = {
      version: 1,
      requestId: input.requestId,
      fingerprint: inputFingerprint,
      status: "creating",
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    writeRecord(creating);

    try {
      const stubFailureStage = String(process.env.JUNKWARE_APPOINTMENT_CREATION_STUB_FAILURE_STAGE || "");
      if (process.env.JUNKWARE_APPOINTMENT_CREATION_STUB === "1" && ["preflight", "saving", "verifying"].includes(stubFailureStage)) {
        throw new JunkwareAppointmentCreationError(
          "Stubbed JunkWare appointment creation failure.",
          "stubbed_appointment_failure",
          stubFailureStage as JunkwareAppointmentCreationError["stage"],
        );
      }
      const result = process.env.JUNKWARE_APPOINTMENT_CREATION_STUB === "1"
        ? stubResult(input)
        : await runCreationScript(input);
      writeRecord({ ...creating, status: "verified", updatedAt: new Date().toISOString(), result });
      return { result, replayed: false };
    } catch (error) {
      const failure = error instanceof JunkwareAppointmentCreationError
        ? error
        : new JunkwareAppointmentCreationError(error instanceof Error ? error.message : "JunkWare could not create the appointment.");
      const uncertain = failure.stage === "saving" || failure.stage === "verifying";
      writeRecord({
        ...creating,
        status: uncertain ? "uncertain" : "failed",
        updatedAt: new Date().toISOString(),
        error: failure.message.slice(0, 300),
      });
      throw failure;
    }
  });
}
