import fs from "fs";
import path from "path";
import { unstable_noStore as noStore } from "next/cache";
import { chicagoDateKey } from "@/lib/report-dates";

export type DataHealthLevel = "green" | "yellow" | "red";
export type DataHealthOverall = "Healthy" | "Partial" | "Attention Required";
export type QboConnectionState = "Connected" | "Stale" | "Not Connected";

export type DataHealthSourceKey = "junkware" | "linxup" | "qbo";

export type DataHealthSource = {
  key: DataHealthSourceKey;
  label: string;
  status: DataHealthLevel;
  stateLabel: string;
  details: string;
  lastSuccessfulAt: string | null;
  lastSuccessfulAtLabel: string;
  ageMinutes: number | null;
  missingToday: boolean;
  partial: boolean;
  notes: string[];
};

export type DataHealthReport = {
  overall: DataHealthOverall;
  asOf: string | null;
  asOfLabel: string;
  sources: Record<DataHealthSourceKey, DataHealthSource>;
  missingFiles: string[];
  staleInputs: string[];
  fallbackValues: string[];
  recentErrors: string[];
};

type TimedFile = {
  file: string;
  fullPath: string;
  mtime: Date;
};

const AGE_GREEN = 10;
const AGE_YELLOW = 20;

function dataDir(...parts: string[]): string {
  return path.join(process.cwd(), "data", ...parts);
}

function chicagoNow(): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());

  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
}

function formatTimestamp(value: Date | string | null | undefined): string {
  if (!value) return "Unavailable";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "Unavailable";

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function minutesSince(value: Date | null, now: Date): number | null {
  if (!value) return null;
  const diff = now.getTime() - value.getTime();
  if (!Number.isFinite(diff)) return null;
  return diff / 60000;
}

function listFiles(dir: string, matcher: RegExp): TimedFile[] {
  if (!fs.existsSync(dir)) return [];

  const files: TimedFile[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!matcher.test(file)) continue;
    const fullPath = path.join(dir, file);
    try {
      const stat = fs.statSync(fullPath);
      files.push({
        file,
        fullPath,
        mtime: stat.mtime,
      });
    } catch {
      // Ignore files we cannot stat.
    }
  }

  return files.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
}

function latest(files: TimedFile[]): TimedFile | null {
  return files.length ? files[0] : null;
}

function sourceHealthLabel(level: DataHealthLevel): string {
  if (level === "green") return "Healthy";
  if (level === "yellow") return "Partial";
  return "Attention Required";
}

function styleForAge(ageMinutes: number | null, missingToday: boolean): DataHealthLevel {
  if (missingToday) return "red";
  if (ageMinutes == null) return "red";
  if (ageMinutes <= AGE_GREEN) return "green";
  if (ageMinutes <= AGE_YELLOW) return "yellow";
  return "red";
}

function collectRecentErrors(): string[] {
  const logsDir = path.join(process.cwd(), "logs");
  if (!fs.existsSync(logsDir)) return [];

  const candidates = listFiles(logsDir, /\.(log|err|out)$/i)
    .map((entry) => {
      try {
        const content = fs.readFileSync(entry.fullPath, "utf8");
        const lines = content
          .split(/\r?\n/)
          .filter((line) => /error|err|fail|exception|referenceerror|typeerror/i.test(line))
          .slice(-5);
        return lines.map((line) => `${entry.file}: ${line.trim()}`);
      } catch {
        return [];
      }
    })
    .flat();

  return candidates.slice(-5);
}

function hasFileMatching(files: TimedFile[], matcher: RegExp): boolean {
  return files.some((file) => matcher.test(file.file));
}

