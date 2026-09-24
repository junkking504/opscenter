import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ASK_OPSBOT_APPROVAL,
  ASK_OPSBOT_MONTHLY_MICROS,
  ASK_OPSBOT_QUESTION_LIMIT,
  ASK_OPSBOT_RESERVE_MICROS,
} from './metered-usage-policy';

export type AskOpsBotReservation = {
  slot: number;
  requestId: string;
  file: string;
  reservedAt: string;
};

type LedgerConfig = {
  schema: 1;
  approvalId: string;
  questionLimit: number;
  monthlyBudgetMicros: number;
  reserveMicros: number;
  initializedAt: string;
};

type SlotRecord = {
  schema: 1;
  slot: number;
  requestId: string;
  actor: string;
  month: string;
  status: 'pending' | 'complete' | 'unavailable';
  reservedMicros: number;
  estimatedMicros?: number;
  inputTokens?: number;
  outputTokens?: number;
  reservedAt: string;
  completedAt?: string;
};

export type AskOpsBotLedgerSnapshot = {
  available: boolean;
  used: number;
  remaining: number;
  limit: number;
  monthlyBudgetMicros: number;
  reservedMicros: number;
  paused: boolean;
};

export const askOpsBotLedgerDirectory = () => process.env.OPSCENTER_ASK_OPSBOT_LEDGER_DIR
  || path.join(process.env.HOME || '', '.openclaw', 'workspace', 'opsbot', 'data', 'integrations', 'ask-opsbot');

function chicagoMonth(now: number): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit' }).formatToParts(now);
  return `${parts.find(part => part.type === 'year')?.value}-${parts.find(part => part.type === 'month')?.value}`;
}

const configPath = (directory: string) => path.join(directory, 'ledger.json');
const slotsDirectory = (directory: string) => path.join(directory, 'slots');
const pausePath = (directory: string) => path.join(directory, 'paused.json');

function expectedConfig(value: unknown): value is LedgerConfig {
  const config = value as Partial<LedgerConfig> | null;
  return config?.schema === 1 && config.approvalId === ASK_OPSBOT_APPROVAL
    && config.questionLimit === ASK_OPSBOT_QUESTION_LIMIT
    && config.monthlyBudgetMicros === ASK_OPSBOT_MONTHLY_MICROS
    && config.reserveMicros === ASK_OPSBOT_RESERVE_MICROS
    && typeof config.initializedAt === 'string' && Number.isFinite(Date.parse(config.initializedAt));
}

function readConfig(directory: string): LedgerConfig {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(directory), 'utf8'));
    if (!expectedConfig(parsed)) throw new Error('invalid');
    return parsed;
  } catch {
    throw new Error('Ask OpsBot is paused because its usage ledger is missing or invalid.');
  }
}

function atomicWrite(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file);
}

