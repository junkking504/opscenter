import fs from "node:fs";
import path from "node:path";
import { readMetrics } from "@/lib/opsData";

export type JobCrewNote = {
  date: string;
  jobKey: string;
  appointmentId: string;
  body: string;
  updatedAt: string;
  updatedBy: string;
};

export type CrewJobNote = Pick<JobCrewNote, "date" | "jobKey" | "appointmentId" | "body" | "updatedAt"> & {
  customerName: string;
  address: string;
  appointmentTime: string;
  truck: string;
};

type JobCrewNoteStore = { version: 1; updatedAt: string; entries: JobCrewNote[] };

const STORE_FILE = String(process.env.JOB_CREW_NOTES_FILE || "").trim()
  || path.join(process.cwd(), "data", "job-crew-notes", "notes.json");
const STORE_LOCK_DIRECTORY = `${STORE_FILE}.lock`;

function emptyStore(): JobCrewNoteStore {
  return { version: 1, updatedAt: "", entries: [] };
}

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
        if (Date.now() - fs.statSync(STORE_LOCK_DIRECTORY).mtimeMs > 5 * 60_000) fs.rmdirSync(STORE_LOCK_DIRECTORY);
      } catch {
        // Another writer may have released the lock between checks.
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting to save the crew note.");
      sleepSync(25);
    }
  }
  try {
    return callback();
  } finally {
    try { fs.rmdirSync(STORE_LOCK_DIRECTORY); } catch {
      // A later save can safely remove a stale lock after an interrupted write.
    }
  }
}

function normalizeEntry(value: unknown): JobCrewNote | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const date = String(row.date || "").trim();
  const jobKey = String(row.jobKey || "").trim();
  const appointmentId = String(row.appointmentId || "").trim();
  const body = String(row.body || "").trim().slice(0, 2_000);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}` || !body) return null;
  return { date, jobKey, appointmentId, body, updatedAt: String(row.updatedAt || "").trim(), updatedBy: String(row.updatedBy || "").trim().slice(0, 200) };
}

function readStore(): JobCrewNoteStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    return {
      version: 1,
      updatedAt: String(payload?.updatedAt || ""),
      entries: (Array.isArray(payload?.entries) ? payload.entries : []).map(normalizeEntry).filter((entry: JobCrewNote | null): entry is JobCrewNote => Boolean(entry)),
    };
  } catch { return emptyStore(); }
}

function writeStore(store: JobCrewNoteStore): void {
  const directory = path.dirname(STORE_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${path.basename(STORE_FILE)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, STORE_FILE);
}

export function jobCrewNoteLookupKey(date: string, jobKey: string): string {
  return `${date}|${jobKey}`;
}

export function readJobCrewNotes(date?: string): Map<string, JobCrewNote> {
  return new Map(readStore().entries.filter((entry) => !date || entry.date === date).map((entry) => [jobCrewNoteLookupKey(entry.date, entry.jobKey), entry]));
}

export function saveJobCrewNote(input: { date: string; jobKey: string; appointmentId: string; body: string; updatedBy: string }): JobCrewNote | null {
  const date = String(input.date || "").trim();
  const jobKey = String(input.jobKey || "").trim();
  const appointmentId = String(input.appointmentId || "").trim();
  const body = String(input.body || "").trim().slice(0, 2_000);
  const updatedBy = String(input.updatedBy || "").trim().slice(0, 200);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}` || !body) return null;
  return withStoreLock(() => {
    const now = new Date().toISOString();
    const note: JobCrewNote = { date, jobKey, appointmentId, body, updatedAt: now, updatedBy };
    const store = readStore();
    const entries = store.entries.filter((entry) => entry.date !== date || entry.jobKey !== jobKey);
    entries.push(note);
    entries.sort((left, right) => jobCrewNoteLookupKey(left.date, left.jobKey).localeCompare(jobCrewNoteLookupKey(right.date, right.jobKey)));
    writeStore({ version: 1, updatedAt: now, entries });
    return note;
  });
}

export function removeJobCrewNote(input: { date: string; jobKey: string; appointmentId: string }): boolean {
  const date = String(input.date || "").trim();
  const jobKey = String(input.jobKey || "").trim();
  const appointmentId = String(input.appointmentId || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{1,12}$/.test(appointmentId) || jobKey !== `appt:${appointmentId}`) return false;
  return withStoreLock(() => {
    const store = readStore();
    const entries = store.entries.filter((entry) => entry.date !== date || entry.jobKey !== jobKey);
    if (entries.length === store.entries.length) return false;
    writeStore({ version: 1, updatedAt: new Date().toISOString(), entries });
    return true;
  });
}

function normalizedPerson(value: unknown): string {
  return String(value || "").trim().toLocaleLowerCase().replace(/[,]+/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
}

function people(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(people);
  return String(value || "").split(/[|;]/).map(normalizedPerson).filter(Boolean);
}

function crewAssignedTo(appointment: Record<string, unknown>, employee: string): boolean {
  const target = normalizedPerson(employee);
  if (!target) return false;
  return [appointment.driver_name, appointment.driver, appointment.driver_normalized_name, appointment.navigator_name, appointment.navigator, appointment.navigator_normalized_name, appointment.crew, appointment.additional_crew].flatMap(people).includes(target);
}

function timeSortValue(value: unknown): number {
  const match = String(value || "").match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!match) return Number.MAX_SAFE_INTEGER;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

export function crewJobNotesFromAppointments(employee: string, date: string, appointments: unknown, notes: Map<string, JobCrewNote>): CrewJobNote[] {
  if (!Array.isArray(appointments)) return [];
  const visible: CrewJobNote[] = [];
  for (const value of appointments) {
    const appointment = value && typeof value === "object" ? value as Record<string, unknown> : null;
    const appointmentId = String(appointment?.appt_id || appointment?.appointment_id || "").trim();
    if (!appointment || !/^\d{1,12}$/.test(appointmentId) || !crewAssignedTo(appointment, employee)) continue;
    const note = notes.get(jobCrewNoteLookupKey(date, `appt:${appointmentId}`));
    if (!note) continue;
    visible.push({ date, jobKey: note.jobKey, appointmentId, body: note.body, updatedAt: note.updatedAt, customerName: String(appointment.customer_name || appointment.customer || "Customer").trim() || "Customer", address: String(appointment.service_address || appointment.address || "Address unavailable").trim() || "Address unavailable", appointmentTime: String(appointment.appointment_time || appointment.time || "Time unavailable").trim() || "Time unavailable", truck: String(appointment.assigned_truck || appointment.truck || "Truck assignment unavailable").trim() || "Truck assignment unavailable" });
  }
  return visible.sort((left, right) => timeSortValue(left.appointmentTime) - timeSortValue(right.appointmentTime));
}

export function readCrewJobNotesForEmployee(employee: string, date: string): CrewJobNote[] {
  const metrics = readMetrics(date);
  return crewJobNotesFromAppointments(employee, date, metrics?.appointments, readJobCrewNotes(date));
}
