import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { effectiveFleetChecklistDefinitions } from "@/lib/fleet-checklist-definitions";
import { readFleetChecklistTemplateStore } from "@/lib/fleet-checklist-templates";
import type { FleetChecklistEntry } from "@/lib/fleet-checklists";

export const FLEET_ISSUE_STATUSES = ["open", "in_progress", "resolved"] as const;
export type FleetIssueStatus = (typeof FLEET_ISSUE_STATUSES)[number];
export const FLEET_ISSUE_SEVERITIES = ["monitor", "repair_soon", "out_of_service"] as const;
export type FleetIssueSeverity = (typeof FLEET_ISSUE_SEVERITIES)[number];

export type FleetIssue = {
  issueId: string;
  truck: string;
  title: string;
  description: string;
  severity: FleetIssueSeverity;
  status: FleetIssueStatus;
  owner: string;
  dueDate: string;
  resolution: string;
  cost: number | null;
  downtimeHours: number | null;
  photos: FleetIssuePhoto[];
  sourceChecklistEntryId: string;
  sourceChecklistItemId: string;
  sourceInspectionDate: string;
  sourceInspector: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
};

export type FleetIssuePhoto = {
  photoId: string;
  fileName: string;
  storageName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
};

export type FleetIssueStore = {
  version: 1;
  updatedAt: string;
  issues: FleetIssue[];
};

const STORE_FILE = "repair_issues.json";

function storePath(): string {
  return path.join(process.cwd(), "data", "fleet", STORE_FILE);
}

function normalizeTruck(value: unknown): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function statusValue(value: unknown): FleetIssueStatus {
  return FLEET_ISSUE_STATUSES.includes(value as FleetIssueStatus) ? value as FleetIssueStatus : "open";
}

function severityValue(value: unknown): FleetIssueSeverity {
  return FLEET_ISSUE_SEVERITIES.includes(value as FleetIssueSeverity) ? value as FleetIssueSeverity : "repair_soon";
}

function nullableNonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function validOptionalDate(value: unknown): string {
  const text = String(value || "").trim();
  return !text || /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function parsePhotos(value: unknown): FleetIssuePhoto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw) => {
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const photoId = String(row.photoId || "").trim();
    const storageName = path.basename(String(row.storageName || "").trim());
    const mimeType = String(row.mimeType || "").trim().toLowerCase();
    if (!photoId || !storageName || !["image/jpeg", "image/png", "image/webp"].includes(mimeType)) return [];
    return [{ photoId, fileName: path.basename(String(row.fileName || "photo")).slice(0, 160), storageName, mimeType, size: Math.max(0, Number(row.size) || 0), uploadedAt: String(row.uploadedAt || "").trim() }];
  });
}

function parseIssue(value: unknown): FleetIssue | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const truck = normalizeTruck(row.truck);
  const title = String(row.title || "").trim().slice(0, 160);
  if (!truck || !title) return null;
  const status = statusValue(row.status);
  return {
    issueId: String(row.issueId || randomUUID()).trim(),
    truck,
    title,
    description: String(row.description || "").trim().slice(0, 1000),
    severity: severityValue(row.severity),
    status,
    owner: String(row.owner || "").trim().slice(0, 100),
    dueDate: validOptionalDate(row.dueDate),
    resolution: String(row.resolution || "").trim().slice(0, 1000),
    cost: nullableNonNegative(row.cost),
    downtimeHours: nullableNonNegative(row.downtimeHours),
    photos: parsePhotos(row.photos),
    sourceChecklistEntryId: String(row.sourceChecklistEntryId || "").trim(),
    sourceChecklistItemId: String(row.sourceChecklistItemId || "").trim(),
    sourceInspectionDate: String(row.sourceInspectionDate || "").trim(),
    sourceInspector: String(row.sourceInspector || "").trim().slice(0, 100),
    createdAt: String(row.createdAt || "").trim(),
    updatedAt: String(row.updatedAt || "").trim(),
    resolvedAt: status === "resolved" ? String(row.resolvedAt || "").trim() : "",
  };
}

