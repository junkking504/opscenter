import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

type RawAppointment = Record<string, unknown>;

type SeenAppointment = {
  appointmentId: string;
  scheduleDate: string;
  firstSeenAt: string;
  initialTruck: string;
  status: "baseline" | "already_virtual" | "moved" | "skipped" | "retry";
  attempts: number;
  channel?: "online" | "call_center";
  bookedAt?: string;
  lastCheckedAt?: string;
  error?: string;
};

type State = {
  version: 1;
  updatedAt: string;
  appointments: Record<string, SeenAppointment>;
};

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function emptyState(): State {
  return { version: 1, updatedAt: "", appointments: {} };
}

function readState(stateFile: string): State {
  try {
    const payload = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return payload?.version === 1 && payload?.appointments && typeof payload.appointments === "object"
      ? payload as State
      : emptyState();
  } catch {
    return emptyState();
  }
}

function writeState(stateFile: string, state: State): void {
  const directory = path.dirname(stateFile);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${path.basename(stateFile)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporaryFile, stateFile);
}

function appointmentRows(rawFile: string): RawAppointment[] {
  const payload = JSON.parse(fs.readFileSync(rawFile, "utf8"));
  return [
    ...(Array.isArray(payload?.appointments) ? payload.appointments : []),
    ...(Array.isArray(payload?.completed) ? payload.completed : []),
    ...(Array.isArray(payload?.cancelled) ? payload.cancelled : []),
  ];
}

function isVirtualTruck(value: unknown): boolean {
  const truck = String(value || "").trim();
  return !truck || /^(?:z\s+)?virtual truck$/i.test(truck);
}

function terminalStatus(row: RawAppointment): boolean {
  const status = `${String(row.job_status || "")} ${String(row.final_status || "")}`;
  return /complete|cancel|on route|en route|closed/i.test(status);
}

function pruneState(state: State): void {
  const cutoff = Date.now() - 120 * 24 * 60 * 60_000;
  for (const [appointmentId, entry] of Object.entries(state.appointments)) {
    const firstSeen = Date.parse(entry.firstSeenAt);
    if (Number.isFinite(firstSeen) && firstSeen < cutoff && entry.status !== "retry") {
      delete state.appointments[appointmentId];
    }
  }
}

function main(): void {
  const date = argument("date");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid schedule date is required.");
  const dataDirectory = argument("data-dir")
    || String(process.env.OPSBOT_DATA_DIR || "").trim()
    || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
  const rawFile = path.join(dataDirectory, "history", "junkware", `junkware_${date}_raw.json`);
  if (!fs.existsSync(rawFile)) throw new Error(`JunkWare schedule data is unavailable for ${date}.`);
  const stateFile = argument("state-file")
    || path.join(dataDirectory, "job-virtual-truck-defaults", "state.json");
  const initialize = process.argv.includes("--initialize");
  const state = readState(stateFile);
  const now = new Date().toISOString();
  const rows = appointmentRows(rawFile);
  let baselined = 0;
  let checked = 0;
  let moved = 0;
  let alreadyVirtual = 0;
  let skipped = 0;
  let retry = 0;

  for (const row of rows) {
    const appointmentId = String(row.appt_id || row.appointment_id || "").trim();
    if (!/^\d{1,12}$/.test(appointmentId)) continue;
    const existing = state.appointments[appointmentId];
    if (existing && existing.status !== "retry") continue;
    const initialTruck = String(row.truck || row.assigned_truck || "").trim();
    const entry: SeenAppointment = existing || {
      appointmentId,
      scheduleDate: date,
      firstSeenAt: now,
      initialTruck,
      status: "baseline",
      attempts: 0,
    };

    if (initialize) {
      state.appointments[appointmentId] = entry;
      baselined += 1;
      continue;
    }
    if (terminalStatus(row)) {
      entry.status = "skipped";
      entry.lastCheckedAt = now;
      state.appointments[appointmentId] = entry;
      skipped += 1;
      continue;
    }
    if (isVirtualTruck(initialTruck)) {
      entry.status = "already_virtual";
      entry.lastCheckedAt = now;
      state.appointments[appointmentId] = entry;
      alreadyVirtual += 1;
      continue;
    }

    checked += 1;
    entry.attempts += 1;
    entry.lastCheckedAt = now;
    try {
      const syncScript = path.join(process.cwd(), "scripts", "sync-junkware-truck-assignment.ts");
      const stdout = execFileSync(process.execPath, [
        "--import",
        "tsx",
        syncScript,
        "--appointment",
        appointmentId,
        "--auto-virtual-external",
        "--max-age-minutes",
        "120",
      ], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 1024 * 1024,
        env: { ...process.env, OPSBOT_DATA_DIR: dataDirectory },
      });
      const result = JSON.parse(stdout.trim());
      entry.channel = result.channel === "online" || result.channel === "call_center" ? result.channel : undefined;
      entry.bookedAt = String(result.bookedAt || "") || undefined;
      entry.error = undefined;
      if (result.changed) {
        entry.status = "moved";
        moved += 1;
      } else {
        entry.status = result.skipped ? "skipped" : "already_virtual";
        if (result.skipped) skipped += 1;
        else alreadyVirtual += 1;
      }
    } catch (error) {
      entry.status = "retry";
      entry.error = (error instanceof Error ? error.message : String(error)).split("\n")[0].slice(0, 500);
      retry += 1;
    }
    state.appointments[appointmentId] = entry;
    state.updatedAt = new Date().toISOString();
    writeState(stateFile, state);
  }

  pruneState(state);
  state.updatedAt = new Date().toISOString();
  writeState(stateFile, state);
  process.stdout.write(`${JSON.stringify({
    ok: retry === 0,
    date,
    initialize,
    baselined,
    checked,
    moved,
    alreadyVirtual,
    skipped,
    retry,
    stateFile,
  })}\n`);
  if (retry > 0) process.exitCode = 1;
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
