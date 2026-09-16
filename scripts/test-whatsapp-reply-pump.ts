import assert from "node:assert/strict";
import { startWhatsAppReplyPump } from "../lib/whatsapp-reply-pump";

async function main() {
  let release!: () => void;
  const slowDelivery = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const deliveryStarted = new Promise<void>(resolve => { started = resolve; });
  let attempts = 0;
  let active = 0;
  let peak = 0;
  const errors: unknown[] = [];
  const pump = startWhatsAppReplyPump(async () => {
    attempts += 1;
    active += 1;
    peak = Math.max(peak, active);
    started();
    try { await slowDelivery; } finally { active -= 1; }
  }, error => errors.push(error), 5);
  try {
    // The timer services receipts without waiting for the photo/expense work
    // loop. A slow outbound request must not create concurrent outbox drains.
    await deliveryStarted;
    const first = pump.flush();
    assert.equal(pump.flush(), first);
    assert.equal(attempts, 1);
    release();
    await first;
  } finally { await pump.stop(); }
  assert.equal(peak, 1);
  assert.equal(errors.length, 0);

  let fail = true;
  const recovery = startWhatsAppReplyPump(async () => {
    if (fail) throw new Error("isolated provider failure");
  }, error => errors.push(error), 60_000);
  await recovery.flush();
  fail = false;
  await recovery.flush();
  await recovery.stop();
  assert.equal(errors.length, 1, "a failed flush must release its single-flight lock");
  console.log("WhatsApp reply scheduling verified");
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
