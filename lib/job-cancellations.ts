import fs from "node:fs";
import path from "node:path";

export type VerifiedJobCancellation = {
  date: string;
  appointmentId: string;
  jobKey: string;
  jkNumber: string;
  customerName: string;
  canceledAt: string;
  junkwareVerifiedAt: string;
};

type JobCancellationStore = {
  version: 1;
  updatedAt: string;
  entries: VerifiedJobCancellation[];
};

const STORE_FILE = String(process.env.JOB_CANCELLATIONS_FILE || "").trim()
  || path.join(process.cwd(), "data", "job-cancellations", "cancellations.json");
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
      if (Date.now() >= deadline) throw new Error("Timed out waiting to record the cancellation.");
      sleepSync(25);
    }
  }

  try {
    return callback();
  } finally {
    try {
      fs.rmdirSync(STORE_LOCK_DIRECTORY);
    } catch {
      // A stale lock is safe to clean up on the next write.
    }
  }
}

function normalizedEntry(value: unknown): VerifiedJobCancellation | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const date = String(row.date || "").trim();
  const appointmentId = String(row.appointmentId || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(appointmentId)) return null;
  return {
    date,
    appointmentId,
    jobKey: `appt:${appointmentId}`,
    jkNumber: String(row.jkNumber || "").trim().slice(0, 40),
    customerName: String(row.customerName || "").trim().slice(0, 200),
    canceledAt: String(row.canceledAt || "").trim(),
    junkwareVerifiedAt: String(row.junkwareVerifiedAt || "").trim(),
  };
}

function readStore(): JobCancellationStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return { version: 1, updatedAt: "", entries: [] };
    const payload = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      version: 1,
      updatedAt: String(payload?.updatedAt || ""),
      entries: (Array.isArray(payload?.entries) ? payload.entries : [])
        .map(normalizedEntry)
        .filter((entry: VerifiedJobCancellation | null): entry is VerifiedJobCancellation => Boolean(entry)),
    };
  } catch {
    return { version: 1, updatedAt: "", entries: [] };
  }
}

function writeStore(store: JobCancellationStore): void {
  const temporaryFile = path.join(
    path.dirname(STORE_FILE),
    `.${path.basename(STORE_FILE)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.renameSync(temporaryFile, STORE_FILE);
}

export function readVerifiedJobCancellations(date?: string): VerifiedJobCancellation[] {
  const entries = readStore().entries;
  return date ? entries.filter((entry) => entry.date === date) : entries;
}

export function saveVerifiedJobCancellation(input: VerifiedJobCancellation): VerifiedJobCancellation {
  const normalized = normalizedEntry(input);
  if (!normalized) throw new Error("The verified cancellation could not be recorded.");
  return withStoreLock(() => {
    const store = readStore();
    const entry = {
      ...normalized,
      canceledAt: normalized.canceledAt || new Date().toISOString(),
      junkwareVerifiedAt: normalized.junkwareVerifiedAt || new Date().toISOString(),
    };
    store.entries = [
      ...store.entries.filter((candidate) => candidate.appointmentId !== entry.appointmentId),
      entry,
    ].sort((left, right) => left.date.localeCompare(right.date) || left.appointmentId.localeCompare(right.appointmentId));
    store.updatedAt = new Date().toISOString();
    writeStore(store);
    return entry;
  });
}
