import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

export const OPS_ACTION_STATUSES = ["open", "acknowledged", "snoozed", "handled", "resolved"] as const;
export type OpsActionStatus = (typeof OPS_ACTION_STATUSES)[number];
export type OpsActionOperation = "acknowledge" | "snooze" | "handle" | "reopen";

export type OpsActionActor = {
  source: "opscenter" | "slack" | "system";
  id: string;
  label: string;
};

export type OpsActionEvent = {
  eventId: string;
  type: "detected" | "updated" | "acknowledged" | "snoozed" | "handled" | "reopened" | "source_cleared";
  at: string;
  actor: OpsActionActor;
  fromStatus: OpsActionStatus | null;
  toStatus: OpsActionStatus;
  note: string;
};

export type OpsActionSignal = {
  fingerprint: string;
  kind: string;
  lifecycle: "incident" | "notification";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  nextAction: string;
  href: string;
};

export type OpsAction = {
  actionId: string;
  fingerprint: string;
  kind: string;
  lifecycle: "incident" | "notification";
  severity: "critical" | "warning";
  title: string;
  detail: string;
  nextAction: string;
  href: string;
  status: OpsActionStatus;
  sourceActive: boolean;
  ownerId: string;
  ownerLabel: string;
  snoozedUntil: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
  events: OpsActionEvent[];
};

export type OpsActionStore = {
  version: 1;
  updatedAt: string;
  actions: OpsAction[];
};

const SYSTEM_ACTOR: OpsActionActor = { source: "system", id: "opscenter", label: "OpsCenter" };
const LOCK_WAIT_MS = 25;
const LOCK_TIMEOUT_MS = 2_000;
const STALE_LOCK_MS = 30_000;

function storeFile(): string {
  const configured = String(process.env.OPSCENTER_ACTION_STORE_FILE || "").trim();
  return configured || path.join(process.cwd(), "data", "actions", "ops_actions.json");
}

function lockDirectory(): string {
  return `${storeFile()}.lock`;
}

function emptyStore(): OpsActionStore {
  return { version: 1, updatedAt: "", actions: [] };
}

function validStatus(value: unknown): value is OpsActionStatus {
  return OPS_ACTION_STATUSES.includes(String(value || "") as OpsActionStatus);
}

function safeTimestamp(value: unknown): string {
  const parsed = new Date(String(value || ""));
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : "";
}

function normalizeActor(value: unknown): OpsActionActor {
  const actor = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const source = actor.source === "slack" || actor.source === "opscenter" ? actor.source : "system";
  return {
    source,
    id: String(actor.id || "opscenter").trim().slice(0, 160),
    label: String(actor.label || "OpsCenter").trim().slice(0, 160),
  };
}

function normalizeEvent(value: unknown): OpsActionEvent | null {
  const event = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const at = safeTimestamp(event.at);
  const toStatus = validStatus(event.toStatus) ? event.toStatus : null;
  if (!at || !toStatus) return null;
  const type = String(event.type || "updated") as OpsActionEvent["type"];
  const allowedTypes = new Set<OpsActionEvent["type"]>([
    "detected", "updated", "acknowledged", "snoozed", "handled", "reopened", "source_cleared",
  ]);
  return {
    eventId: String(event.eventId || randomUUID()),
    type: allowedTypes.has(type) ? type : "updated",
    at,
    actor: normalizeActor(event.actor),
    fromStatus: validStatus(event.fromStatus) ? event.fromStatus : null,
    toStatus,
    note: String(event.note || "").trim().slice(0, 500),
  };
}

function normalizeAction(value: unknown): OpsAction | null {
  const row = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const actionId = String(row.actionId || "").trim();
  const fingerprint = String(row.fingerprint || "").trim();
  const createdAt = safeTimestamp(row.createdAt);
  const updatedAt = safeTimestamp(row.updatedAt);
  if (!actionId || !fingerprint || !createdAt || !updatedAt || !validStatus(row.status)) return null;
  return {
    actionId,
    fingerprint,
    kind: String(row.kind || "operational_alert").trim().slice(0, 100),
    lifecycle: row.lifecycle === "notification" ? "notification" : "incident",
    severity: row.severity === "warning" ? "warning" : "critical",
    title: String(row.title || "OpsCenter action").trim().slice(0, 300),
    detail: String(row.detail || "").trim().slice(0, 1_500),
    nextAction: String(row.nextAction || "").trim().slice(0, 1_000),
    href: String(row.href || "/").trim().slice(0, 2_000),
    status: row.status,
    sourceActive: Boolean(row.sourceActive),
    ownerId: String(row.ownerId || "").trim().slice(0, 160),
    ownerLabel: String(row.ownerLabel || "").trim().slice(0, 160),
    snoozedUntil: safeTimestamp(row.snoozedUntil),
    createdAt,
    updatedAt,
    resolvedAt: safeTimestamp(row.resolvedAt),
    events: (Array.isArray(row.events) ? row.events : []).map(normalizeEvent).filter((event): event is OpsActionEvent => Boolean(event)),
  };
}

