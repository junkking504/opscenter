import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-qbo-test-"));
process.env.QBO_TOKEN_STORE_DIR = path.join(temporaryRoot, "qbo");
process.env.QBO_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
process.env.INTUIT_CLIENT_ID = "test-client";
process.env.INTUIT_CLIENT_SECRET = "test-secret";
process.env.INTUIT_REDIRECT_URI = "https://ops.junk-king.app/api/integrations/qbo/callback";
process.env.INTUIT_ENVIRONMENT = "production";
process.env.QBO_PAYMENTS_AUDIT_DIR = path.join(temporaryRoot, "payments-audit");

async function main() {
  const store = await import("../lib/qbo-token-store");
  const configModule = await import("../lib/qbo-config");
  const api = await import("../lib/qbo-api");
  const payments = await import("../lib/qbo-payments");
  const paymentStore = await import("../lib/qbo-payment-store");

  const now = new Date();
  const envelope = {
    realmId: "realm-test",
    accessToken: "access-secret-value",
    refreshToken: "refresh-secret-value",
    expiresAt: new Date(now.getTime() + 3_600_000).toISOString(),
    refreshExpiresAt: new Date(now.getTime() + 8_640_000).toISOString(),
    issuedAt: now.toISOString(),
    updatedAt: now.toISOString(),
    scope: "com.intuit.quickbooks.accounting",
  };

  store.writeQboTokenEnvelope(envelope);
  const storedText = fs.readFileSync(store.QBO_TOKEN_STORE_FILE, "utf8");
  assert.equal(storedText.includes(envelope.accessToken), false);
  assert.equal(storedText.includes(envelope.refreshToken), false);
  assert.deepEqual(store.readQboTokenEnvelope(), envelope);
  assert.equal(store.getQboTokenStoreStatus().encrypted, true);

  const config = configModule.getQboConfig();
  assert.equal(config.ready, true);
  assert.deepEqual(config.scopes, ["com.intuit.quickbooks.accounting"]);
  const connectUrl = configModule.buildIntuitConnectUrl(config, "state-test");
  assert.match(connectUrl, /com\.intuit\.quickbooks\.accounting/);
  assert.doesNotMatch(connectUrl, /com\.intuit\.quickbooks\.payment/);

  process.env.QBO_PAYMENTS_ENABLED = "true";
  const paymentConfig = configModule.getQboConfig();
  assert.deepEqual(paymentConfig.scopes, [
    "com.intuit.quickbooks.accounting",
    "com.intuit.quickbooks.payment",
  ]);
  assert.match(configModule.buildIntuitConnectUrl(paymentConfig, "payments-state"), /com\.intuit\.quickbooks\.payment/);

  const normalized = api.normalizeQboAccountingTransaction({
    Id: "payment-1",
    TxnDate: "2026-08-10",
    TxnStatus: "posted",
    TotalAmt: "153.41",
    CustomerRef: { value: "42", name: "Test Customer" },
    PaymentMethodRef: { value: "7", name: "Visa" },
  }, "Payment", new Map([["7", { name: "Visa", type: "CREDIT_CARD" }]]));
  assert.equal(normalized?.date, "2026-08-10");
  assert.equal(normalized?.transactionId, "payment-1");
  assert.equal(normalized?.amount, 153.41);
  assert.equal(normalized?.customerName, "Test Customer");
  assert.equal(normalized?.transactionType, "Payment");

  const cash = api.normalizeQboAccountingTransaction({
    Id: "payment-2",
    TxnDate: "2026-08-10",
    TotalAmt: 20,
    PaymentMethodRef: { value: "9", name: "Cash" },
  }, "Payment", new Map([["9", { name: "Cash", type: "CASH" }]]));
  assert.equal(cash, null);

  process.env.INTUIT_ENVIRONMENT = "sandbox";
  process.env.QBO_PAYMENTS_RECAPTCHA_SITE_KEY = "test-site-key";
  process.env.QBO_PAYMENTS_RECAPTCHA_SECRET = "test-recaptcha-secret";
  store.writeQboTokenEnvelope({
    ...envelope,
    scope: "com.intuit.quickbooks.accounting com.intuit.quickbooks.payment",
  });
  const paymentsStatus = payments.getQboPaymentsStatus();
  assert.equal(paymentsStatus.canCharge, true);
  assert.equal(paymentsStatus.environment, "sandbox");
  assert.match(paymentsStatus.tokenizationUrl, /^https:\/\/sandbox\.api\.intuit\.com\//);

  const requestId = payments.newQboPaymentRequestId();
  const input = payments.parseQboPaymentChargeInput({
    appointmentId: "4052118",
    jkNumber: "JK4052118",
    amount: "$1,234.5",
    token: "opaque-card-token=",
    requestId,
    recaptchaToken: "recaptcha-token",
  });
  assert.equal(input.amount, "1234.50");
  assert.throws(() => payments.parseQboPaymentChargeInput({ ...input, amount: "10000.01" }), /between/);

  const originalFetch = globalThis.fetch;
  const fetched: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = async (url, init) => {
    fetched.push({ url: String(url), init });
    if (String(url).includes("recaptcha")) {
      return new Response(JSON.stringify({ success: true }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({
      id: "charge-test-1",
      status: "CAPTURED",
      amount: "1234.50",
      currency: "USD",
      created: "2026-08-15T12:00:00Z",
      card: { number: "xxxxxxxxxxxx1111", cardType: "Visa" },
    }), { status: 200, headers: { "Content-Type": "application/json", intuit_tid: "intuit-test-id" } });
  };
  try {
    await payments.verifyQboPaymentRecaptcha(input.recaptchaToken, "127.0.0.1");
    const charge = await payments.createQboPaymentCharge(input);
    assert.equal(charge.chargeId, "charge-test-1");
    assert.equal(charge.cardLastFour, "1111");
    assert.equal(charge.intuitTid, "intuit-test-id");
    const chargeRequest = fetched.find((request) => request.url.endsWith("/quickbooks/v4/payments/charges"));
    assert.ok(chargeRequest);
    assert.equal(new Headers(chargeRequest.init?.headers).get("Request-Id"), requestId);
    const chargeBody = JSON.parse(String(chargeRequest.init?.body || "{}"));
    assert.equal(chargeBody.token, input.token);
    assert.equal(chargeBody.amount, "1234.50");
    assert.equal("appointmentId" in chargeBody, false);
    assert.equal("jkNumber" in chargeBody, false);
  } finally {
    globalThis.fetch = originalFetch;
  }

  const auditRecord = {
    version: 1 as const,
    requestId,
    appointmentId: input.appointmentId,
    jkNumber: input.jkNumber,
    actor: "operator@junk-king.com",
    amount: input.amount,
    currency: "USD" as const,
    environment: "sandbox" as const,
    status: "succeeded" as const,
    chargeId: "charge-test-1",
    chargeStatus: "CAPTURED",
    cardLastFour: "1111",
    intuitTid: "intuit-test-id",
    error: "",
    createdAt: "2026-08-15T12:00:00Z",
    updatedAt: "2026-08-15T12:00:00Z",
  };
  paymentStore.writeQboPaymentAuditRecord(auditRecord);
  assert.deepEqual(paymentStore.readQboPaymentAuditRecord(requestId), auditRecord);
  const auditText = fs.readFileSync(path.join(paymentStore.qboPaymentAuditDirectory(), "audit.jsonl"), "utf8");
  assert.equal(auditText.includes(input.token), false);
  await paymentStore.withQboPaymentRequestLock(requestId, async () => {
    await assert.rejects(
      paymentStore.withQboPaymentRequestLock(requestId, async () => undefined),
      paymentStore.QboPaymentRequestBusyError,
    );
  });

  store.clearQboTokenStore();
  assert.equal(fs.existsSync(store.QBO_TOKEN_STORE_FILE), false);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });

  process.stdout.write("QBO integration tests passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
