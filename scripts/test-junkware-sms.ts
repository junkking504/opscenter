import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  classifyJunkwareSms,
  extractAppointmentDates,
  junkwareSmsEventsAfter,
  recordJunkwareSms,
} from "@/lib/junkware-sms";
import { POST as receiveSms } from "@/app/api/integrations/junkware/sms/route";
import { GET as smsStatus } from "@/app/api/integrations/junkware/sms/status/route";

async function main() {
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-junkware-sms-test-"));
  process.env.JUNKWARE_SMS_STATE_FILE = path.join(tempDirectory, "state.json");
  process.env.JUNKWARE_SMS_INGEST_TOKEN = "test-ingest-token";
  process.env.JUNKWARE_SMS_REFRESH_TOKEN = "test-refresh-token";
  const webhookUrl = "https://hooks.junk-king.app/api/integrations/junkware/sms";

  try {
  const reference = new Date("2026-08-04T18:00:00.000Z");
  assert.deepEqual(
    extractAppointmentDates("New appointment booked for Aug 7, 2026", reference),
    ["2026-08-07"],
  );
  assert.deepEqual(
    extractAppointmentDates("Canceled appointment on 8/8/26; original date 2026-08-09", reference),
    ["2026-08-08", "2026-08-09"],
  );
  assert.equal(classifyJunkwareSms("Appointment canceled"), "cancellation");
  assert.equal(classifyJunkwareSms("A new appointment was booked"), "new-appointment");

  const first = recordJunkwareSms({
    messageSid: "SM-first",
    body: "New appointment booked for Aug 7, 2026; customer Jane Example",
    receivedAt: reference,
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.event?.sequence, 1);
  assert.equal(recordJunkwareSms({ messageSid: "SM-first", body: "retry" }).duplicate, true);
  const persisted = fs.readFileSync(process.env.JUNKWARE_SMS_STATE_FILE, "utf8");
  assert.equal(persisted.includes("Jane Example"), true, "message text must be available to the live feed");

  const webhookPayload = JSON.stringify({
    messageId: "message-webhook",
    text: "Appointment canceled for 08/08/2026",
    sender: "Junk King",
    receivedAt: new Date().toISOString(),
  });
  const validRequest = new Request(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.JUNKWARE_SMS_INGEST_TOKEN}`,
    },
    body: webhookPayload,
  });
  assert.equal((await receiveSms(validRequest)).status, 200);

  const invalidRequest = new Request(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer invalid",
    },
    body: webhookPayload,
  });
  assert.equal((await receiveSms(invalidRequest)).status, 401);

  const statusRequest = new Request(`${webhookUrl}/status?after=1`, {
    headers: { Authorization: `Bearer ${process.env.JUNKWARE_SMS_REFRESH_TOKEN}` },
  });
  const statusResponse = await smsStatus(statusRequest);
  assert.equal(statusResponse.status, 200);
  const statusPayload = await statusResponse.json();
  assert.equal(statusPayload.sequence, 2);
  assert.deepEqual(statusPayload.events.map((event: { appointmentDates: string[] }) => event.appointmentDates), [["2026-08-08"]]);
  assert.equal(junkwareSmsEventsAfter(0).events.length, 2);

  const unauthorizedStatus = await smsStatus(new Request(`${webhookUrl}/status`));
  assert.equal(unauthorizedStatus.status, 401);

  console.log("JunkWare SMS webhook verification passed.");
  } finally {
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
