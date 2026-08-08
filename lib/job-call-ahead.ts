import fs from "fs";
import path from "path";

export type JobCallAheadStatus = "called" | "not_called";

export type JobCallAheadRecord = {
  date: string;
  jobKey: string;
  status: JobCallAheadStatus;
  updatedAt: string;
};

type JobCallAheadStore = {
  version: 1;
  updatedAt: string;
  entries: JobCallAheadRecord[];
};

const STORE_FILE = path.join(process.cwd(), "data", "job-call-ahead", "statuses.json");

function emptyStore(): JobCallAheadStore {
  return { version: 1, updatedAt: "", entries: [] };
}

function readStore(): JobCallAheadStore {
  try {
    if (!fs.existsSync(STORE_FILE)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(STORE_FILE, "utf8"));
    const entries = (Array.isArray(payload?.entries) ? payload.entries : [])
      .map((entry: Record<string, unknown>): JobCallAheadRecord | null => {
        const date = String(entry.date || "").trim();
        const jobKey = String(entry.jobKey || "").trim();
        const status = String(entry.status || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !jobKey) return null;
        if (status !== "called" && status !== "not_called") return null;
        return {
          date,
          jobKey,
          status,
          updatedAt: String(entry.updatedAt || ""),
        };
      })
      .filter((entry: JobCallAheadRecord | null): entry is JobCallAheadRecord => Boolean(entry));

    return {
      version: 1,
      updatedAt: String(payload?.updatedAt || ""),
      entries,
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store: JobCallAheadStore): void {
  const directory = path.dirname(STORE_FILE);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(
    directory,
    `.${path.basename(STORE_FILE)}.${process.pid}.${Date.now()}.tmp`,
  );
  fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), {
    encoding: "utf8",
    mode: 0o660,
  });
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, STORE_FILE);
}

export function jobCallAheadLookupKey(date: string, jobKey: string): string {
  return `${date}|${jobKey}`;
}

export function readJobCallAheadStatuses(): Map<string, JobCallAheadStatus> {
  return new Map(
    readStore().entries.map((entry) => [jobCallAheadLookupKey(entry.date, entry.jobKey), entry.status]),
  );
}

export function saveJobCallAheadStatus(input: {
  date: string;
  jobKey: string;
  status: JobCallAheadStatus;
}): JobCallAheadRecord | null {
  const date = String(input.date || "").trim();
  const jobKey = String(input.jobKey || "").trim();
  const status = String(input.status || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !jobKey || jobKey.length > 500) return null;
  if (status !== "called" && status !== "not_called") return null;

  const now = new Date().toISOString();
  const saved: JobCallAheadRecord = { date, jobKey, status, updatedAt: now };
  const store = readStore();
  const entries = store.entries.filter((entry) => !(entry.date === date && entry.jobKey === jobKey));
  entries.push(saved);
  entries.sort((a, b) => `${a.date}|${a.jobKey}`.localeCompare(`${b.date}|${b.jobKey}`));
  writeStore({ version: 1, updatedAt: now, entries });
  return saved;
}
