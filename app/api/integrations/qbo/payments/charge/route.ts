import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import {
  createQboPaymentCharge,
  parseQboPaymentChargeInput,
  QboPaymentError,
  verifyQboPaymentRecaptcha,
  type QboPaymentChargeResult,
} from "@/lib/qbo-payments";
import {
  QboPaymentRequestBusyError,
  readQboPaymentAuditRecord,
  withQboPaymentRequestLock,
  writeQboPaymentAuditRecord,
  type QboPaymentAuditRecord,
} from "@/lib/qbo-payment-store";

export const dynamic = "force-dynamic";

function responseFromAudit(record: QboPaymentAuditRecord): QboPaymentChargeResult {
  return {
    requestId: record.requestId,
    chargeId: record.chargeId,
    status: record.chargeStatus,
    amount: record.amount,
    currency: "USD",
    cardLastFour: record.cardLastFour,
    cardType: "Card",
    createdAt: record.updatedAt,
    intuitTid: record.intuitTid,
  };
}

function sameAttempt(record: QboPaymentAuditRecord, appointmentId: string, amount: string): boolean {
  return record.appointmentId === appointmentId && record.amount === amount;
}

function json(payload: Record<string, unknown>, status = 200) {
  return NextResponse.json(payload, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const session = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (!session) return json({ error: "Authentication required." }, 401);

  try {
    const input = parseQboPaymentChargeInput(await request.json().catch(() => null));
    const existing = readQboPaymentAuditRecord(input.requestId);
    if (existing && !sameAttempt(existing, input.appointmentId, input.amount)) {
      return json({ error: "This payment request ID belongs to a different payment." }, 409);
    }
    if (existing?.status === "succeeded") {
      return json({ ok: true, duplicatePrevented: true, charge: responseFromAudit(existing) });
    }

    const result = await withQboPaymentRequestLock(input.requestId, async () => {
      const lockedExisting = readQboPaymentAuditRecord(input.requestId);
      if (lockedExisting?.status === "succeeded") return responseFromAudit(lockedExisting);

      const now = new Date().toISOString();
      const baseRecord: QboPaymentAuditRecord = {
        version: 1,
        requestId: input.requestId,
        appointmentId: input.appointmentId,
        jkNumber: input.jkNumber,
        actor: session.email,
        amount: input.amount,
        currency: "USD",
        environment: String(process.env.INTUIT_ENVIRONMENT || "production").toLowerCase() === "sandbox" ? "sandbox" : "production",
        status: "requested",
        chargeId: "",
        chargeStatus: "",
        cardLastFour: "",
        intuitTid: "",
        error: "",
        createdAt: lockedExisting?.createdAt || now,
        updatedAt: now,
      };
      writeQboPaymentAuditRecord(baseRecord);

      const requestHeaders = await headers();
      const remoteIp = String(requestHeaders.get("cf-connecting-ip") || requestHeaders.get("x-forwarded-for") || "")
        .split(",")[0]
        .trim();

      try {
        await verifyQboPaymentRecaptcha(input.recaptchaToken, remoteIp);
        const charge = await createQboPaymentCharge(input);
        writeQboPaymentAuditRecord({
          ...baseRecord,
          status: "succeeded",
          chargeId: charge.chargeId,
          chargeStatus: charge.status,
          cardLastFour: charge.cardLastFour,
          intuitTid: charge.intuitTid,
          updatedAt: new Date().toISOString(),
        });
        return charge;
      } catch (error) {
        const paymentError = error instanceof QboPaymentError
          ? error
          : new QboPaymentError("The payment result is unknown. Review QuickBooks before trying another charge.", { definite: false });
        writeQboPaymentAuditRecord({
          ...baseRecord,
          status: paymentError.definite ? "failed" : "unknown",
          intuitTid: paymentError.intuitTid,
          error: paymentError.message,
          updatedAt: new Date().toISOString(),
        });
        throw paymentError;
      }
    });

    return json({ ok: true, charge: result });
  } catch (error) {
    if (error instanceof QboPaymentRequestBusyError) {
      return json({ error: error.message, retryable: true }, 409);
    }
    if (error instanceof QboPaymentError) {
      return json({
        error: error.message,
        retryable: !error.definite,
        reviewRequired: !error.definite,
        intuitTid: error.intuitTid || undefined,
      }, error.status);
    }
    return json({ error: "OpsCenter could not process the payment safely.", reviewRequired: true }, 500);
  }
}
