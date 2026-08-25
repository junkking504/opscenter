import fs from "fs";
import path from "path";
import { chicagoDateKey } from "@/lib/chicago-date";

export type PaymentSource = {
  name: string;
  url: string;
  available: boolean;
  file?: string | null;
  collected_at?: string | null;
  account_name?: string;
  account_number_last_four?: string;
  qbo_company_name?: string;
  collector?: string;
};

export type JunkwarePayment = {
  date: string;
  jk_number: string;
  amount: number;
  revenue_amount?: number;
  paid_amount?: number;
  tip_amount?: number;
  payment_method: string;
  card_last_four: string;
  customer_name: string;
  junkware_sync_status: string;
};

export type MerchantCenterPayment = {
  date: string;
  transaction_id: string;
  amount: number;
  customer_name: string;
  card_last_four: string;
  status: string;
  transaction_type: string;
  fee: number;
  net: number;
};

export type PaymentReconciliationSummary = {
  junkware_count: number;
  junkware_total: number;
  merchant_center_count: number;
  merchant_center_total: number;
  matched_count: number;
  matched_total: number;
  tip_total: number;
  missing_in_merchant_center_count: number;
  merchant_center_only_count: number;
  ambiguous_count: number;
  amount_mismatch_count: number;
  exception_count: number;
  net_difference: number;
  processing_fees: number;
};

export type PaymentReconciliation = {
  date: string;
  generated_at: string;
  status: "balanced" | "needs_review" | "merchant_data_missing";
  sources: {
    junkware: PaymentSource;
    merchant_center: PaymentSource;
  };
  summary: PaymentReconciliationSummary;
  matches: Array<{
    junkware: JunkwarePayment;
    merchant_center: MerchantCenterPayment;
    amount_difference: number;
    match_confidence: string;
    match_basis: string[];
  }>;
  exceptions: {
    missing_in_merchant_center: JunkwarePayment[];
    merchant_center_only: MerchantCenterPayment[];
    ambiguous: Array<{
      junkware: JunkwarePayment;
      candidates: MerchantCenterPayment[];
      reason: string;
    }>;
    amount_mismatch?: Array<{
      junkware: JunkwarePayment;
      merchant_center: MerchantCenterPayment;
      amount_difference: number;
      reason: string;
    }>;
  };
};

export type PaymentExceptionRow = {
  date: string;
  type: string;
  reference: string;
  customer: string;
  cardLastFour: string;
  junkwareAmount: number | null;
  merchantAmount: number | null;
};

export type PaymentByJobRow = {
  date: string;
  jkNumber: string;
  customer: string;
  paymentMethod: string;
  cardLastFour: string;
  paidAmount: number;
  revenueAmount: number | null;
  tipAmount: number | null;
  qboTransactionId: string | null;
  qboTransactionType: string | null;
  qboStatus: string | null;
  reconciliation: "Matched" | "Needs review" | "Missing in QBO";
};

export type PaymentReconciliationView = {
  status: "balanced" | "needs_review" | "merchant_data_missing" | "merchant_data_stale" | "not_collected";
  summary: PaymentReconciliationSummary;
  exceptions: PaymentExceptionRow[];
  paymentsByJob: PaymentByJobRow[];
  generatedAt: string | null;
  merchantCenterAvailable: boolean;
  merchantCenterFresh: boolean;
  merchantCenterCollectedAt: string | null;
  merchantSourceName: string;
  merchantCollector: string;
  coverage: {
    collectedDays: number;
    expectedDays: number;
    merchantDays: number;
  };
};

const EMPTY_SUMMARY: PaymentReconciliationSummary = {
  junkware_count: 0,
  junkware_total: 0,
  merchant_center_count: 0,
  merchant_center_total: 0,
  matched_count: 0,
  matched_total: 0,
  tip_total: 0,
  missing_in_merchant_center_count: 0,
  merchant_center_only_count: 0,
  ambiguous_count: 0,
  amount_mismatch_count: 0,
  exception_count: 0,
  net_difference: 0,
  processing_fees: 0,
};

