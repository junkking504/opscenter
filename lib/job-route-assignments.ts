import fs from "fs";
import path from "path";
import type { JunkwareAssignmentSyncStatus } from "@/lib/junkware-assignment-failure";

export type JobRouteAssignment = {
  date: string;
  jobKey: string;
  truck: string;
  updatedAt: string;
  appointmentId?: string;
  appointmentTime?: string;
  appointmentStartMinutes?: number;
  appointmentEndMinutes?: number;
  junkwareVerifiedAt?: string;
  junkwareSyncStatus?: JunkwareAssignmentSyncStatus;
  junkwareSyncError?: string;
};

type JobRouteAssignmentStore = {
  version: 1;
  updatedAt: string;
  entries: JobRouteAssignment[];
};

const STORE_FILE = String(process.env.JOB_ROUTE_ASSIGNMENTS_FILE || "").trim()
  || path.join(process.cwd(), "data", "job-route-assignments", "assignments.json");
const STORE_LOCK_DIRECTORY = `${STORE_FILE}.lock`;
const SYNC_LOCK_DIRECTORY = path.join(path.dirname(STORE_FILE), ".junkware-assignment-sync.lock");
const APPOINTMENT_SYNC_LOCKS_DIRECTORY = path.join(path.dirname(STORE_FILE), ".junkware-appointment-sync-locks");

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
      if (Date.now() >= deadline) throw new Error("Timed out waiting to save the route assignment.");
      sleepSync(25);
    }
  }

  try {
    return callback();
  } finally {
    try {
      fs.rmdirSync(STORE_LOCK_DIRECTORY);
    } catch {
      // A stale-lock cleanup is safe on the next write if shutdown interrupts release.
    }
  }
}

async function lockOwnerIsGone(lockDirectory: string): Promise<boolean> {
  try {
    const owner = JSON.parse(await fs.promises.readFile(path.join(lockDirectory, "owner.json"), "utf8"));
    const ownerPid = Number(owner?.pid);
    if (!Number.isInteger(ownerPid) || ownerPid <= 0) return false;
    try {
      process.kill(ownerPid, 0);
      return false;
    } catch (error) {
      return error instanceof Error && "code" in error && error.code === "ESRCH";
    }
  } catch {
    return false;
  }
}

