import { randomUUID } from "node:crypto";
import { getQboConfig, QBO_PAYMENT_SCOPE, type IntuitEnvironment } from "@/lib/qbo-config";
import { getValidQboTokenEnvelope } from "@/lib/qbo-oauth";
import { getQboTokenStoreStatus } from "@/lib/qbo-token-store";

const PAYMENTS_PRODUCTION_BASE = "https://api.intuit.com";
const PAYMENTS_SANDBOX_BASE = "https://sandbox.api.intuit.com";
const DEFAULT_MAX_AMOUNT = 10_000;

export type QboPaymentChargeInput = {
  appointmentId: string;
  jkNumber: string;
  amount: string;
  currency: "USD";
  token: string;
  requestId: string;
  recaptchaToken: string;
};

export type QboPaymentChargeResult = {
  requestId: string;
  chargeId: string;
  status: string;
  amount: string;
  currency: "USD";
  cardLastFour: string;
  cardType: string;
  createdAt: string;
  intuitTid: string;
};

export class QboPaymentError extends Error {
  readonly status: number;
  readonly definite: boolean;
  readonly intuitTid: string;

  constructor(message: string, options: { status?: number; definite?: boolean; intuitTid?: string } = {}) {
    super(message);
    this.name = "QboPaymentError";
    this.status = options.status || 502;
    this.definite = options.definite !== false;
    this.intuitTid = options.intuitTid || "";
  }
}

function enabled(value: string | undefined): boolean {
  return /^(1|true|yes|on)$/i.test(String(value || "").trim());
}

function paymentsBase(environment: IntuitEnvironment): string {
  return environment === "sandbox" ? PAYMENTS_SANDBOX_BASE : PAYMENTS_PRODUCTION_BASE;
}

function configuredMaximum(): number {
  const value = Number(process.env.QBO_PAYMENTS_MAX_AMOUNT || DEFAULT_MAX_AMOUNT);
  return Number.isFinite(value) && value >= 1 && value <= 1_000_000 ? value : DEFAULT_MAX_AMOUNT;
}

function tokenScopes(): string[] {
  const status = getQboTokenStoreStatus();
  return String(status.masked.scope || "").split(/\s+/).filter(Boolean);
}

export function getQboPaymentsStatus() {
  const config = getQboConfig();
  const liveChargesAllowed = enabled(process.env.QBO_PAYMENTS_ALLOW_LIVE_CHARGES);
  const recaptchaSiteKey = String(process.env.QBO_PAYMENTS_RECAPTCHA_SITE_KEY || "").trim();
  const recaptchaSecretConfigured = Boolean(String(process.env.QBO_PAYMENTS_RECAPTCHA_SECRET || "").trim());
  const storedScopes = tokenScopes();
  const paymentScopeGranted = storedScopes.includes(QBO_PAYMENT_SCOPE);
  const blockers = !config.paymentsEnabled
    ? ["QuickBooks Payments is disabled."]
    : [
      !config.ready ? "QuickBooks OAuth configuration is incomplete." : "",
      config.ready && !paymentScopeGranted ? "Reconnect QuickBooks to grant the Payments scope." : "",
      !recaptchaSiteKey || !recaptchaSecretConfigured ? "Payment fraud protection is not configured." : "",
      config.environment === "production" && !liveChargesAllowed ? "Live QuickBooks charges are locked." : "",
    ].filter(Boolean);

  return {
    enabled: config.paymentsEnabled,
    environment: config.environment,
    liveChargesAllowed,
    paymentScopeGranted,
    recaptchaSiteKey,
    recaptchaConfigured: Boolean(recaptchaSiteKey && recaptchaSecretConfigured),
    tokenizationUrl: `${paymentsBase(config.environment)}/quickbooks/v4/payments/tokens`,
    maximumAmount: configuredMaximum(),
    canCharge: blockers.length === 0,
    blockers,
  };
}

function normalizedAmount(value: unknown): string {
  const raw = String(value ?? "").replace(/[$,\s]/g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) throw new QboPaymentError("Enter a valid payment amount.", { status: 400 });
  const cents = Math.round(Number(raw) * 100);
  const maximumCents = Math.round(configuredMaximum() * 100);
  if (!Number.isSafeInteger(cents) || cents < 1 || cents > maximumCents) {
    throw new QboPaymentError(`Payment amount must be between $0.01 and $${configuredMaximum().toFixed(2)}.`, { status: 400 });
  }
  return (cents / 100).toFixed(2);
}