const EXPECTED_MERCHANT_ACCOUNT = "junk krewe";
const EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR = "4618";
const CURRENT_DAY_FRESHNESS_MS = 15 * 60 * 1000;

function merchantCollectedAt(payload: PaymentReconciliation): string | null {
  const declared = payload.sources?.merchant_center?.collected_at;
  if (declared && !Number.isNaN(new Date(declared).getTime())) return declared;

  const file = payload.sources?.merchant_center?.file;
  if (!file) return null;
  try {
    return fs.statSync(file).mtime.toISOString();
  } catch {
    return null;
  }
}

function merchantDataIsFresh(payload: PaymentReconciliation): boolean {
  if (!payload.sources?.merchant_center?.available) return false;
  const collectedAt = merchantCollectedAt(payload);
  if (!collectedAt) return false;
  const collected = new Date(collectedAt);
  if (Number.isNaN(collected.getTime())) return false;

  const today = chicagoDateKey(new Date());
  if (payload.date < today) return chicagoDateKey(collected) > payload.date;
  if (payload.date > today) return false;
  return Date.now() - collected.getTime() <= CURRENT_DAY_FRESHNESS_MS;
}

function isExpectedMerchantAccount(payload: PaymentReconciliation): boolean {
  const merchant = payload.sources?.merchant_center;
  if (!merchant?.available) return true;
  if (merchant.collector === "qbo-accounting-api") {
    return Boolean(
      merchant.qbo_company_name?.trim()
      && merchant.account_name?.trim().toLowerCase() === merchant.qbo_company_name.trim().toLowerCase(),
    );
  }
  return (
    merchant.account_name?.trim().toLowerCase() === EXPECTED_MERCHANT_ACCOUNT &&
    merchant.account_number_last_four === EXPECTED_MERCHANT_ACCOUNT_LAST_FOUR
  );
}

function reconciliationDirs(): string[] {
  return [
    ...(process.env.OPSBOT_DATA_DIR
      ? [path.join(process.env.OPSBOT_DATA_DIR, "history", "payment_reconciliation")]
      : []),
    path.join(
      process.env.HOME || "",
      ".openclaw",
      "workspace",
      "opsbot",
      "data",
      "history",
      "payment_reconciliation",
    ),
    path.join(process.cwd(), "data", "history", "payment_reconciliation"),
    path.join(process.cwd(), "..", "opsbot", "data", "history", "payment_reconciliation"),
  ];
}

export function readPaymentReconciliation(date: string): PaymentReconciliation | null {
  for (const directory of reconciliationDirs()) {
    const file = path.join(directory, `payment_reconciliation_${date}.json`);
    try {
      if (!fs.existsSync(file)) continue;
      const payload = JSON.parse(fs.readFileSync(file, "utf8")) as PaymentReconciliation;
      if (
        payload?.date === date &&
        payload?.summary &&
        payload?.exceptions &&
        isExpectedMerchantAccount(payload)
      ) return payload;
    } catch {
      // Keep searching the fallback data directories.
    }
  }
  return null;
}

