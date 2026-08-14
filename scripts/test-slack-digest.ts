import assert from "node:assert/strict";
import fs from "node:fs";
import { fetchSlackDailyDigest, slackTextToPlainText } from "@/lib/slack-digest";

async function main() {
  const clientSource = fs.readFileSync(new URL("../components/SlackAlertsDigest.tsx", import.meta.url), "utf8");
  assert.match(clientSource, /const POLL_INTERVAL_MS = 15_000/);
  assert.match(clientSource, /void refresh\(\);/);
  assert.match(clientSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(clientSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);

  assert.equal(
    slackTextToPlainText(":warning: *New alert*\n<https://ops.junk-king.app/jobs|Open in OpsCenter>\n_Alert ID: test:123_"),
    "⚠️ New alert",
  );

  const requests: URL[] = [];
  const fetchImpl: typeof fetch = async (input) => {
  const url = new URL(String(input));
  requests.push(url);
  const method = url.pathname.split("/").pop();
  const channel = url.searchParams.get("channel");

  if (channel === "C_UNREADABLE") {
    return Response.json({ ok: false, error: "not_in_channel" });
  }

  if (method === "conversations.history") {
    return Response.json({
      ok: true,
      messages: [
        {
          ts: "1786718241.171329",
          text: ":truck: *Truck 3 arrived onsite.*",
          bot_profile: { name: "OpsCenter Alerts" },
          reply_count: 1,
        },
        {
          ts: "1786718500.000003",
          text: ":warning: *New same-day appointment: JK4052608*\nTest Customer · 12:00 PM - 01:00 PM · Truck# 1 · 123 Test Street\n*Next:* Confirm coverage.\n<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052608|Open in OpsCenter>\n_Alert ID: add_on:2026-08-14:appt:4039430_",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786710000.000001",
          text: "Older alert",
          bot_profile: { name: "OpsCenter Alerts" },
        },
      ],
      response_metadata: { next_cursor: "" },
    });
  }

  return Response.json({
    ok: true,
    messages: [
      { ts: "1786718241.171329", text: "root" },
      {
        ts: "1786719000.000002",
        thread_ts: "1786718241.171329",
        text: ":white_check_mark: Resolved",
        bot_profile: { name: "OpsCenter Alerts" },
      },
    ],
    response_metadata: { next_cursor: "" },
  });
  };

  const digest = await fetchSlackDailyDigest("2026-08-14", {
    token: "xoxb-test-token",
    channelIds: ["C0BPRML654N", "C0BPRML654N", "C_UNREADABLE"],
    fetchImpl,
    appointments: [{
      id: "appt:4039430",
      appointmentId: "4039430",
      jobNumber: "JK4052608",
      territory: "New Orleans",
      customerName: "Test Customer",
      phone: "(504) 555-0100",
      address: "123 Test Street",
      appointmentTime: "12:00 PM - 01:00 PM",
      appointmentType: "Appointment",
      assignedTruck: "Truck# 1",
      items: ["Sofa", "Desk"],
      href: "/jobs?date=2026-08-14#job-jk4052608",
    }],
  });

  assert.equal(digest.status, "ready");
  assert.equal(digest.messages.length, 4);
  assert.equal(digest.messages[0].text, "✅ Resolved");
  assert.equal(digest.messages[0].threadReply, true);
  assert.equal(digest.messages[1].channel, "#jobs-no");
  assert.equal(digest.messages[1].appointment?.jobNumber, "JK4052608");
  assert.equal(digest.messages[1].appointment?.phone, "(504) 555-0100");
  assert.deepEqual(digest.messages[1].appointment?.items, ["Sofa", "Desk"]);
  assert.equal(digest.messages[1].appointment?.href, "/jobs?date=2026-08-14#job-jk4052608");
  assert.doesNotMatch(digest.messages[1].text, /Alert ID|Truck# 1|Open in OpsCenter/);
  assert.equal(digest.messages[2].text, "🚚 Truck 3 arrived onsite.");
  assert.equal(digest.messages[3].text, "Older alert");
  assert.equal(requests.filter((request) => request.pathname.endsWith("conversations.history")).length, 2);
  assert.ok(requests.every((request) => request.searchParams.get("oldest") === "1786683600"));
  assert.ok(requests.every((request) => request.searchParams.has("latest")));

  console.log("Slack digest verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