function buildSource(
  key: DataHealthSourceKey,
  label: string,
  files: TimedFile[],
  options?: {
    todayOnly?: boolean;
    partialNotes?: string[];
    unavailableLabel?: string;
    overrideLevel?: DataHealthLevel | null;
    freshnessFiles?: TimedFile[];
  },
): DataHealthSource {
  const now = chicagoNow();
  const today = chicagoDateKey(now);
  const freshnessFiles = options?.freshnessFiles ?? files;
  const todayFiles = freshnessFiles.filter((file) => file.file.includes(today));
  const latestFile = latest(options?.todayOnly === false ? freshnessFiles : todayFiles);
  const fallbackLatest = latest(freshnessFiles);
  const chosen = latestFile || fallbackLatest;
  const missingToday = options?.todayOnly !== false && todayFiles.length === 0;
  const ageMinutes = minutesSince(chosen?.mtime ?? null, now);
  let baseLevel: DataHealthLevel = options?.overrideLevel ?? styleForAge(ageMinutes, missingToday);

  const partial = Boolean(options?.partialNotes?.length) || (todayFiles.length > 0 && todayFiles.length < files.length);
  if (!missingToday && partial && baseLevel === "green") {
    baseLevel = "yellow";
  }

  const stateLabel =
    key === "qbo"
      ? (baseLevel === "green"
          ? "Connected"
          : missingToday && files.length === 0
            ? "Not Connected"
            : "Stale")
      : sourceHealthLabel(baseLevel);

  const details =
    key === "qbo"
      ? stateLabel
      : missingToday
        ? options?.unavailableLabel || "Today's files missing"
        : partial
          ? "Partial data"
          : stateLabel;

  const notes = [
    ...(missingToday ? ["Today's files are missing."] : []),
    ...(options?.partialNotes || []),
    ...(chosen ? [`Latest file: ${chosen.file}`] : []),
  ];

  return {
    key,
    label,
    status: baseLevel,
    stateLabel,
    details,
    lastSuccessfulAt: chosen?.mtime ? chosen.mtime.toISOString() : null,
    lastSuccessfulAtLabel: formatTimestamp(chosen?.mtime ?? null),
    ageMinutes,
    missingToday,
    partial,
    notes,
  };
}