function exceptionRows(payload: PaymentReconciliation): PaymentExceptionRow[] {
  const sourceLabel = payload.sources?.merchant_center?.collector === "qbo-accounting-api"
    ? "QBO"
    : "Merchant Center";
  const missing = (payload.exceptions?.missing_in_merchant_center || []).map((row) => ({
    date: payload.date,
    type: `Missing in ${sourceLabel}`,
    reference: row.jk_number || "—",
    customer: row.customer_name || "—",
    cardLastFour: row.card_last_four || "",
    junkwareAmount: Number(row.amount || 0),
    merchantAmount: null,
  }));
  const merchantOnly = (payload.exceptions?.merchant_center_only || []).map((row) => ({
    date: payload.date,
    type: `${sourceLabel} only`,
    reference: row.transaction_id || "—",
    customer: row.customer_name || "—",
    cardLastFour: row.card_last_four || "",
    junkwareAmount: null,
    merchantAmount: Number(row.amount || 0),
  }));
  const ambiguous = (payload.exceptions?.ambiguous || []).map((row) => ({
    date: payload.date,
    type: "Ambiguous match" as const,
    reference: row.junkware?.jk_number || "—",
    customer: row.junkware?.customer_name || "—",
    cardLastFour: row.junkware?.card_last_four || "",
    junkwareAmount: Number(row.junkware?.amount || 0),
    merchantAmount: row.candidates?.[0] ? Number(row.candidates[0].amount || 0) : null,
  }));
  const amountMismatch = (payload.exceptions?.amount_mismatch || []).map((row) => ({
    date: payload.date,
    type: "Amount mismatch" as const,
    reference: row.junkware?.jk_number || row.merchant_center?.transaction_id || "—",
    customer: row.junkware?.customer_name || row.merchant_center?.customer_name || "—",
    cardLastFour: row.junkware?.card_last_four || row.merchant_center?.card_last_four || "",
    junkwareAmount: Number(row.junkware?.amount || 0),
    merchantAmount: Number(row.merchant_center?.amount || 0),
  }));
  return [...missing, ...merchantOnly, ...ambiguous, ...amountMismatch];
}

function paymentByJobRows(payload: PaymentReconciliation): PaymentByJobRow[] {
  const paymentRow = (
    junkware: JunkwarePayment,
    reconciliation: PaymentByJobRow["reconciliation"],
    merchant?: MerchantCenterPayment | null,
  ): PaymentByJobRow => ({
    date: junkware.date || payload.date,
    jkNumber: junkware.jk_number || "—",
    customer: junkware.customer_name || "—",
    paymentMethod: junkware.payment_method || "Card payment",
    cardLastFour: junkware.card_last_four || "",
    paidAmount: Number(junkware.paid_amount ?? junkware.amount ?? 0),
    revenueAmount: Number.isFinite(Number(junkware.revenue_amount)) ? Number(junkware.revenue_amount) : null,
    tipAmount: Number.isFinite(Number(junkware.tip_amount)) ? Number(junkware.tip_amount) : null,
    qboTransactionId: merchant?.transaction_id || null,
    qboTransactionType: merchant?.transaction_type || null,
    qboStatus: merchant?.status || null,
    reconciliation,
  });

  const matched = (payload.matches || []).map((match) =>
    paymentRow(match.junkware, "Matched", match.merchant_center),
  );
  const missing = (payload.exceptions?.missing_in_merchant_center || []).map((junkware) =>
    paymentRow(junkware, "Missing in QBO"),
  );
  const ambiguous = (payload.exceptions?.ambiguous || []).map((row) =>
    paymentRow(row.junkware, "Needs review", row.candidates?.[0] || null),
  );
  const amountMismatch = (payload.exceptions?.amount_mismatch || []).map((row) =>
    paymentRow(row.junkware, "Needs review", row.merchant_center),
  );

  return [...matched, ...missing, ...ambiguous, ...amountMismatch]
    .sort((a, b) => a.jkNumber.localeCompare(b.jkNumber));
}

