import fs from "fs";
import path from "path";

export type LinxupOdometerSource = "true" | "virtual" | "estimated" | "unavailable";

export type LinxupVehicleProfile = {
  truck: string;
  trackerId: string;
  vin: string;
  licensePlate: string;
  odometer: number | null;
  odometerSource: LinxupOdometerSource;
  make: string;
  model: string;
  year: string;
  status: string;
  lastReportedAt: string;
};

export type LinxupVehicleInventory = {
  sourceDate: string;
  retrievedAt: string;
  vehicles: LinxupVehicleProfile[];
};

type RawRecord = Record<string, unknown>;

function dataRoots(): string[] {
  return [
    process.cwd(),
    path.join(process.cwd(), "..", "opsbot"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot"),
  ];
}

function normalizeTruck(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/truck\s*#?\s*(\d+)/i);
  return match ? `Truck# ${match[1]}` : "";
}

function latestRawFile(): { filePath: string; date: string } | null {
  const candidates: Array<{ filePath: string; date: string; rootIndex: number }> = [];
  dataRoots().forEach((root, rootIndex) => {
    const directory = path.join(root, "data", "history", "linxup");
    if (!fs.existsSync(directory)) return;
    try {
      for (const name of fs.readdirSync(directory)) {
        const match = name.match(/^linxup_(\d{4}-\d{2}-\d{2})_raw\.json$/);
        if (!match) continue;
        candidates.push({ filePath: path.join(directory, name), date: match[1], rootIndex });
      }
    } catch {
      // A missing/unreadable external history root should not suppress local fleet data.
    }
  });

  candidates.sort((a, b) => b.date.localeCompare(a.date) || a.rootIndex - b.rootIndex);
  return candidates[0] || null;
}

function stringValue(value: unknown): string {
  return String(value ?? "").trim();
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function odometerFrom(row: RawRecord): { value: number | null; source: LinxupOdometerSource } {
  const trueOdo = finiteNumber(row.trueOdo);
  if (trueOdo != null) return { value: trueOdo, source: "true" };
  const virtualOdo = finiteNumber(row.virtualOdo);
  if (virtualOdo != null) return { value: virtualOdo, source: "virtual" };
  const estimatedOdo = finiteNumber(row.estimatedOdo);
  if (estimatedOdo != null) return { value: estimatedOdo, source: "estimated" };
  return { value: null, source: "unavailable" };
}

function reportedAt(value: unknown): string {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return "";
  try {
    return new Date(milliseconds).toISOString();
  } catch {
    return "";
  }
}

export function readLatestLinxupVehicleInventory(): LinxupVehicleInventory {
  const source = latestRawFile();
  if (!source) return { sourceDate: "", retrievedAt: "", vehicles: [] };

  try {
    const payload = JSON.parse(fs.readFileSync(source.filePath, "utf8"));
    const rows = payload?.responses?.locations?.data?.locations;
    if (!Array.isArray(rows)) return { sourceDate: source.date, retrievedAt: stringValue(payload?.retrieved_at), vehicles: [] };

    const vehicles = rows
      .map((raw: unknown) => {
        if (!raw || typeof raw !== "object") return null;
        const row = raw as RawRecord;
        const truck = normalizeTruck(row.personName || row.firstName);
        if (!truck) return null;
        const odometer = odometerFrom(row);
        return {
          truck,
          trackerId: stringValue(row.deviceUUID),
          vin: stringValue(row.vin || row.personMisc4),
          licensePlate: stringValue(row.licensePlate),
          odometer: odometer.value,
          odometerSource: odometer.source,
          make: stringValue(row.make || row.personMisc6),
          model: stringValue(row.model || row.personMisc5),
          year: stringValue(row.year || row.personMisc7),
          status: stringValue(row.status),
          lastReportedAt: reportedAt(row.date),
        } satisfies LinxupVehicleProfile;
      })
      .filter(Boolean) as LinxupVehicleProfile[];

    vehicles.sort((a, b) => a.truck.localeCompare(b.truck, undefined, { numeric: true }));
    return {
      sourceDate: source.date,
      retrievedAt: stringValue(payload?.retrieved_at),
      vehicles,
    };
  } catch {
    return { sourceDate: source.date, retrievedAt: "", vehicles: [] };
  }
}
