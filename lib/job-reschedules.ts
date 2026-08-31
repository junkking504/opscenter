import fs from "node:fs";
import path from "node:path";

export type VerifiedJobReschedule = {
  appointmentId: string;
  jobKey: string;
  sourceDate: string;
  destinationDate: string;
  previousAppointmentStartMinutes: number;
  appointmentStartMinutes: number;
  movedAt: string;
  junkwareVerifiedAt: string;
};

type JobRescheduleStore = {
  version: 1;
  updatedAt: string;
  entries: VerifiedJobReschedule[];
};

const STORE_FILE = String(process.env.JOB_RESCHEDULES_FILE || "").trim()
  || path.join(process.cwd(), "data", "job-reschedules", "reschedules.json");
const STORE_LOCK_DIRECTORY = `${STORE_FILE}.lock`;

function sleepSync(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withStoreLock<T>(callback: () => T): T {
  fs.mkdirSync(path.dirname(STORE_FILE), { recursive: true });
  const deadline = Date.now() + 10_000;
  while (true) {
    try {
      fs.mkdirSync(STORE_LOCK_DIRECTORY, { mode: 0o770 });
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(STORE_LOCK_DIRECTORY).mtimeMs;
        if (age > 5 * 60_000) fs.rmdirSync(STORE_LOCK_DIRECTORY);
      } catch {
        // Another writer may have released the lock between checks.
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting to record the appointment move.");
      sleepSync(25);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.rmdirSync(STORE_LOCK_DIRECTORY); } catch { /* stale locks are cleaned on the next write */ }
  }
}

function normalize(value: unknown): VerifiedJobReschedule | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const appointmentId = String(row.appointmentId || "").trim();
  const sourceDate = String(row.sourceDate || "").trim();
  const destinationDate = String(row.destinationDate || "").trim();
  const previousAppointmentStartMinutes = Number(row.previousAppointmentStartMinutes);
  const appointmentStartMinutes = Number(row.appointmentStartMinutes);
  if (
    !/^\d{1,12}$/.test(appointmentId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(sourceDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(destinationDate)
    || !Number.isInteger(previousAppointmentStartMinutes)
    || !Number.isInteger(appointmentStartMinutes)
  ) return null;
  return {
    appointmentId,
    jobKey: `appt:${appointmentId}`,
    sourceDate,
    destinationDate,
    previousAppointmentStartMinutes,
    appointmentStartMinutes,
    movedAt: String(row.movedAt || "").trim(),
    junkwareVerifiedAt: String(row.junkwareVerifiedAt || "").trim(),
  };
}

function readStore(): JobRescheduleStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return { version: 1, updatedAt: "", entries: [] };
    const payload = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      version: 1,
      updatedAt: String(payload?.updatedAt || ""),
      entries: (Array.isArray(payload?.entries) ? payload.entries : []).map(normalize).filter(Boolean) as VerifiedJobReschedule[],
    };
  } catch {
    return { version: 1, updatedAt: "", entries: [] };
  }
}

function writeStore(store: JobRescheduleStore): void {
  const temporaryFile = path.join(path.dirname(STORE_FILE), `.${path.basename(STORE_FILE)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.renameSync(temporaryFile, STORE_FILE);
}

export function readVerifiedJobReschedules(sourceDate?: string): VerifiedJobReschedule[] {
  const entries = readStore().entries;
  return sourceDate ? entries.filter((entry) => entry.sourceDate === sourceDate) : entries;
}

export function saveVerifiedJobReschedule(input: VerifiedJobReschedule): VerifiedJobReschedule {
  const entry = normalize(input);
  if (!entry) throw new Error("The verified appointment move could not be recorded.");
  return withStoreLock(() => {
    const store = readStore();
    const saved = {
      ...entry,
      movedAt: entry.movedAt || new Date().toISOString(),
      junkwareVerifiedAt: entry.junkwareVerifiedAt || new Date().toISOString(),
    };
    store.entries = [
      ...store.entries.filter((candidate) => candidate.appointmentId !== saved.appointmentId),
      saved,
    ].sort((left, right) => left.sourceDate.localeCompare(right.sourceDate) || left.appointmentId.localeCompare(right.appointmentId));
    store.updatedAt = new Date().toISOString();
    writeStore(store);
    return saved;
  });
}