function readStoreUnsafe(): OpsActionStore {
  try {
    const payload = JSON.parse(fs.readFileSync(storeFile(), "utf8"));
    const actions = (Array.isArray(payload?.actions) ? payload.actions : [])
      .map(normalizeAction)
      .filter((action: OpsAction | null): action is OpsAction => Boolean(action));
    return { version: 1, updatedAt: safeTimestamp(payload?.updatedAt), actions };
  } catch {
    return emptyStore();
  }
}

function writeStoreUnsafe(store: OpsActionStore): void {
  const file = storeFile();
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  const temporary = path.join(directory, `.ops_actions.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2), { encoding: "utf8", mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
}

function wait(milliseconds: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withStoreLock<T>(callback: () => T): T {
  const directory = path.dirname(storeFile());
  fs.mkdirSync(directory, { recursive: true });
  const lock = lockDirectory();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const age = Date.now() - fs.statSync(lock).mtimeMs;
        if (age > STALE_LOCK_MS) {
          fs.rmdirSync(lock);
          continue;
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      if (Date.now() >= deadline) throw new Error("Timed out waiting for the OpsCenter action store.");
      wait(LOCK_WAIT_MS);
    }
  }
  try {
    return callback();
  } finally {
    try {
      fs.rmdirSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

function actionIdForFingerprint(fingerprint: string): string {
  return `act_${createHash("sha256").update(fingerprint).digest("hex").slice(0, 24)}`;
}

function event(input: Omit<OpsActionEvent, "eventId">): OpsActionEvent {
  return { eventId: randomUUID(), ...input };
}

function effectiveAction(action: OpsAction, now = new Date()): OpsAction {
  if (action.status !== "snoozed" || !action.snoozedUntil) return action;
  return new Date(action.snoozedUntil).getTime() <= now.getTime()
    ? { ...action, status: "open", snoozedUntil: "" }
    : action;
}

function sortActions(actions: OpsAction[]): OpsAction[] {
  const statusRank: Record<OpsActionStatus, number> = { open: 0, acknowledged: 1, snoozed: 2, handled: 3, resolved: 4 };
  return [...actions].sort((left, right) =>
    statusRank[left.status] - statusRank[right.status]
      || Number(right.severity === "critical") - Number(left.severity === "critical")
      || right.updatedAt.localeCompare(left.updatedAt));
}

export function readOpsActionStore(now = new Date()): OpsActionStore {
  const store = readStoreUnsafe();
  return { ...store, actions: sortActions(store.actions.map((action) => effectiveAction(action, now))) };
}

export function summarizeOpsActions(store = readOpsActionStore()) {
  const counts: Record<OpsActionStatus, number> = { open: 0, acknowledged: 0, snoozed: 0, handled: 0, resolved: 0 };
  for (const action of store.actions) counts[action.status] += 1;
  const active = store.actions.filter((action) => !["handled", "resolved"].includes(action.status));
  return {
    total: store.actions.length,
    active: active.length,
    critical: active.filter((action) => action.severity === "critical").length,
    counts,
  };
}

export function reconcileOpsActionSignals(signals: OpsActionSignal[], now = new Date()): Map<string, OpsAction> {
  const timestamp = now.toISOString();
  return withStoreLock(() => {
    const store = readStoreUnsafe();
    const byFingerprint = new Map(store.actions.map((action) => [action.fingerprint, effectiveAction(action, now)]));
    const activeIncidentFingerprints = new Set(signals.filter((signal) => signal.lifecycle === "incident").map((signal) => signal.fingerprint));

    for (const signal of signals) {
      const existing = byFingerprint.get(signal.fingerprint);
      if (!existing) {
        const action: OpsAction = {
          actionId: actionIdForFingerprint(signal.fingerprint),
          fingerprint: signal.fingerprint,
          kind: signal.kind,
          lifecycle: signal.lifecycle,
          severity: signal.severity,
          title: signal.title,
          detail: signal.detail,
          nextAction: signal.nextAction,
          href: signal.href,
          status: "open",
          sourceActive: signal.lifecycle === "incident",
          ownerId: "",
          ownerLabel: "",
          snoozedUntil: "",
          createdAt: timestamp,
          updatedAt: timestamp,
          resolvedAt: "",
          events: [event({ type: "detected", at: timestamp, actor: SYSTEM_ACTOR, fromStatus: null, toStatus: "open", note: "Created from an OpsCenter alert." })],
        };
        byFingerprint.set(signal.fingerprint, action);
        continue;
      }

      const wasResolved = existing.status === "resolved";
      const metadataChanged = existing.kind !== signal.kind
        || existing.lifecycle !== signal.lifecycle
        || existing.severity !== signal.severity
        || existing.title !== signal.title
        || existing.detail !== signal.detail
        || existing.nextAction !== signal.nextAction
        || existing.href !== signal.href;
      const updated: OpsAction = {
        ...existing,
        kind: signal.kind,
        lifecycle: signal.lifecycle,
        severity: signal.severity,
        title: signal.title,
        detail: signal.detail,
        nextAction: signal.nextAction,
        href: signal.href,
        sourceActive: signal.lifecycle === "incident",
        status: wasResolved ? "open" : existing.status,
        resolvedAt: wasResolved ? "" : existing.resolvedAt,
        updatedAt: wasResolved || metadataChanged ? timestamp : existing.updatedAt,
      };
      if (wasResolved) {
        updated.events = [...updated.events, event({ type: "reopened", at: timestamp, actor: SYSTEM_ACTOR, fromStatus: "resolved", toStatus: "open", note: "The source condition became active again." })];
      } else if (metadataChanged) {
        updated.events = [...updated.events, event({ type: "updated", at: timestamp, actor: SYSTEM_ACTOR, fromStatus: existing.status, toStatus: existing.status, note: "The source alert details changed." })];
      }
      byFingerprint.set(signal.fingerprint, updated);
    }

    for (const [fingerprint, action] of byFingerprint) {
      if (action.lifecycle !== "incident" || !action.sourceActive || activeIncidentFingerprints.has(fingerprint)) continue;
      const resolved: OpsAction = {
        ...action,
        status: "resolved",
        sourceActive: false,
        snoozedUntil: "",
        updatedAt: timestamp,
        resolvedAt: timestamp,
        events: [...action.events, event({ type: "source_cleared", at: timestamp, actor: SYSTEM_ACTOR, fromStatus: action.status, toStatus: "resolved", note: "The underlying OpsCenter condition cleared." })],
      };
      byFingerprint.set(fingerprint, resolved);
    }

    const actions = sortActions(Array.from(byFingerprint.values()));
    writeStoreUnsafe({ version: 1, updatedAt: timestamp, actions });
    return new Map(actions.map((action) => [action.fingerprint, action]));
  });
}

export function transitionOpsAction(input: {
  actionId: string;
  operation: OpsActionOperation;
  actor: OpsActionActor;
  snoozeMinutes?: number;
  note?: string;
  now?: Date;
}): OpsAction | null {
  const now = input.now || new Date();
  const timestamp = now.toISOString();
  return withStoreLock(() => {
    const store = readStoreUnsafe();
    const index = store.actions.findIndex((action) => action.actionId === input.actionId);
    if (index < 0) return null;
    const current = effectiveAction(store.actions[index], now);
    let status: OpsActionStatus;
    let type: OpsActionEvent["type"];
    let snoozedUntil = "";
    if (input.operation === "acknowledge") {
      status = "acknowledged";
      type = "acknowledged";
    } else if (input.operation === "snooze") {
      const minutes = [15, 30, 60, 240].includes(Number(input.snoozeMinutes)) ? Number(input.snoozeMinutes) : 60;
      status = "snoozed";
      type = "snoozed";
      snoozedUntil = new Date(now.getTime() + minutes * 60_000).toISOString();
    } else if (input.operation === "handle") {
      status = "handled";
      type = "handled";
    } else {
      status = "open";
      type = "reopened";
    }

    const actor = normalizeActor(input.actor);
    const updated: OpsAction = {
      ...current,
      status,
      snoozedUntil,
      ownerId: input.operation === "reopen" ? "" : actor.id,
      ownerLabel: input.operation === "reopen" ? "" : actor.label,
      updatedAt: timestamp,
      resolvedAt: "",
      events: [...current.events, event({
        type,
        at: timestamp,
        actor,
        fromStatus: current.status,
        toStatus: status,
        note: String(input.note || "").trim().slice(0, 500),
      })],
    };
    store.actions[index] = updated;
    store.actions = sortActions(store.actions);
    store.updatedAt = timestamp;
    writeStoreUnsafe(store);
    return updated;
  });
}