export function getDataHealthReport(): DataHealthReport {
  noStore();

  const today = chicagoDateKey(chicagoNow());
  const junkwareFiles = listFiles(dataDir("history", "junkware"), new RegExp(today, "i"));
  const linxupFiles = [
    ...listFiles(dataDir("history", "linxup"), new RegExp(today, "i")),
    ...listFiles(dataDir("history", "linxup", "appointment_visits"), new RegExp(today, "i")),
  ];
  const linxupLocationFiles = linxupFiles.filter((file) => /^linxup_location_\d{4}-\d{2}-\d{2}\.json$/i.test(file.file));
  const qboFiles = listFiles(dataDir("history", "qbo"), /^qbo_(\d{4}-\d{2}-\d{2}).*\.(csv|json)$/i);

  const junkwarePartialNotes = [
    !hasFileMatching(junkwareFiles, /junkware_.*_raw\.json$/i) ? "Raw JunkWare file missing." : "",
    !hasFileMatching(junkwareFiles, /junkware_live_.*_summary\.csv$/i) ? "Live summary missing." : "",
    !hasFileMatching(junkwareFiles, /junkware_completed_.*_summary\.csv$/i) ? "Completed summary missing." : "",
    !hasFileMatching(junkwareFiles, /junkware_employees_.*_summary\.csv$/i) ? "Employee summary missing." : "",
    !hasFileMatching(junkwareFiles, /junkware_truck_records_.*\.csv$/i) ? "Truck records missing." : "",
  ].filter(Boolean) as string[];

  const linxupPartialNotes = [
    !hasFileMatching(linxupFiles, /linxup_.*_raw\.json$/i) ? "Raw Linxup file missing." : "",
    !hasFileMatching(linxupFiles, /linxup_.*_summary\.csv$/i) ? "Linxup summary missing." : "",
    !hasFileMatching(linxupFiles, /linxup_location_.*\.json$/i) ? "Location history missing." : "",
    !hasFileMatching(linxupFiles, /appointment_visits_.*\.(json|csv)$/i) ? "Appointment visit history missing." : "",
  ].filter(Boolean) as string[];

  const junkware = buildSource("junkware", "JunkWare", junkwareFiles, {
    unavailableLabel: "Today's JunkWare files are missing",
    partialNotes: junkwarePartialNotes,
  });

  const linxup = buildSource("linxup", "Linxup", linxupFiles, {
    unavailableLabel: "Today's Linxup files are missing",
    partialNotes: linxupPartialNotes.length ? linxupPartialNotes : [],
    // The Fleet map consumes normalized location history. Legacy daily raw,
    // summary, and appointment-visit files must not mask a stalled map feed.
    freshnessFiles: linxupLocationFiles,
  });

  const qboLatest = latest(qboFiles);
  const qboTodayFiles = qboFiles.filter((file) => file.file.includes(today));
  const qboHasAnyValid = qboFiles.length > 0;
  const qboAgeMinutes = minutesSince(qboLatest?.mtime ?? null, chicagoNow());
  const qboStatus: QboConnectionState =
    qboTodayFiles.length > 0 && qboAgeMinutes !== null && qboAgeMinutes <= AGE_GREEN
      ? "Connected"
      : qboHasAnyValid
        ? "Stale"
        : "Not Connected";
  const qboHealth: DataHealthLevel =
    qboStatus === "Connected" ? "green" : qboStatus === "Stale" ? "yellow" : "red";

  const qbo: DataHealthSource = {
    key: "qbo",
    label: "QBO",
    status: qboHealth,
    stateLabel: qboStatus,
    details:
      qboStatus === "Connected"
        ? "Connected"
        : qboStatus === "Stale"
          ? "Historical files only"
          : "No valid QBO files found",
    lastSuccessfulAt: qboLatest?.mtime ? qboLatest.mtime.toISOString() : null,
    lastSuccessfulAtLabel: formatTimestamp(qboLatest?.mtime ?? null),
    ageMinutes: qboAgeMinutes,
    missingToday: qboTodayFiles.length === 0,
    partial: qboStatus === "Stale",
    notes: [
      qboTodayFiles.length === 0 ? "No QBO files for today." : "Today’s QBO files are present.",
      qboLatest ? `Latest file: ${qboLatest.file}` : "No QBO files available.",
    ],
  };

  const sources: Record<DataHealthSourceKey, DataHealthSource> = {
    junkware,
    linxup,
    qbo,
  };

  const statuses = Object.values(sources).map((source) => source.status);
  const overall: DataHealthOverall =
    statuses.includes("red") ? "Attention Required" : statuses.includes("yellow") ? "Partial" : "Healthy";

  const timestamps = Object.values(sources)
    .map((source) => source.lastSuccessfulAt)
    .filter(Boolean)
    .map((value) => new Date(String(value)).getTime())
    .filter((value) => Number.isFinite(value));

  const asOf = timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null;
  const asOfLabel = formatTimestamp(asOf);

  const missingFiles = [
    ...junkware.notes.filter((note) => /missing/i.test(note)),
    ...linxup.notes.filter((note) => /missing/i.test(note)),
  ];

  const staleInputs = [
    ...(junkware.status === "yellow" ? ["JunkWare data older than 10 minutes."] : []),
    ...(linxup.status === "yellow" ? ["Linxup data older than 10 minutes."] : []),
    ...(qbo.status !== "green" ? [`QBO is ${qbo.stateLabel.toLowerCase()}.`] : []),
  ];

  const fallbackValues: string[] = [];

  return {
    overall,
    asOf,
    asOfLabel,
    sources,
    missingFiles: Array.from(new Set(missingFiles)),
    staleInputs: Array.from(new Set(staleInputs)),
    fallbackValues: Array.from(new Set(fallbackValues)),
    recentErrors: collectRecentErrors(),
  };
}