export function parseQboPaymentChargeInput(value: unknown): QboPaymentChargeInput {
  if (!value || typeof value !== "object") throw new QboPaymentError("Payment details are required.", { status: 400 });
  const body = value as Record<string, unknown>;
  const appointmentId = String(body.appointmentId || "").trim();
  const jkNumber = String(body.jkNumber || "").trim().toUpperCase();
  const token = String(body.token || "").trim();
  const requestId = String(body.requestId || "").trim().toLowerCase();
  const recaptchaToken = String(body.recaptchaToken || "").trim();

  if (!/^\d{1,12}$/.test(appointmentId)) throw new QboPaymentError("A valid JunkWare appointment is required.", { status: 400 });
  if (!/^JK\d{1,12}$/.test(jkNumber)) throw new QboPaymentError("A valid JK number is required.", { status: 400 });
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(requestId)) {
    throw new QboPaymentError("The payment request ID is not valid.", { status: 400 });
  }
  if (!token || token.length > 2_048 || /\s/.test(token)) throw new QboPaymentError("The card token is not valid.", { status: 400 });
  if (!recaptchaToken || recaptchaToken.length > 4_096) throw new QboPaymentError("Complete the fraud-protection check.", { status: 400 });

  return {
    appointmentId,
    jkNumber,
    amount: normalizedAmount(body.amount),
    currency: "USD",
    token,
    requestId,
    recaptchaToken,
  };
}

export async function verifyQboPaymentRecaptcha(token: string, remoteIp = ""): Promise<void> {
  const secret = String(process.env.QBO_PAYMENTS_RECAPTCHA_SECRET || "").trim();
  if (!secret) throw new QboPaymentError("Payment fraud protection is not configured.", { status: 503 });
  const response = await fetch("https://www.google.com/recaptcha/api/siteverify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ secret, response: token, ...(remoteIp ? { remoteip: remoteIp } : {}) }),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok || body.success !== true) {
    throw new QboPaymentError("The fraud-protection check could not be verified. Please try again.", { status: 400 });
  }
}

function lastFour(value: unknown): string {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : "";
}

function paymentErrorMessage(status: number, body: Record<string, unknown>): string {
  if (status === 401 || status === 403) return "QuickBooks has not authorized OpsCenter to process payments.";
  if (status === 400 || status === 402 || status === 422) return "QuickBooks declined or could not process this card payment.";
  const errors = Array.isArray(body.errors) ? body.errors : [];
  if (errors.some((error) => String((error as Record<string, unknown>)?.type || "").includes("declin"))) {
    return "QuickBooks declined this card payment.";
  }
  return "QuickBooks could not complete the payment.";
}

async function paymentFetch(url: string, init: RequestInit): Promise<Response> {
  let envelope = await getValidQboTokenEnvelope();
  const send = (accessToken: string) => fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
  });
  let response = await send(envelope.accessToken);
  if (response.status === 401) {
    envelope = await getValidQboTokenEnvelope(true);
    response = await send(envelope.accessToken);
  }
  return response;
}

export async function createQboPaymentCharge(input: QboPaymentChargeInput): Promise<QboPaymentChargeResult> {
  const config = getQboConfig();
  const status = getQboPaymentsStatus();
  if (!status.canCharge) throw new QboPaymentError(status.blockers[0] || "QuickBooks Payments is unavailable.", { status: 503 });

  const envelope = await getValidQboTokenEnvelope();
  if (!String(envelope.scope || "").split(/\s+/).includes(QBO_PAYMENT_SCOPE)) {
    throw new QboPaymentError("Reconnect QuickBooks to grant the Payments scope.", { status: 403 });
  }

  const endpoint = `${paymentsBase(config.environment)}/quickbooks/v4/payments/charges`;
  let response: Response;
  try {
    response = await paymentFetch(endpoint, {
      method: "POST",
      headers: { "Request-Id": input.requestId },
      body: JSON.stringify({
        amount: input.amount,
        token: input.token,
        currency: input.currency,
        capture: true,
        context: { mobile: false, isEcommerce: true },
      }),
    });
  } catch (error) {
    throw new QboPaymentError(
      "The QuickBooks response was interrupted. Retry this same payment attempt before entering the card again.",
      { status: 502, definite: false },
    );
  }

  const intuitTid = String(response.headers.get("intuit_tid") || "").trim();
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    throw new QboPaymentError(paymentErrorMessage(response.status, body), {
      status: response.status >= 400 && response.status < 500 ? response.status : 502,
      definite: response.status < 500 && response.status !== 429,
      intuitTid,
    });
  }

  const chargeId = String(body.id || body.clientTransID || "").trim();
  const chargeStatus = String(body.status || "").trim().toUpperCase();
  const card = body.card && typeof body.card === "object" ? body.card as Record<string, unknown> : {};
  if (!chargeId || chargeStatus !== "CAPTURED") {
    throw new QboPaymentError("QuickBooks returned an unverified payment result. Do not charge the card again until it is reviewed.", {
      status: 502,
      definite: false,
      intuitTid,
    });
  }

  return {
    requestId: input.requestId,
    chargeId,
    status: chargeStatus,
    amount: normalizedAmount(body.amount || input.amount),
    currency: "USD",
    cardLastFour: lastFour(card.number),
    cardType: String(card.cardType || "Card").trim().slice(0, 32),
    createdAt: String(body.created || new Date().toISOString()).trim(),
    intuitTid,
  };
}

export function newQboPaymentRequestId(): string {
  return randomUUID();
}
