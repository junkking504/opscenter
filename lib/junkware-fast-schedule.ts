import fs from "fs";
import path from "path";

export type JunkwareScheduleRow = Record<string, unknown>;

export type JunkwareFastSchedule = {
  appointments: JunkwareScheduleRow[];
  cancelled: JunkwareScheduleRow[];
  updatedAt: string | null;
};

const MARKET_IDS = ["352", "477", "399", "484"] as const;

function snapshotFiles(dataDir: string, date: string): string[] {
  const historyDir = path.join(dataDir, "history", "junkware");
  return [
    path.join(historyDir, `junkware_schedule_fast_${date}.json`),
    ...MARKET_IDS.map((marketId) => path.join(
      historyDir,
      "schedule-watchers",
      marketId,
      `junkware_schedule_fast_${date}.json`,
    )),
  ];
}

export function junkwareScheduleRowKey(row: JunkwareScheduleRow): string {
  const appointmentId = String(row.appt_id || row.appointment_id || row.appointmentId || "").trim();
  if (appointmentId) return `appt:${appointmentId}`;
  const jobId = String(row.job_id || row.jk_number || row.jobNumber || "").trim();
  if (jobId) return `job:${jobId.toLowerCase()}`;
  return JSON.stringify(row);
}

function mergeRows(rows: JunkwareScheduleRow[]): JunkwareScheduleRow[] {
  const unique = new Map<string, JunkwareScheduleRow>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const key = junkwareScheduleRowKey(row);
    if (!unique.has(key)) unique.set(key, row);
  }
  return Array.from(unique.values());
}

export function readJunkwareFastSchedule(dataDir: string, date: string): JunkwareFastSchedule {
  const appointments: JunkwareScheduleRow[] = [];
  const cancelled: JunkwareScheduleRow[] = [];
  const updatedAt: Date[] = [];

  for (const file of snapshotFiles(dataDir, date)) {
    try {
      const stat = fs.statSync(file);
      const payload = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
      updatedAt.push(stat.mtime);
      if (Array.isArray(payload.appointments)) appointments.push(...payload.appointments as JunkwareScheduleRow[]);
      if (Array.isArray(payload.cancelled)) cancelled.push(...payload.cancelled as JunkwareScheduleRow[]);
    } catch {
      // A watcher may atomically replace its snapshot while this page is reading it.
    }
  }

  const latest = updatedAt.sort((left, right) => right.getTime() - left.getTime())[0] || null;
  return {
    appointments: mergeRows(appointments),
    cancelled: mergeRows(cancelled),
    updatedAt: latest?.toISOString() || null,
  };
}
