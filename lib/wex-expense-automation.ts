import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { attributeWexTransactionToLinxup, type WexTruckAttribution } from "@/lib/wex-linxup-attribution";
import { readOperationalTruckExpenses, type TruckExpense } from "@/lib/truck-expense-notifications";
import type { CrewExpenseRecord } from "@/lib/whatsapp-crew-expenses";
import { wexFuelDirectory, type WexFuelTransaction } from "@/lib/wex-fuel";

export type WexExpenseAutomation = {
  version: 1;
  transaction: WexFuelTransaction;
  attribution: WexTruckAttribution;
  record: CrewExpenseRecord;
  action: "create" | "matched_existing";
  matchedExpense?: Pick<TruckExpense, "id" | "market" | "receipt" | "transactionAt">;
  stage: "pending_junkware" | "junkware_verified" | "slack_sent";
  enqueuedAt: string;
  attempts?: number;
  lastAttemptAt?: string;
  lastError?: string;
  junkware?: Record<string, unknown>;
  slack?: Record<string, unknown>;
};

type Queue = "pending" | "processing" | "completed" | "failed" | "review";
const clean = (value: unknown) => String(value || "").replace(/\s+/g, " ").trim();
const hash = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const root = () => path.join(wexFuelDirectory(), "expense-automation");
const directory = (queue: Queue) => path.join(root(), queue);
const queues: Queue[] = ["pending", "processing", "completed", "failed", "review"];
function ensureDirectories() { for (const queue of queues) fs.mkdirSync(directory(queue), { recursive: true, mode: 0o700 }); }
function writeJsonAtomic(target: string, payload: unknown) {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}
const fileName = (transactionId: string) => `${hash(`wex:${transactionId}`)}.json`;
const sameTruck = (left: string, right: string) => {
  const a = left.match(/\d+/)?.[0], b = right.match(/\d+/)?.[0];
  return Boolean(a && b && a === b);
};
const normalized = (value: string) => clean(value).toLowerCase().replace(/[^a-z0-9]/g, "");
function locationRelated(left: string, right: string) {
  const a = normalized(left), b = normalized(right);
  return a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a));
}
function timeDifferenceMinutes(record: CrewExpenseRecord, transactionAt: string): number {
  const left = Date.parse(record.reportedAt), right = Date.parse(transactionAt);
  return Number.isFinite(left) && Number.isFinite(right) ? Math.abs(left - right) / 60_000 : Infinity;
}
function recordsRelated(record: CrewExpenseRecord, candidate: CrewExpenseRecord): boolean {
  const timeDifference = timeDifferenceMinutes(record, candidate.reportedAt);
  return record.kind === "fuel" && candidate.kind === "fuel" && record.date === candidate.date
    && sameTruck(record.truck, candidate.truck) && Math.round(record.cost * 100) === Math.round(candidate.cost * 100)
    && (timeDifference <= 30 || (locationRelated(record.location, candidate.location) && timeDifference <= 12 * 60));
}
function expenseRelated(record: CrewExpenseRecord, candidate: TruckExpense): boolean {
  const synthetic: CrewExpenseRecord = { ...record, messageId: candidate.id, location: candidate.location, cost: candidate.amount, truck: candidate.truck, date: candidate.date, kind: candidate.kind, reportedAt: candidate.transactionAt };
  return recordsRelated(record, synthetic);
}
function uniqueManualMatch(record: CrewExpenseRecord): TruckExpense | null {
  const matches = readOperationalTruckExpenses(record.date).filter(entry => expenseRelated(record, entry));
  return matches.length === 1 ? matches[0] : null;
}
function automationFileExists(transactionId: string): boolean {
  const name = fileName(transactionId);
  return queues.some(queue => fs.existsSync(path.join(directory(queue), name)));
}

export function readWexExpenseAutomation(transactionId: string): WexExpenseAutomation | null {
  const name = fileName(transactionId);
  for (const queue of queues) try {
    const value = JSON.parse(fs.readFileSync(path.join(directory(queue), name), "utf8")) as WexExpenseAutomation;
    return value?.version === 1 && value.transaction?.transactionId === transactionId ? value : null;
  } catch { /* Continue across queue states. */ }
  return null;
}

export function wexAttributedTruck(transactionId: string): string | null {
  const automation = readWexExpenseAutomation(transactionId);
  return automation?.attribution?.status === "attributed" ? automation.attribution.truck : null;
}

