import fs from "node:fs";
import path from "node:path";

export type CustomerContactChannel = "phone" | "sms";
export type CustomerContactOutcome = "reached" | "voicemail" | "no_answer" | "sms_sent" | "sms_not_sent";

export type CustomerContactRecord = {
  recordId: string;
  date: string;
  appointmentId: string;
  jobKey: string;
  channel: CustomerContactChannel;
  purpose: string;
  message: string;
  owner: string;
  nextAction: string;
  sourceObservationKey: string;
  sourceObservedAt: string;
  status: "approved" | "outcome_recorded" | "not_completed";
  requestedBy: string;
  approvedAt: string;
  outcome: CustomerContactOutcome | "";
  evidenceNote: string;
  junkwareVerifiedAt: string;
  updatedAt: string;
  updatedBy: string;
};

export type CustomerContactStore = {
  version: 1;
  updatedAt: string;
  records: CustomerContactRecord[];
};

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function storePath(): string {
  const configured = clean(process.env.CUSTOMER_CONTACT_STORE);
  const root = clean(process.env.OPSBOT_DATA_DIR) || path.join(process.cwd(), "data");
  return configured || path.join(root, "communications", "customer-contact.json");
}

function emptyStore(): CustomerContactStore {
  return { version: 1, updatedAt: "", records: [] };
}

export function readCustomerContactStore(): CustomerContactStore {
  try {
    const file = storePath();
    if (!fs.existsSync(file)) return emptyStore();
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    const records = (Array.isArray(payload?.records) ? payload.records : []).flatMap((entry: Record<string, unknown>) => {
      const appointmentId = clean(entry.appointmentId);
      const channel = clean(entry.channel) as CustomerContactChannel;
      const status = clean(entry.status) as CustomerContactRecord["status"];
      if (!/^\d{1,12}$/.test(appointmentId) || !["phone", "sms"].includes(channel) || !["approved", "outcome_recorded", "not_completed"].includes(status)) return [];
      return [{
        recordId: clean(entry.recordId),
        date: clean(entry.date),
        appointmentId,
        jobKey: clean(entry.jobKey),
        channel,
        purpose: clean(entry.purpose).slice(0, 120),
        message: clean(entry.message).slice(0, 500),
        owner: clean(entry.owner).slice(0, 120),
        nextAction: clean(entry.nextAction).slice(0, 240),
        sourceObservationKey: clean(entry.sourceObservationKey),
        sourceObservedAt: clean(entry.sourceObservedAt),
        status,
        requestedBy: clean(entry.requestedBy).slice(0, 320),
        approvedAt: clean(entry.approvedAt),
        outcome: clean(entry.outcome) as CustomerContactOutcome | "",
        evidenceNote: clean(entry.evidenceNote).slice(0, 1000),
        junkwareVerifiedAt: clean(entry.junkwareVerifiedAt),
        updatedAt: clean(entry.updatedAt),
        updatedBy: clean(entry.updatedBy).slice(0, 320),
      } satisfies CustomerContactRecord];
    });
    return { version: 1, updatedAt: clean(payload?.updatedAt), records };
  } catch {
    return emptyStore();
  }
}

function nextTimestamp(previous: string): string {
  const now = Date.now();
  const prior = Date.parse(previous);
  return new Date(Number.isFinite(prior) && prior >= now ? prior + 1 : now).toISOString();
}

function writeStore(store: CustomerContactStore): void {
  const file = storePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(temporary, `${JSON.stringify(store, null, 2)}\n`, { encoding: "utf8", mode: 0o660 });
  fs.chmodSync(temporary, 0o660);
  fs.renameSync(temporary, file);
}

export function customerContactRecord(recordId: string): CustomerContactRecord | null {
  return readCustomerContactStore().records.find((record) => record.recordId === clean(recordId)) || null;
}

export function saveApprovedCustomerContact(
  input: Omit<CustomerContactRecord, "status" | "approvedAt" | "outcome" | "evidenceNote" | "junkwareVerifiedAt" | "updatedAt" | "updatedBy">,
  expectedStoreUpdatedAt: string,
): CustomerContactRecord {
  const store = readCustomerContactStore();
  if (store.updatedAt !== expectedStoreUpdatedAt) throw new Error("VERSION_CONFLICT: Customer contact state changed after this request was prepared.");
  const updatedAt = nextTimestamp(store.updatedAt);
  const saved: CustomerContactRecord = {
    ...input,
    status: "approved",
    approvedAt: updatedAt,
    outcome: "",
    evidenceNote: "",
    junkwareVerifiedAt: "",
    updatedAt,
    updatedBy: input.requestedBy,
  };
  const records = [...store.records.filter((record) => record.recordId !== input.recordId), saved]
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  writeStore({ version: 1, updatedAt, records });
  return saved;
}

export function saveCustomerContactOutcome(input: {
  recordId: string;
  outcome: CustomerContactOutcome;
  evidenceNote: string;
  junkwareVerifiedAt: string;
  updatedBy: string;
}, expected: { storeUpdatedAt: string; recordUpdatedAt: string }): CustomerContactRecord {
  const store = readCustomerContactStore();
  const current = store.records.find((record) => record.recordId === clean(input.recordId));
  if (!current) throw new Error("The approved customer contact plan is unavailable.");
  if (store.updatedAt !== expected.storeUpdatedAt || current.updatedAt !== expected.recordUpdatedAt) {
    throw new Error("VERSION_CONFLICT: Customer contact state changed after this request was prepared.");
  }
  if (current.status !== "approved") throw new Error("The customer contact plan already has a recorded outcome.");
  const updatedAt = nextTimestamp(store.updatedAt);
  const saved: CustomerContactRecord = {
    ...current,
    status: ["reached", "voicemail", "sms_sent"].includes(input.outcome) ? "outcome_recorded" : "not_completed",
    outcome: input.outcome,
    evidenceNote: clean(input.evidenceNote).slice(0, 1000),
    junkwareVerifiedAt: clean(input.junkwareVerifiedAt),
    updatedAt,
    updatedBy: clean(input.updatedBy).slice(0, 320),
  };
  const records = store.records.map((record) => record.recordId === saved.recordId ? saved : record);
  writeStore({ version: 1, updatedAt, records });
  return saved;
}