function sortIssues(issues: FleetIssue[]): FleetIssue[] {
  const rank: Record<FleetIssueStatus, number> = { open: 0, in_progress: 1, resolved: 2 };
  return issues.slice().sort((a, b) =>
    rank[a.status] - rank[b.status]
      || b.sourceInspectionDate.localeCompare(a.sourceInspectionDate)
      || b.updatedAt.localeCompare(a.updatedAt)
  );
}

export function readFleetIssueStore(): FleetIssueStore {
  try {
    const filePath = storePath();
    if (!fs.existsSync(filePath)) return { version: 1, updatedAt: "", issues: [] };
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const issues = (Array.isArray(payload?.issues) ? payload.issues : []).map(parseIssue).filter(Boolean) as FleetIssue[];
    return { version: 1, updatedAt: String(payload?.updatedAt || ""), issues: sortIssues(issues) };
  } catch {
    return { version: 1, updatedAt: "", issues: [] };
  }
}

function writeStore(store: FleetIssueStore): void {
  const filePath = storePath();
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const temporaryFile = path.join(directory, `.${STORE_FILE}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporaryFile, JSON.stringify({ ...store, issues: sortIssues(store.issues) }, null, 2), { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporaryFile, 0o660);
  fs.renameSync(temporaryFile, filePath);
}

export function syncFleetIssuesFromChecklist(entry: FleetChecklistEntry): FleetIssueStore {
  const store = readFleetIssueStore();
  const definitions = effectiveFleetChecklistDefinitions(entry.truck, entry.cadence, readFleetChecklistTemplateStore().customizations);
  const definitionById = new Map(definitions.map((item) => [item.itemId, item]));
  const attentionAnswers = entry.answers.filter((answer) => answer.status === "attention");
  const attentionIds = new Set(attentionAnswers.map((answer) => answer.itemId));
  const answeredIds = new Set(entry.answers.map((answer) => answer.itemId));
  const now = new Date().toISOString();

  for (const answer of attentionAnswers) {
    const definition = definitionById.get(answer.itemId);
    if (!definition) continue;
    const index = store.issues.findIndex((issue) =>
      issue.sourceChecklistEntryId === entry.entryId && issue.sourceChecklistItemId === answer.itemId
    );
    const existing = index >= 0 ? store.issues[index] : null;
    const shouldReopen = existing?.status === "resolved" && existing.resolution === "Checklist item was cleared.";
    const issue: FleetIssue = {
      issueId: existing?.issueId || randomUUID(),
      truck: entry.truck,
      title: definition.label,
      description: answer.notes || definition.guidance,
      severity: existing?.severity || "repair_soon",
      status: shouldReopen ? "open" : existing?.status || "open",
      owner: existing?.owner || "",
      dueDate: existing?.dueDate || "",
      resolution: shouldReopen ? "" : existing?.resolution || "",
      cost: existing?.cost ?? null,
      downtimeHours: existing?.downtimeHours ?? null,
      photos: existing?.photos || [],
      sourceChecklistEntryId: entry.entryId,
      sourceChecklistItemId: answer.itemId,
      sourceInspectionDate: entry.inspectionDate,
      sourceInspector: entry.inspector,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      resolvedAt: shouldReopen ? "" : existing?.resolvedAt || "",
    };
    if (index >= 0) store.issues.splice(index, 1, issue);
    else store.issues.push(issue);
  }

  store.issues = store.issues.map((issue) => {
    if (issue.sourceChecklistEntryId !== entry.entryId || !answeredIds.has(issue.sourceChecklistItemId) || attentionIds.has(issue.sourceChecklistItemId) || issue.status === "resolved") return issue;
    return { ...issue, status: "resolved", resolution: "Checklist item was cleared.", resolvedAt: now, updatedAt: now };
  });
  writeStore({ version: 1, updatedAt: now, issues: store.issues });
  return readFleetIssueStore();
}

export function upsertFleetIssue(input: Record<string, unknown>): FleetIssue | null {
  const store = readFleetIssueStore();
  const issueId = String(input.issueId || "").trim();
  const index = issueId ? store.issues.findIndex((issue) => issue.issueId === issueId) : -1;
  const existing = index >= 0 ? store.issues[index] : null;
  const truck = normalizeTruck(input.truck || existing?.truck);
  const title = String(input.title || existing?.title || "").trim().slice(0, 160);
  if (!truck || !title) return null;
  const status = statusValue(input.status ?? existing?.status);
  const rawCost = input.cost ?? existing?.cost;
  const rawDowntime = input.downtimeHours ?? existing?.downtimeHours;
  if (rawCost !== null && rawCost !== undefined && rawCost !== "" && nullableNonNegative(rawCost) === null) return null;
  if (rawDowntime !== null && rawDowntime !== undefined && rawDowntime !== "" && nullableNonNegative(rawDowntime) === null) return null;
  const now = new Date().toISOString();
  const issue: FleetIssue = {
    issueId: existing?.issueId || randomUUID(),
    truck,
    title,
    description: String(input.description ?? existing?.description ?? "").trim().slice(0, 1000),
    severity: severityValue(input.severity ?? existing?.severity),
    status,
    owner: String(input.owner ?? existing?.owner ?? "").trim().slice(0, 100),
    dueDate: validOptionalDate(input.dueDate ?? existing?.dueDate),
    resolution: String(input.resolution ?? existing?.resolution ?? "").trim().slice(0, 1000),
    cost: nullableNonNegative(rawCost),
    downtimeHours: nullableNonNegative(rawDowntime),
    photos: existing?.photos || [],
    sourceChecklistEntryId: existing?.sourceChecklistEntryId || "",
    sourceChecklistItemId: existing?.sourceChecklistItemId || "",
    sourceInspectionDate: existing?.sourceInspectionDate || String(input.sourceInspectionDate || "").trim(),
    sourceInspector: existing?.sourceInspector || String(input.sourceInspector || "").trim().slice(0, 100),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    resolvedAt: status === "resolved" ? existing?.resolvedAt || now : "",
  };
  if (index >= 0) store.issues.splice(index, 1, issue);
  else store.issues.push(issue);
  writeStore({ version: 1, updatedAt: now, issues: store.issues });
  return issue;
}

export function fleetIssuePhotoDirectory(): string {
  return path.join(process.cwd(), "data", "fleet", "issue_photos");
}

export function fleetIssuePhotoFilePath(photo: FleetIssuePhoto): string {
  return path.join(fleetIssuePhotoDirectory(), path.basename(photo.storageName));
}

export function attachFleetIssuePhoto(issueId: string, input: Omit<FleetIssuePhoto, "photoId" | "uploadedAt">): FleetIssuePhoto | null {
  const store = readFleetIssueStore();
  const index = store.issues.findIndex((issue) => issue.issueId === issueId);
  if (index < 0) return null;
  const now = new Date().toISOString();
  const photo: FleetIssuePhoto = { photoId: randomUUID(), fileName: path.basename(input.fileName).slice(0, 160), storageName: path.basename(input.storageName), mimeType: input.mimeType, size: Math.max(0, input.size), uploadedAt: now };
  store.issues[index].photos.push(photo);
  store.issues[index].updatedAt = now;
  writeStore({ version: 1, updatedAt: now, issues: store.issues });
  return photo;
}

export function findFleetIssuePhoto(photoId: string): { issue: FleetIssue; photo: FleetIssuePhoto } | null {
  for (const issue of readFleetIssueStore().issues) {
    const photo = issue.photos.find((candidate) => candidate.photoId === photoId);
    if (photo) return { issue, photo };
  }
  return null;
}

export function detachFleetIssuePhoto(photoId: string): FleetIssuePhoto | null {
  const store = readFleetIssueStore();
  for (let index = 0; index < store.issues.length; index += 1) {
    const photoIndex = store.issues[index].photos.findIndex((photo) => photo.photoId === photoId);
    if (photoIndex < 0) continue;
    const [photo] = store.issues[index].photos.splice(photoIndex, 1);
    const now = new Date().toISOString();
    store.issues[index].updatedAt = now;
    writeStore({ version: 1, updatedAt: now, issues: store.issues });
    return photo;
  }
  return null;
}