async function withJunkwareSyncLock<T>(lockDirectory: string, callback: () => Promise<T>): Promise<T> {
  await fs.promises.mkdir(path.dirname(lockDirectory), { recursive: true });
  const deadline = Date.now() + 5 * 60_000;
  while (true) {
    try {
      await fs.promises.mkdir(lockDirectory, { mode: 0o770 });
      try {
        await fs.promises.writeFile(
          path.join(lockDirectory, "owner.json"),
          JSON.stringify({ pid: process.pid, acquiredAt: new Date().toISOString() }),
          { encoding: "utf8", mode: 0o660 },
        );
      } catch (error) {
        await fs.promises.rm(lockDirectory, { force: true, recursive: true }).catch(() => undefined);
        throw error;
      }
      break;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") throw error;
      try {
        const age = Date.now() - (await fs.promises.stat(lockDirectory)).mtimeMs;
        if (age > 10 * 60_000 || await lockOwnerIsGone(lockDirectory)) {
          await fs.promises.rm(lockDirectory, { force: true, recursive: true });
        }
      } catch {
        // Another synchronizer may have released the lock between checks.
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for JunkWare assignment synchronization.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  try {
    return await callback();
  } finally {
    try {
      await fs.promises.rm(lockDirectory, { force: true, recursive: true });
    } catch {
      // A stale-lock cleanup is safe on the next synchronization attempt.
    }
  }
}

export async function withJobRouteAssignmentSyncLock<T>(callback: () => Promise<T>): Promise<T> {
  return withJunkwareSyncLock(SYNC_LOCK_DIRECTORY, callback);
}

export async function withJunkwareAppointmentSyncLock<T>(appointmentId: string, callback: () => Promise<T>): Promise<T> {
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("The JunkWare appointment ID is unavailable.");
  return withJunkwareSyncLock(path.join(APPOINTMENT_SYNC_LOCKS_DIRECTORY, `${appointmentId}.lock`), callback);
}

function emptyStore(): JobRouteAssignmentStore {
  return { version: 1, updatedAt: "", entries: [] };
}

function readStore(): JobRouteAssignmentStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    const entries = (Array.isArray(payload?.entries) ? payload.entries : [])
      .map((entry: Record<string, unknown>): JobRouteAssignment | null => {
        const date = String(entry.date || "").trim();
        const jobKey = String(entry.jobKey || "").trim();
        const truck = String(entry.truck || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !jobKey) return null;
        return {
          date,
          jobKey,
          truck,
          updatedAt: String(entry.updatedAt || ""),
          appointmentId: String(entry.appointmentId || "") || undefined,
          appointmentTime: String(entry.appointmentTime || "") || undefined,
          appointmentStartMinutes: Number.isInteger(entry.appointmentStartMinutes)
            ? Number(entry.appointmentStartMinutes)
            : undefined,
          appointmentEndMinutes: Number.isInteger(entry.appointmentEndMinutes)
            ? Number(entry.appointmentEndMinutes)
            : undefined,
          junkwareVerifiedAt: String(entry.junkwareVerifiedAt || "") || undefined,
          junkwareSyncStatus: entry.junkwareSyncStatus === "pending" || entry.junkwareSyncStatus === "manual_correction"
            ? entry.junkwareSyncStatus
            : "verified",
          junkwareSyncError: String(entry.junkwareSyncError || "") || undefined,
        };
      })
      .filter((entry: JobRouteAssignment | null): entry is JobRouteAssignment => Boolean(entry));

    return {
      version: 1,
      updatedAt: String(payload?.updatedAt || ""),
      entries,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: JobRouteAssignmentStore): void {
  const directory = path.dirname(STORE_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(
    directory,
    `.${path.basename(STORE_FILE)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    // The VPS container writes as pwuser while the host deployment user pulls
    // this state back during data sync. The setgid assignment directory keeps
    // the shared host group on each atomic replacement.
    mode: 0o660,
  });
  // writeFile's mode is filtered through the process umask. The hardened VPS
  // runtime uses a restrictive umask, so enforce the shared-state permissions
  // explicitly before the atomic replacement.
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, STORE_FILE);
}

export function readJobRouteAssignments(date: string): Map<string, string> {
  return new Map(
    readStore().entries
      .filter((entry) => entry.date === date)
      .map((entry) => [entry.jobKey, entry.truck]),
  );
}

export function readJobRouteAssignmentOverrides(date: string): Map<string, JobRouteAssignment> {
  return new Map(
    readStore().entries
      .filter((entry) => entry.date === date)
      .map((entry) => [entry.jobKey, entry]),
  );
}

export function readPendingJobRouteAssignments(): JobRouteAssignment[] {
  return readStore().entries
    .filter((entry) => entry.junkwareSyncStatus === "pending" && Boolean(entry.appointmentId))
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
}

export function saveJobRouteAssignment(input: {
  date: string;
  jobKey: string;
  truck: string;
  appointmentId?: string;
  appointmentTime?: string;
  appointmentStartMinutes?: number;
  appointmentEndMinutes?: number;
  junkwareVerifiedAt?: string;
  junkwareSyncStatus?: JunkwareAssignmentSyncStatus;
  junkwareSyncError?: string;
  expectedUpdatedAt?: string;
}): JobRouteAssignment | null {
  const date = String(input.date || "").trim();
  const jobKey = String(input.jobKey || "").trim();
  const truck = String(input.truck || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !jobKey || jobKey.length > 500) return null;
  if (truck && !/^Truck \d+$/i.test(truck)) return null;

  return withStoreLock(() => {
    const now = new Date().toISOString();
    const store = readStore();
    const existing = store.entries.find((entry) => entry.date === date && entry.jobKey === jobKey);
    const expectedUpdatedAt = String(input.expectedUpdatedAt || "").trim();
    if (expectedUpdatedAt && existing?.updatedAt !== expectedUpdatedAt) return null;
    const appointmentId = String(input.appointmentId || "").trim();
    const appointmentTime = String(input.appointmentTime || existing?.appointmentTime || "").trim();
    const appointmentStartMinutes = Number.isInteger(input.appointmentStartMinutes)
      ? Number(input.appointmentStartMinutes)
      : existing?.appointmentStartMinutes;
    const appointmentEndMinutes = Number.isInteger(input.appointmentEndMinutes)
      ? Number(input.appointmentEndMinutes)
      : existing?.appointmentEndMinutes;
    if (
      (appointmentStartMinutes !== undefined && (appointmentStartMinutes < 0 || appointmentStartMinutes >= 24 * 60))
      || (appointmentEndMinutes !== undefined && (appointmentEndMinutes <= 0 || appointmentEndMinutes > 24 * 60))
      || (appointmentStartMinutes !== undefined && appointmentEndMinutes !== undefined && appointmentEndMinutes <= appointmentStartMinutes)
    ) return null;
    const junkwareVerifiedAt = String(input.junkwareVerifiedAt || "").trim();
    const junkwareSyncStatus = input.junkwareSyncStatus === "pending" || input.junkwareSyncStatus === "manual_correction"
      ? input.junkwareSyncStatus
      : "verified";
    const junkwareSyncError = String(input.junkwareSyncError || "").trim().slice(0, 500);
    const saved: JobRouteAssignment = {
      date,
      jobKey,
      truck,
      updatedAt: now,
      ...(appointmentId ? { appointmentId } : {}),
      ...(appointmentTime ? { appointmentTime } : {}),
      ...(appointmentStartMinutes !== undefined ? { appointmentStartMinutes } : {}),
      ...(appointmentEndMinutes !== undefined ? { appointmentEndMinutes } : {}),
      ...(junkwareVerifiedAt ? { junkwareVerifiedAt } : {}),
      junkwareSyncStatus,
      ...(junkwareSyncError ? { junkwareSyncError } : {}),
    };
    const entries = store.entries.filter((entry) => !(entry.date === date && entry.jobKey === jobKey));
    entries.push(saved);
    entries.sort((a, b) => `${a.date}|${a.jobKey}`.localeCompare(`${b.date}|${b.jobKey}`));
    writeStore({ version: 1, updatedAt: now, entries });
    return saved;
  });
}