export function buildDailyPaymentReconciliation(date: string): PaymentReconciliationView {
  const payload = readPaymentReconciliation(date);
  if (!payload) {
    return {
      status: "not_collected",
      summary: { ...EMPTY_SUMMARY },
      exceptions: [],
      paymentsByJob: [],
      generatedAt: null,
      merchantCenterAvailable: false,
      merchantCenterFresh: false,
      merchantCenterCollectedAt: null,
      merchantSourceName: "QuickBooks Online API",
      merchantCollector: "qbo-accounting-api",
      coverage: { collectedDays: 0, expectedDays: 1, merchantDays: 0 },
    };
  }
  const merchantCenterAvailable = Boolean(payload.sources?.merchant_center?.available);
  const merchantCenterFresh = merchantDataIsFresh(payload);
  const summary = { ...EMPTY_SUMMARY, ...payload.summary };
  return {
    status: merchantCenterAvailable && !merchantCenterFresh ? "merchant_data_stale" : payload.status,
    summary,
    exceptions: exceptionRows(payload),
    paymentsByJob: paymentByJobRows(payload),
    generatedAt: payload.generated_at || null,
    merchantCenterAvailable,
    merchantCenterFresh,
    merchantCenterCollectedAt: merchantCollectedAt(payload),
    merchantSourceName: payload.sources.merchant_center.name || "QuickBooks Online API",
    merchantCollector: payload.sources.merchant_center.collector || "merchant-center-export",
    coverage: {
      collectedDays: 1,
      expectedDays: 1,
      merchantDays: merchantCenterFresh ? 1 : 0,
    },
  };
}

export function buildMonthlyPaymentReconciliation(dates: string[]): PaymentReconciliationView {
  const payloads = dates
    .map((date) => readPaymentReconciliation(date))
    .filter((payload): payload is PaymentReconciliation => Boolean(payload));
  if (!payloads.length) {
    return {
      status: "not_collected",
      summary: { ...EMPTY_SUMMARY },
      exceptions: [],
      paymentsByJob: [],
      generatedAt: null,
      merchantCenterAvailable: false,
      merchantCenterFresh: false,
      merchantCenterCollectedAt: null,
      merchantSourceName: "QuickBooks Online API",
      merchantCollector: "qbo-accounting-api",
      coverage: { collectedDays: 0, expectedDays: dates.length, merchantDays: 0 },
    };
  }

  const summary = payloads.reduce<PaymentReconciliationSummary>(
    (total, payload) => {
      for (const key of Object.keys(EMPTY_SUMMARY) as Array<keyof PaymentReconciliationSummary>) {
        total[key] += Number(payload.summary?.[key] || 0);
      }
      return total;
    },
    { ...EMPTY_SUMMARY },
  );
  for (const key of Object.keys(summary) as Array<keyof PaymentReconciliationSummary>) {
    summary[key] = Math.round(summary[key] * 100) / 100;
  }
  const merchantPayloads = payloads.filter((payload) => payload.sources?.merchant_center?.available);
  const freshMerchantPayloads = merchantPayloads.filter(merchantDataIsFresh);
  const merchantDays = freshMerchantPayloads.length;
  const allCovered = payloads.length === dates.length && merchantDays === dates.length;
  const allBalanced = allCovered && payloads.every((payload) => payload.status === "balanced");

  return {
    status: merchantPayloads.length > merchantDays
      ? "merchant_data_stale"
      : allBalanced
        ? "balanced"
        : merchantDays
          ? "needs_review"
          : "merchant_data_missing",
    summary,
    exceptions: payloads.flatMap(exceptionRows),
    paymentsByJob: payloads.flatMap(paymentByJobRows).sort((a, b) =>
      a.date.localeCompare(b.date) || a.jkNumber.localeCompare(b.jkNumber),
    ),
    generatedAt: payloads.map((payload) => payload.generated_at).filter(Boolean).sort().at(-1) || null,
    merchantCenterAvailable: merchantPayloads.length > 0,
    merchantCenterFresh: merchantPayloads.length > 0 && merchantPayloads.length === merchantDays,
    merchantCenterCollectedAt: merchantPayloads
      .map(merchantCollectedAt)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) || null,
    merchantSourceName: merchantPayloads.at(-1)?.sources.merchant_center.name || "QuickBooks Online API",
    merchantCollector: merchantPayloads.at(-1)?.sources.merchant_center.collector || "merchant-center-export",
    coverage: { collectedDays: payloads.length, expectedDays: dates.length, merchantDays },
  };
}