export function enqueueWexExpenseAutomations(transactions: WexFuelTransaction[], now = new Date()): { queued: number; matched: number; review: number; existing: number } {
  ensureDirectories();
  const result = { queued: 0, matched: 0, review: 0, existing: 0 };
  for (const transaction of transactions) {
    if (automationFileExists(transaction.transactionId)) { result.existing += 1; continue; }
    const attribution = attributeWexTransactionToLinxup(transaction);
    const name = fileName(transaction.transactionId);
    if (attribution.status !== "attributed" || !attribution.truck) {
      writeJsonAtomic(path.join(directory("review"), name), { version: 1, transaction, attribution, reason: "truck_attribution_not_unique", reviewed: false, enqueuedAt: now.toISOString() });
      result.review += 1;
      continue;
    }
    const record: CrewExpenseRecord = {
      version: 1, messageId: `wex:${transaction.transactionId}`, kind: "fuel", date: transaction.transactionDate,
      truck: attribution.truck, location: [transaction.merchant, transaction.merchantAddress, transaction.city].filter(Boolean).join(" · ").slice(0, 120),
      cost: transaction.netCost, weight: null, gallons: transaction.gallons, time: transaction.transactionTime,
      reportedAt: attribution.transactionAt, senderHash: hash("wex-posted"), source: "wex_posted",
    };
    const match = uniqueManualMatch(record);
    const automation: WexExpenseAutomation = {
      version: 1, transaction, attribution, record, action: match ? "matched_existing" : "create",
      ...(match ? { matchedExpense: { id: match.id, market: match.market, receipt: match.receipt, transactionAt: match.transactionAt } } : {}),
      stage: match ? "junkware_verified" : "pending_junkware", enqueuedAt: now.toISOString(),
    };
    writeJsonAtomic(path.join(directory("pending"), name), automation);
    if (match) result.matched += 1; else result.queued += 1;
  }
  return result;
}

export function queuedWexExpenseAutomations(limit = 10): string[] {
  ensureDirectories();
  return fs.readdirSync(directory("pending")).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort().slice(0, Math.max(0, limit)).map(name => path.join(directory("pending"), name));
}
export function claimWexExpenseAutomation(incomingFile: string): { file: string; automation: WexExpenseAutomation } | null {
  ensureDirectories();
  const base = path.basename(incomingFile);
  if (!/^[a-f0-9]{64}\.json$/.test(base)) return null;
  const processing = path.join(directory("processing"), base);
  try { fs.renameSync(incomingFile, processing); return { file: processing, automation: JSON.parse(fs.readFileSync(processing, "utf8")) as WexExpenseAutomation }; } catch { return null; }
}
export function updateWexExpenseAutomation(processingFile: string, update: Partial<WexExpenseAutomation>): WexExpenseAutomation {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8")) as WexExpenseAutomation;
  const next = { ...current, ...update };
  writeJsonAtomic(processingFile, next);
  return next;
}
export function refreshWexManualMatch(automation: WexExpenseAutomation): WexExpenseAutomation {
  if (automation.stage !== "pending_junkware") return automation;
  const match = uniqueManualMatch(automation.record);
  return match ? { ...automation, action: "matched_existing", matchedExpense: { id: match.id, market: match.market, receipt: match.receipt, transactionAt: match.transactionAt }, stage: "junkware_verified", junkware: { duplicatePrevented: true, source: "existing_verified_junkware_expense", matchedExpenseId: match.id, verifiedAt: new Date().toISOString() } } : automation;
}
export function finishWexExpenseAutomation(processingFile: string): void {
  const automation = JSON.parse(fs.readFileSync(processingFile, "utf8")) as WexExpenseAutomation;
  if (automation.stage !== "slack_sent") throw new Error("The WEX expense must reach Slack before completion.");
  writeJsonAtomic(path.join(directory("completed"), path.basename(processingFile)), { ...automation, completedAt: new Date().toISOString() });
  fs.unlinkSync(processingFile);
}
export function requeueWexExpenseAutomation(processingFile: string, errorMessage: string, maxAttempts = 1_000): boolean {
  const current = JSON.parse(fs.readFileSync(processingFile, "utf8")) as WexExpenseAutomation;
  const attempts = Math.max(0, Number(current.attempts) || 0) + 1;
  const next = { ...current, attempts, lastAttemptAt: new Date().toISOString(), lastError: clean(errorMessage).slice(0, 500) };
  const target = path.join(directory(attempts >= maxAttempts ? "failed" : "pending"), path.basename(processingFile));
  writeJsonAtomic(target, attempts >= maxAttempts ? { ...next, failedAt: new Date().toISOString() } : next);
  fs.unlinkSync(processingFile);
  return attempts < maxAttempts;
}
export function findMatchingWexAutomation(record: CrewExpenseRecord): WexExpenseAutomation | null {
  ensureDirectories();
  const matches: WexExpenseAutomation[] = [];
  for (const queue of ["pending", "processing", "completed"] as const) {
    let names: string[] = [];
    try { names = fs.readdirSync(directory(queue)); } catch { continue; }
    for (const name of names.filter(value => value.endsWith(".json"))) try {
      const value = JSON.parse(fs.readFileSync(path.join(directory(queue), name), "utf8")) as WexExpenseAutomation;
      if (value.record && recordsRelated(record, value.record)) matches.push(value);
    } catch { /* malformed queue evidence cannot suppress a manual expense */ }
  }
  return matches.length === 1 ? matches[0] : null;
}
export function wexExpenseQueueCounts(): Record<Queue, number> {
  ensureDirectories();
  return Object.fromEntries(queues.map(queue => { try { return [queue, fs.readdirSync(directory(queue)).filter(name => name.endsWith(".json")).length]; } catch { return [queue, 0]; } })) as Record<Queue, number>;
}
