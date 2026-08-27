import assert from "node:assert/strict";
import fs from "node:fs";
import {
  fetchSlackDailyDigest,
  isOperationalSlackDigestMessage,
  normalizedCancellationDigestText,
  normalizedLegacyAppointmentDigestText,
  normalizedLegacyCancellationDigestText,
  normalizedLegacyCloseoutDigestText,
  normalizedLegacyPhotoDigestText,
  normalizedLegacyTruckArrivalDigestText,
  normalizedRescheduleDigestText,
  slackDigestChannelName,
  slackTextToPlainText,
} from "@/lib/slack-digest";

async function main() {
  const clientSource = fs.readFileSync(new URL("../components/SlackAlertsDigest.tsx", import.meta.url), "utf8");
  assert.match(clientSource, /const POLL_INTERVAL_MS = 15_000/);
  assert.match(clientSource, /void refresh\(\);/);
  assert.match(clientSource, /window\.addEventListener\("focus", refreshWhenVisible\)/);
  assert.match(clientSource, /document\.addEventListener\("visibilitychange", refreshWhenVisible\)/);
  assert.match(clientSource, /function renderSlackInline/);
  assert.match(clientSource, /message\.rawText/);
  assert.match(clientSource, /tel:/);
  assert.doesNotMatch(clientSource, /message\.closeout/);

  assert.equal(
    slackTextToPlainText(":warning: *New alert*\n<https://ops.junk-king.app/jobs|Open in OpsCenter>\n_Alert ID: test:123_"),
    "⚠️ New alert",
  );
  assert.equal(slackTextToPlainText(":wastebasket: *Dump receipt recorded*"), "🗑️ Dump receipt recorded");
  assert.equal(isOperationalSlackDigestMessage({ subtype: "channel_name", text: "renamed a channel" }), false);
  assert.equal(isOperationalSlackDigestMessage({ text: "Taylor renamed the channel" }), false);
  assert.equal(isOperationalSlackDigestMessage({ text: ":warning: Route needs attention" }), true);
  assert.equal(slackDigestChannelName("C0BNMDJNYV9"), "#command");
  assert.equal(slackDigestChannelName("C0BNRMD25AS"), "#dispatch");
  assert.equal(slackDigestChannelName("C0BNVJR6HMX"), "#finance");
  assert.equal(slackDigestChannelName("C0BPN1FVCDN"), "#data");
  assert.equal(slackDigestChannelName("C0BPRML654N"), "#new-orleans");
  assert.equal(slackDigestChannelName("C0BPQ30C8LD"), "#baton-rouge");
  assert.equal(slackDigestChannelName("C0BPC9M5GLX"), "#northshore");
  assert.equal(
    normalizedCancellationDigestText(
      ":x: *Cancellation*\n*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4058562|JK4058562>*\n02:00 PM - 03:00 PM\nDaniela Ortiz 8004215354x2071 400 Russell Ave New Orleans, LA 70143 Cancelled via email per accounts request Followup\n*Reason:* Daniela Ortiz 8004215354x2071 400 Russell Ave New Orleans, LA 70143 Cancelled via email per accounts request Followup",
      "2026-08-25",
    ),
    [
      ":x: *Cancellation*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4058562|JK4058562>*",
      "02:00 PM - 03:00 PM",
      "Daniela Ortiz",
      "<tel:+18004215354;ext=2071|(800) 421-5354 x2071>",
      "400 Russell Ave New Orleans, LA 70143",
      "*Reason:* Cancelled via email per accounts request Followup",
    ].join("\n"),
  );
  const rescheduleAppointments = new Map([[
    "job:jk4065604",
    {
      id: "appt:4052426",
      appointmentId: "4052426",
      jobNumber: "JK4065604",
      territory: "Baton Rouge",
      customerName: "Reinel Benitez",
      phone: "(504) 372-9604",
      address: "321 Burgess Pl Baton Rouge, LA 70815",
      appointmentTime: "12:00 PM - 01:00 PM",
      appointmentType: "Job",
      assignedTruck: "Truck# 6",
      items: [],
      href: "/jobs?date=2026-08-25#job-jk4065604",
    },
  ]]);
  assert.equal(
    normalizedRescheduleDigestText(
      ":warning: *JK4065604 rescheduled*\nPrevious: 12:00 PM - 01:00 PM\nNew: 12:00 PM - 01:00 PM\nTruck: Truck# 6\n*Next:* Update the route plan.\n<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|Open in OpsCenter>",
      rescheduleAppointments,
    ),
    [
      ":warning: *Rescheduled*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>*",
      "Previous: 12:00 PM - 01:00 PM",
      "New: 12:00 PM - 01:00 PM",
      "*Reinel Benitez*",
      "<tel:+15043729604|(504) 372-9604>",
      "321 Burgess Pl Baton Rouge, LA 70815",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyAppointmentDigestText(
      ":warning: *New same-day appointment*\n<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>\nLegacy appointment",
      rescheduleAppointments,
      "2026-08-25",
    ),
    [
      ":warning: *New Appointment*",
      "<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>",
      "12:00 PM - 01:00 PM",
      "*Reinel Benitez*",
      "<tel:+15043729604|(504) 372-9604>",
      "321 Burgess Pl Baton Rouge, LA 70815",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyCancellationDigestText(
      ":warning: *Appointment cancelled:*\nJob: JK4065604\nReason: Customer changed plans",
      rescheduleAppointments,
      "2026-08-25",
    ),
    [
      ":x: *Cancellation*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>*",
      "12:00 PM - 01:00 PM",
      "Reinel Benitez",
      "<tel:+15043729604|(504) 372-9604>",
      "321 Burgess Pl Baton Rouge, LA 70815",
      "*Reason:* Customer changed plans",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyTruckArrivalDigestText(
      ":truck: Truck 6 On-site\n<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>\n11:05 AM\nTakiya Bennett\n<tel:(225)436-5071|(225) 436-5071>\n19414 Creekround Ave, Baton Rouge, 70817",
      rescheduleAppointments,
      "2026-08-25",
    ),
    [
      ":truck: *Truck 6 On-site*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>*",
      "11:05 AM",
      "Reinel Benitez",
      "<tel:+15043729604|(504) 372-9604>",
      "321 Burgess Pl Baton Rouge, LA 70815",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyPhotoDigestText(
      ":camera_with_flash: *Job photos verified*\nJob: JK4065604\nPhotos: 3 photos · 3 after\nVerified in JunkWare",
      "2026-08-25",
    ),
    [
      ":camera_with_flash: *Photos Uploaded*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-25#job-jk4065604|JK4065604>*",
      "3 photos",
      "Verified",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyCloseoutDigestText(
      ":white_check_mark: *JK4052579 closed out.*",
      new Map([["jk4052579", {
        appt_id: "4039401",
        job_id: "JK4052579",
        customer_name: "Legacy Customer",
        driver_normalized_name: "Legacy Driver",
        navigator_normalized_name: "Legacy Navigator",
        revenue: "$358.00",
        tip: "$71.60",
        closeout: {
          loadSize: "2 (1/3)",
          loadPrice: "$388.00",
          discount: "$30.00",
          tip: "$71.60",
          payments: [{ method: "Credit Card", detail: "***9896", amount: "$429.60" }],
        },
      }]]),
      "2026-08-14",
    ),
    [
      ":moneybag: *Job Closed*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052579|JK4052579>*",
      "*Legacy Customer*",
      "*Driver:* Legacy Driver",
      "*Navigator:* Legacy Navigator",
      "*Load:* $388.00 (1/3)",
      "*Discount:* $30.00",
      "*Tips:* $71.60",
      "*Total:* $358.00",
      "*Card Ending:* 9896",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyCloseoutDigestText(
      ":white_check_mark: *Job Closed*\n*Job:* <https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052999|JK4052999>",
      new Map(),
      "2026-08-14",
    ),
    [
      ":moneybag: *Job Closed*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052999|JK4052999>*",
      "*Driver:*",
      "*Navigator:*",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyCloseoutDigestText(
      ":moneybag: *Estimate Closed*\n*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4053000|JK4053000>*",
      new Map([["jk4053000", {
        appt_id: "4039402",
        job_id: "JK4053000",
        appointment_type: "Estimate",
        customer_name: "Closed Estimate Customer",
        driver_normalized_name: "Estimate Driver",
        navigator_normalized_name: "Estimate Navigator",
        revenue: "$180.00",
        closeout: {
          loadSize: "1 (1/4)",
          loadPrice: "$180.00",
          tip: "",
          total: "$180.00",
          payments: [],
        },
      }]]),
      "2026-08-14",
    ),
    [
      ":moneybag: *Estimate Closed*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4053000|JK4053000>*",
      "*Closed Estimate Customer*",
      "*Driver:* Estimate Driver",
      "*Navigator:* Estimate Navigator",
      "*Load:* $180.00 (1/4)",
      "*Tips:*",
      "*Total:* $180.00",
    ].join("\n"),
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
          text: ":warning: *New Appointment*\n<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052608|JK4052608>\n12:00 PM - 01:00 PM\n*Test Customer*\n(504) 555-0100\n123 Test Street",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786718750.000004",
          text: ":white_check_mark: *Job Closed*\n*Job:* <https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052579|JK4052579>",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786718800.000005",
          text: ":x: *Cancellation*\n*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052608|JK4052608>*\n12:00 PM - 01:00 PM\n*Test Customer*\n(504) 555-0100\n123 Test Street\n*Reason:* Customer cancelled",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786710000.000001",
          text: "Older alert",
          bot_profile: { name: "OpsCenter Alerts" },
        },
        {
          ts: "1786719100.000006",
          subtype: "channel_name",
          text: "Taylor renamed the channel from ops to command",
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
    completedRows: [{
      appt_id: "4039401",
      job_id: "JK4052579",
      truck: "Truck# 8",
      customer_name: "Legacy Customer",
      driver_normalized_name: "Legacy Driver",
      navigator_normalized_name: "Legacy Navigator",
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
  assert.equal(digest.filteredSystemMessages, 1);
  assert.equal(digest.messages[0].text, "✅ Resolved");
  assert.equal(digest.messages[0].threadReply, true);
  assert.equal(digest.messages[1].appointment?.title, "Cancellation");
  assert.equal(digest.messages[1].appointment?.jobNumber, "JK4052608");
  assert.match(digest.messages[1].rawText, /^:x: \*Cancellation\*/);
  assert.equal(digest.messages[2].closeout?.jobNumber, "JK4052579");
  assert.deepEqual(digest.messages[2].closeout?.lines, [
    "Load: $388.00 (1/3).",
    "Discount: $30.00.",
    "Tips: $71.60.",
    "Total: $358.00.",
    "Card Ending: 9896.",
  ]);
  assert.equal(digest.messages[2].closeout?.href, "/jobs?date=2026-08-14#job-jk4052579");
  assert.equal(digest.messages[3].channel, "#new-orleans");
  assert.equal(digest.messages[3].appointment?.jobNumber, "JK4052608");
  assert.equal(digest.messages[3].appointment?.phone, "(504) 555-0100");
  assert.deepEqual(digest.messages[3].appointment?.items, ["Sofa", "Desk"]);
  assert.equal(digest.messages[3].appointment?.href, "/jobs?date=2026-08-14#job-jk4052608");
  assert.match(digest.messages[3].rawText, /^:warning: \*New Appointment\*/);
  assert.doesNotMatch(digest.messages[3].text, /Alert ID|Truck# 1|Open in OpsCenter/);
  assert.equal(digest.messages[4].text, "🚚 Truck 3 arrived onsite.");
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