export function initializeAskOpsBotLedger(directory = askOpsBotLedgerDirectory(), now = Date.now()): void {
  fs.mkdirSync(slotsDirectory(directory), { recursive: true, mode: 0o700 });
  const config: LedgerConfig = {
    schema: 1,
    approvalId: ASK_OPSBOT_APPROVAL,
    questionLimit: ASK_OPSBOT_QUESTION_LIMIT,
    monthlyBudgetMicros: ASK_OPSBOT_MONTHLY_MICROS,
    reserveMicros: ASK_OPSBOT_RESERVE_MICROS,
    initializedAt: new Date(now).toISOString(),
  };
  if (fs.existsSync(configPath(directory))) {
    readConfig(directory);
    return;
  }
  const fd = fs.openSync(configPath(directory), 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(config, null, 2)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
}

function slotFiles(directory: string): string[] {
  try { return fs.readdirSync(slotsDirectory(directory)).filter(file => /^\d{3}\.json$/.test(file)).sort(); }
  catch { throw new Error('Ask OpsBot is paused because its usage ledger is unavailable.'); }
}

export function readAskOpsBotLedger(directory = askOpsBotLedgerDirectory()): AskOpsBotLedgerSnapshot {
  readConfig(directory);
  const files = slotFiles(directory);
  if (files.length > ASK_OPSBOT_QUESTION_LIMIT) throw new Error('Ask OpsBot is paused because its usage ledger is inconsistent.');
  for (const file of files) {
    try {
      const slot = JSON.parse(fs.readFileSync(path.join(slotsDirectory(directory), file), 'utf8')) as SlotRecord;
      if (slot.schema !== 1 || slot.slot !== Number(file.slice(0, 3)) || slot.reservedMicros !== ASK_OPSBOT_RESERVE_MICROS
        || !['pending', 'complete', 'unavailable'].includes(slot.status)
        || typeof slot.requestId !== 'string' || typeof slot.actor !== 'string'
        || !/^\d{4}-\d{2}$/.test(slot.month) || !Number.isFinite(Date.parse(slot.reservedAt))) throw new Error('invalid');
    } catch { throw new Error('Ask OpsBot is paused because its usage ledger is inconsistent.'); }
  }
  const paused = fs.existsSync(pausePath(directory));
  return {
    available: !paused && files.length < ASK_OPSBOT_QUESTION_LIMIT,
    used: files.length,
    remaining: Math.max(0, ASK_OPSBOT_QUESTION_LIMIT - files.length),
    limit: ASK_OPSBOT_QUESTION_LIMIT,
    monthlyBudgetMicros: ASK_OPSBOT_MONTHLY_MICROS,
    reservedMicros: files.length * ASK_OPSBOT_RESERVE_MICROS,
    paused,
  };
}

export function reserveAskOpsBotQuestion(actor: string, directory = askOpsBotLedgerDirectory(), now = Date.now()): AskOpsBotReservation {
  const snapshot = readAskOpsBotLedger(directory);
  if (!snapshot.available) throw new Error(snapshot.paused ? 'Ask OpsBot is paused.' : 'The 50-question Ask OpsBot pilot is complete.');
  const reservedAt = new Date(now).toISOString();
  const month = chicagoMonth(now);
  for (let slot = 1; slot <= ASK_OPSBOT_QUESTION_LIMIT; slot += 1) {
    const requestId = randomUUID();
    const file = path.join(slotsDirectory(directory), `${String(slot).padStart(3, '0')}.json`);
    const record: SlotRecord = { schema: 1, slot, requestId, actor, month, status: 'pending', reservedMicros: ASK_OPSBOT_RESERVE_MICROS, reservedAt };
    try {
      const fd = fs.openSync(file, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(record, null, 2)); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      return { slot, requestId, file, reservedAt };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
  throw new Error('The 50-question Ask OpsBot pilot is complete.');
}

export function settleAskOpsBotQuestion(
  reservation: AskOpsBotReservation,
  usage: { inputTokens: number; outputTokens: number } | null,
  directory = askOpsBotLedgerDirectory(),
  now = Date.now(),
): void {
  const existing = JSON.parse(fs.readFileSync(reservation.file, 'utf8')) as SlotRecord;
  if (existing.requestId !== reservation.requestId || existing.status !== 'pending') throw new Error('Ask OpsBot usage reservation could not be verified.');
  const estimatedMicros = usage ? Math.ceil(usage.inputTokens * 0.1 + usage.outputTokens * 0.5) : ASK_OPSBOT_RESERVE_MICROS;
  atomicWrite(reservation.file, {
    ...existing,
    status: usage ? 'complete' : 'unavailable',
    estimatedMicros,
    inputTokens: usage?.inputTokens,
    outputTokens: usage?.outputTokens,
    completedAt: new Date(now).toISOString(),
  });
  if (estimatedMicros > ASK_OPSBOT_RESERVE_MICROS) {
    atomicWrite(pausePath(directory), { schema: 1, reason: 'usage_exceeded_reservation', requestId: reservation.requestId, pausedAt: new Date(now).toISOString() });
  }
}
