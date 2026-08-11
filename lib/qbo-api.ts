import { IntuitEnvironment } from "@/lib/qbo-config";
import { getValidQboTokenEnvelope } from "@/lib/qbo-oauth";

const ACCOUNTING_PRODUCTION_BASE = "https://quickbooks.api.intuit.com";
const ACCOUNTING_SANDBOX_BASE = "https://sandbox-quickbooks.api.intuit.com";
const MINOR_VERSION = "75";

export type QboAccountingTransaction = {
  date: string;
  transactionId: string;
  amount: number;
  customerName: string;
  cardLastFour: string;
  status: string;
  transactionType: "Payment" | "SalesReceipt";
  paymentMethod: string;
  fee: number;
  net: number;
};

function accountingBase(environment: IntuitEnvironment): string {
  return environment === "sandbox" ? ACCOUNTING_SANDBOX_BASE : ACCOUNTING_PRODUCTION_BASE;
}

async function apiFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let envelope = await getValidQboTokenEnvelope();
  let response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${envelope.accessToken}`,
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  if (response.status === 401) {
    envelope = await getValidQboTokenEnvelope(true);
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${envelope.accessToken}`,
        ...(init.headers || {}),
      },
      cache: "no-store",
    });
  }
  return response;
}

async function jsonOrError(response: Response, operation: string): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const intuitTid = response.headers.get("intuit_tid");
    const suffix = intuitTid ? ` (Intuit request ${intuitTid})` : "";
    throw new Error(`${operation} failed with HTTP ${response.status}${suffix}.`);
  }
  return body;
}

export async function getQboCompanyInfo(environment: IntuitEnvironment): Promise<Record<string, unknown>> {
  const envelope = await getValidQboTokenEnvelope();
  const realmId = encodeURIComponent(envelope.realmId);
  const url = `${accountingBase(environment)}/v3/company/${realmId}/companyinfo/${realmId}?minorversion=${MINOR_VERSION}`;
  const body = await jsonOrError(await apiFetch(url), "QBO company verification");
  return (body.CompanyInfo || body) as Record<string, unknown>;
}

function queryRows(body: Record<string, unknown>, entity: string): Record<string, unknown>[] {
  const response = body.QueryResponse;
  if (!response || typeof response !== "object") return [];
  const rows = (response as Record<string, unknown>)[entity];
  return Array.isArray(rows)
    ? rows.filter((row) => row && typeof row === "object") as Record<string, unknown>[]
    : [];
}

async function queryEntity(
  environment: IntuitEnvironment,
  entity: string,
  whereClause = "",
): Promise<Record<string, unknown>[]> {
  const envelope = await getValidQboTokenEnvelope();
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let start = 1; start <= 10_000; start += pageSize) {
    const statement = `SELECT * FROM ${entity}${whereClause ? ` WHERE ${whereClause}` : ""} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const url = new URL(`${accountingBase(environment)}/v3/company/${encodeURIComponent(envelope.realmId)}/query`);
    url.searchParams.set("query", statement);
    url.searchParams.set("minorversion", MINOR_VERSION);
    const body = await jsonOrError(await apiFetch(url.toString()), `QBO ${entity} query`);
    const page = queryRows(body, entity);
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}

function refName(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return String((value as Record<string, unknown>).name || "").trim();
}

function refId(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  return String((value as Record<string, unknown>).value || "").trim();
}

function numberValue(value: unknown): number {
  const parsed = Number(String(value ?? "").replace(/[$,]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectValue(object: Record<string, unknown>, ...keys: string[]): unknown {
  let value: unknown = object;
  for (const key of keys) {
    if (!value || typeof value !== "object") return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function lastFour(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function isCreditCardMethod(name: string, type: string): boolean {
  if (type.toUpperCase() === "CREDIT_CARD") return true;
  return /\b(card|visa|master\s*card|amex|american express|discover)\b/i.test(name);
}

export function normalizeQboAccountingTransaction(
  raw: Record<string, unknown>,
  entity: "Payment" | "SalesReceipt",
  paymentMethods: Map<string, { name: string; type: string }>,
): QboAccountingTransaction | null {
  const date = String(raw.TxnDate || "").trim();
  const transactionId = String(raw.Id || raw.PaymentRefNum || raw.DocNumber || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !transactionId) return null;

  const methodId = refId(raw.PaymentMethodRef);
  const configuredMethod = paymentMethods.get(methodId);
  const paymentMethod = refName(raw.PaymentMethodRef) || configuredMethod?.name || "";
  const methodType = configuredMethod?.type || "";
  const creditCardPayment = raw.CreditCardPayment;
  if (!creditCardPayment && !isCreditCardMethod(paymentMethod, methodType)) return null;

  const amount = Math.abs(numberValue(raw.TotalAmt));
  if (amount <= 0) return null;
  const cardNumber = objectValue(raw, "CreditCardPayment", "CreditChargeInfo", "Number")
    || objectValue(raw, "CreditCardPayment", "CreditChargeInfo", "CardNumber")
    || objectValue(raw, "CreditCardPayment", "CreditChargeResponse", "MaskedCardNumber");

  return {
    date,
    transactionId,
    amount,
    customerName: refName(raw.CustomerRef),
    cardLastFour: lastFour(cardNumber),
    status: String(raw.TxnStatus || "posted").trim(),
    transactionType: entity,
    paymentMethod: paymentMethod || "Credit Card",
    fee: 0,
    net: amount,
  };
}

export async function listQboCreditCardTransactions(
  environment: IntuitEnvironment,
  targetDate: string,
): Promise<QboAccountingTransaction[]> {
  const methods = new Map<string, { name: string; type: string }>();
  for (const row of await queryEntity(environment, "PaymentMethod")) {
    const id = String(row.Id || "").trim();
    if (id) methods.set(id, { name: String(row.Name || "").trim(), type: String(row.Type || "").trim() });
  }

  const where = `TxnDate = '${targetDate}'`;
  const [payments, salesReceipts] = await Promise.all([
    queryEntity(environment, "Payment", where),
    queryEntity(environment, "SalesReceipt", where),
  ]);
  const normalized = [
    ...payments.map((row) => normalizeQboAccountingTransaction(row, "Payment", methods)),
    ...salesReceipts.map((row) => normalizeQboAccountingTransaction(row, "SalesReceipt", methods)),
  ].filter((row): row is QboAccountingTransaction => Boolean(row));

  return normalized.sort((left, right) =>
    `${left.date}|${left.transactionType}|${left.transactionId}`.localeCompare(
      `${right.date}|${right.transactionType}|${right.transactionId}`,
    ),
  );
}
