import fs from "node:fs";
import path from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { InspectionError, inspectionDate, validateTruckInspection, type InspectionDevice, type TruckInspectionReport } from "./truck-inspection";
import { JUNKWARE_DISPATCH_TRUCKS } from "./junkware-trucks";

export const INSPECTION_DEVICE_COOKIE = "ops_truck_inspection";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const root = () => process.env.OPS_TRUCK_INSPECTION_DIR || path.join(process.cwd(), "data", "fleet", "truck-inspections");
function directory(name: string): string {
  const dir = path.join(root(), name); fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); return dir;
}
function read<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}
/** Publish a fully written immutable file with an exclusive hard link. */
function writeOnce(file: string, value: unknown): boolean {
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, "wx", 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.linkSync(temp, file); const dir = fs.openSync(path.dirname(file), "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } return true; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  finally { fs.unlinkSync(temp); }
}
export function createInspectionPairing(truck: string, label: string, actor: string, now = new Date()) {
  if (!JUNKWARE_DISPATCH_TRUCKS.includes(truck)) throw new InspectionError("Choose a truck.");
  if (!label.trim() || label.length > 100) throw new InspectionError("Enter a phone name.");
  const code = randomBytes(12).toString("hex");
  const deviceId = randomUUID();
  const expiresAt = new Date(now.getTime() + 86400_000).toISOString();
  writeOnce(path.join(directory("pairings"), `${hash(code)}.json`), { deviceId, truck, label: label.trim(), actor, expiresAt });
  return { code, expiresAt, truck };
}
export function pairInspectionPhone(rawCode: unknown, now = new Date()) {
  if (typeof rawCode !== "string" || !/^[a-f0-9]{24}$/.test(rawCode.trim())) throw new InspectionError("Enter the setup code from OpsCenter.");
  const file = path.join(directory("pairings"), `${hash(rawCode.trim())}.json`);
  const pair = read<InspectionDevice & { actor: string }>(file);
  if (!pair || Date.parse(pair.expiresAt) <= now.getTime()) throw new InspectionError("This code is expired or invalid. Get a new code from OpsCenter.");
  if (!writeOnce(`${file}.used`, { usedAt: now.toISOString() })) throw new InspectionError("This code was already used. Get a new code from OpsCenter.", 409);
  const token = randomBytes(32).toString("hex");
  const device: InspectionDevice = { deviceId: pair.deviceId, truck: pair.truck, label: pair.label, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 180 * 86400_000).toISOString() };
  writeOnce(path.join(directory("devices"), `${hash(token)}.json`), device);
  return { token, device };
}
/** A phone keeps its receipt identity across inspections of different trucks. */
export function connectInspectionPhone(token: unknown, now = new Date()) {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new InspectionError("Reload this page and try again.");
  const file = path.join(directory("devices"), `${hash(token)}.json`);
  const deviceId = randomUUID();
  const device: InspectionDevice = { deviceId, label: `Company phone · ${deviceId.slice(0, 6)}`, createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 180 * 86400_000).toISOString() };
  writeOnce(file, device);
  const saved = inspectionDevice(token, now);
  if (!saved) throw new InspectionError("This phone connection has expired or was disconnected. Reload to connect again.", 403);
  return { token, device: saved };
}
export function inspectionDevice(token: string, now = new Date()): InspectionDevice | null {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const device = read<InspectionDevice>(path.join(directory("devices"), `${hash(token)}.json`));
  if (!device || Date.parse(device.expiresAt) <= now.getTime() || fs.existsSync(path.join(directory("revoked"), `${device.deviceId}.json`))) return null;
  return device;
}
export function listInspectionDevices(): InspectionDevice[] {
  return fs.readdirSync(directory("devices")).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).flatMap(f => {
    const device = read<InspectionDevice>(path.join(directory("devices"), f));
    return device && Date.parse(device.expiresAt) > Date.now() && !fs.existsSync(path.join(directory("revoked"), `${device.deviceId}.json`)) ? [device] : [];
  });
}
export function revokeInspectionDevice(id: string, actor: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new InspectionError("Choose a phone.");
  writeOnce(path.join(directory("revoked"), `${id}.json`), { actor, revokedAt: new Date().toISOString() });
}
function reportFile(deviceId: string, requestId: string): string {
  if (!/^[a-f0-9-]{36}$/.test(requestId)) throw new InspectionError("Invalid report reference.");
  return path.join(directory("reports"), `${hash(`${deviceId}:${requestId}`)}.json`);
}
export function findTruckInspection(deviceId: string, requestId: string): TruckInspectionReport | null {
  const file = reportFile(deviceId, requestId);
  const saved = read<TruckInspectionReport>(file);
  if (saved) indexReport(file, saved);
  return saved;
}
function indexReport(file: string, report: TruckInspectionReport) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(report.inspectionDate)) throw new Error("Invalid stored inspection date.");
  const destination = path.join(directory(`dates/${report.inspectionDate}`), path.basename(file));
  try { fs.linkSync(file, destination); const fd = fs.openSync(path.dirname(destination), "r"); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
}
export function submitTruckInspection(raw: unknown, device: InspectionDevice, now = new Date()): TruckInspectionReport {
  // Old loaded clients omit truck. Preserve their original assignment while they finish.
  const compatible = raw && typeof raw === "object" && !("truck" in raw) && device.truck ? { ...raw, truck: device.truck } : raw;
  const requestId = compatible && typeof compatible === "object" && "requestId" in compatible ? compatible.requestId : undefined;
  const existing = typeof requestId === "string" ? read<TruckInspectionReport>(reportFile(device.deviceId, requestId)) : null;
  const input = validateTruckInspection(compatible, now, existing?.version === 1 && existing.loadLevel === undefined);
  const file = reportFile(device.deviceId, input.requestId);
  const report: TruckInspectionReport = { ...input, version: 2, deviceId: device.deviceId, receivedAt: now.toISOString(), inspectionDate: inspectionDate(new Date(input.startedAt)) };
  writeOnce(file, report);
  const saved = read<TruckInspectionReport>(file);
  if (!saved) throw new Error("Inspection save could not be verified.");
  // A retry returns the existing receipt. Changed content must never overwrite it.
  const previous = validateTruckInspection(saved, new Date(saved.receivedAt), saved.version === 1);
  if (JSON.stringify(previous) !== JSON.stringify(input)) throw new InspectionError("This report was already received with different answers. Check the saved result before starting another inspection.", 409);
  indexReport(file, saved);
  return saved;
}
export function listTruckInspections(date: string): TruckInspectionReport[] {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new InspectionError("Choose an inspection date.");
  const dateDirectory = directory(`dates/${date}`);
  return fs.readdirSync(dateDirectory).filter(f => /^[a-f0-9]{64}\.json$/.test(f)).flatMap(f => {
    const r = read<TruckInspectionReport>(path.join(dateDirectory, f));
    return r?.inspectionDate === date ? [r] : [];
  }).sort((a,b) => b.receivedAt.localeCompare(a.receivedAt));
}
