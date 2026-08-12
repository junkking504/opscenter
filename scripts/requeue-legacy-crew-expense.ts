import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { CrewExpenseRecord, CrewExpenseTransaction } from "@/lib/whatsapp-crew-expenses";

function stateDirectory(): string {
  return String(process.env.WHATSAPP_CREW_EXPENSE_STATE_DIR || "").trim()
    || path.join(String(process.env.OPSBOT_DATA_DIR || "").trim(), "integrations", "whatsapp-crew-expenses");
}

function key(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function writeJsonAtomic(target: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomUUID()}`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, target);
}

const messageId = String(process.argv[2] || "").trim();
if (!messageId.startsWith("wamid.")) throw new Error("Pass the exact Meta message ID to requeue.");
const state = stateDirectory();
if (!path.isAbsolute(state)) throw new Error("OPSBOT_DATA_DIR or WHATSAPP_CREW_EXPENSE_STATE_DIR must be absolute.");
const name = `${key(messageId)}.json`;
const source = path.join(state, "records", name);
const pending = path.join(state, "transactions-pending", name);
const archived = path.join(state, "legacy-records-requeued", name);
if (fs.existsSync(pending)) throw new Error("This legacy expense is already pending.");
if (!fs.existsSync(source)) throw new Error("The exact legacy expense record was not found.");
const record = JSON.parse(fs.readFileSync(source, "utf8")) as CrewExpenseRecord;
if (record.messageId !== messageId) throw new Error("The legacy expense message ID did not match its record file.");
const replyFiles = fs.existsSync(path.join(state, "outbox-sent"))
  ? fs.readdirSync(path.join(state, "outbox-sent")).filter((entry) => entry.endsWith(".json"))
  : [];
const reply = replyFiles.flatMap((entry) => {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(state, "outbox-sent", entry), "utf8"));
    return parsed.messageId === messageId ? [parsed] : [];
  } catch {
    return [];
  }
})[0];
const recipient = String(reply?.recipient || "").replace(/\D/g, "");
const phoneNumberId = String(reply?.phoneNumberId || "").trim();
if (!recipient || !phoneNumberId) throw new Error("The legacy WhatsApp recipient metadata was not found.");
const transaction: CrewExpenseTransaction = {
  version: 1,
  record,
  recipient,
  phoneNumberId,
  stage: "pending_junkware",
  enqueuedAt: new Date().toISOString(),
};
writeJsonAtomic(pending, transaction);
fs.mkdirSync(path.dirname(archived), { recursive: true, mode: 0o700 });
fs.renameSync(source, archived);
process.stdout.write(`${JSON.stringify({ ok: true, messageId, truck: record.truck, kind: record.kind, cost: record.cost })}\n`);
