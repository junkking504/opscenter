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

async function main() {
  const store = await import("../lib/qbo-token-store");
  const configModule = await import("../lib/qbo-config");
  const api = await import("../lib/qbo-api");

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

  store.clearQboTokenStore();
  assert.equal(fs.existsSync(store.QBO_TOKEN_STORE_FILE), false);
  fs.rmSync(temporaryRoot, { recursive: true, force: true });

  process.stdout.write("QBO integration tests passed.\n");
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
