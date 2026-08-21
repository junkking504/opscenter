import assert from "node:assert/strict";
import fs from "node:fs";
import { fetchSlackDailyDigest, slackTextToPlainText } from "@/lib/slack-digest";

async function main() {
  const clientSource = fs.readFileSync(new URL("../components/SlackAlertsDigest.tsx", import.meta.url), "utf8");
  assert.match(clientSource, /const POLL_INTERVAL_MS = 15_000/);
  assert.match(clientSource, /void refresh\(\);/);
  assert.match(clientSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(clientSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(clientSource, /message\.closeout/);
  assert.match(clientSource, /Open in OpsCenter/);

  assert.equal(
    slackTextToPlainText(":warning: *New alert*\n<https://ops.junk-king.app/jobs|Open in OpsCenter>\n_Alert ID: test:123_"),
    "⚠️ New alert",
  );
  assert.equal(
    slackTextToPlainText("Latest data: 2026-08-18T203045.432Z"),
    "Latest data: 3:30 PM CT",
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
          text: "*[Truck Arrival]*\nTruck 3\n```\nJob:      JK4052666\nCustomer: Arrival Customer\nAddress:  123 Arrival Street\n```",
          bot_profile: { name: "OpsCenter Alerts" },
          reply_count: 1,
        },
        {
          ts: "1786718500.000003",
          text: "*[Add-On]*\nJK4052608\n```\nCustomer:  Test Customer\nAddress:   123 Test Street\n```\n<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052608|Open in OpsCenter>",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786718750.000004",
          text: "*[Job Closed]*\nJK4052579\n```\nTip:      $71.60\nCharged:  Card ending 9896 ($429.60)\n```",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786718800.000005",
          text: "*[Cancellation]*\nJK4052609\n```\nCustomer:  Cancelled Customer\n```\n<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052609|Open in OpsCenter>",
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
    }, {
      id: "appt:4039431",
      appointmentId: "4039431",
      jobNumber: "JK4052609",
      territory: "New Orleans",
      customerName: "Cancelled Customer",
      phone: "(504) 555-0101",
      address: "124 Test Street",
      appointmentTime: "01:00 PM - 02:00 PM",
      appointmentType: "Appointment",
      assignedTruck: "Truck# 1",
      items: [],
      href: "/jobs?date=2026-08-14#job-jk4052609",
    }],
    completedRows: [{
      appt_id: "4039401",
      job_id: "JK4052579",
      truck: "Truck# 8",
      revenue: "$358.00",
      tip: "$71.60",
      final_status: "Completed",
      closeout: {
        loadSize: "2 (1/3)",
        loadPrice: "$388.00",
        discount: "$30.00",
        tip: "$71.60",
        total: "$429.60",
        payments: [{ method: "Credit Card", detail: "***9896", amount: "$429.60" }],
      },
    }],
  });

  assert.equal(digest.status, "ready");
  assert.equal(digest.messages.length, 6);
  assert.equal(digest.messages[0].text, "✅ Resolved");
  assert.equal(digest.messages[0].threadReply, true);
  assert.equal(digest.messages[1].appointment?.title, "Cancellation");
  assert.equal(digest.messages[1].text, "⚠️ Cancellation: JK4052609\nCancelled Customer · (504) 555-0101 · 01:00 PM - 02:00 PM\n124 Test Street");
  assert.equal(digest.messages[2].closeout?.jobNumber, "JK4052579");
  assert.deepEqual(digest.messages[2].closeout?.lines, [
    "Load: 1/3 ($388.00).",
    "Discount: $30.00.",
    "Job total: $358.00.",
    "Tip: $71.60.",
    "Charged: Card ending 9896 ($429.60).",
  ]);
  assert.equal(digest.messages[2].closeout?.href, "/jobs?date=2026-08-14#job-jk4052579");
  assert.equal(digest.messages[3].channel, "#jobs-no");
  assert.equal(digest.messages[3].appointment?.jobNumber, "JK4052608");
  assert.equal(digest.messages[3].appointment?.phone, "(504) 555-0100");
  assert.deepEqual(digest.messages[3].appointment?.items, ["Sofa", "Desk"]);
  assert.equal(digest.messages[3].appointment?.href, "/jobs?date=2026-08-14#job-jk4052608");
  assert.doesNotMatch(digest.messages[3].text, /Alert ID|Truck# 1|Open in OpsCenter/);
  assert.deepEqual(digest.messages[4].truckArrival, {
    truck: "Truck 3",
    jobNumber: "JK4052666",
    customerName: "Arrival Customer",
    address: "123 Arrival Street",
  });
  assert.equal(digest.messages[4].text, "🚚 Truck 3 arrived\nJob: JK4052666\nCustomer: Arrival Customer\nAddress: 123 Arrival Street");
  assert.equal(digest.messages[5].text, "Older alert");
  assert.equal(requests.filter((request) => request.pathname.endsWith("conversations.history")).length, 2);
  assert.ok(requests.every((request) => request.searchParams.get("oldest") === "1786683600"));
  assert.ok(requests.every((request) => request.searchParams.has("latest")));

  console.log("Slack digest verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
