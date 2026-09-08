import assert from "node:assert/strict";
import fs from "node:fs";
import { toOperationalAlert } from "@/lib/operational-alert-presentation";
import { slackAlertCardPresentation } from "@/lib/slack-alert-card";
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
  assert.match(clientSource, /slackAlertCardPresentation\(message\)/);
  const cssSource = fs.readFileSync(new URL("../components/CommandBrief.module.css", import.meta.url), "utf8");
  assert.match(cssSource, /\.newAppointmentMessage\s*\{\s*background-color:\s*rgba\(250, 204, 21, 0\.25\)/);
  assert.match(cssSource, /\.cancellationMessage\s*\{\s*background-color:\s*rgba\(239, 68, 68, 0\.25\)/);
  assert.match(cssSource, /\.completedMessage\s*\{\s*background-color:\s*rgba\(34, 197, 94, 0\.25\)/);

  const newAppointmentCard = slackAlertCardPresentation({
    id: "new",
    timestamp: "2026-09-08T13:00:00.000Z",
    channel: "#new-orleans",
    rawText: ":warning: *New Appointment*\n<https://ops.junk-king.app/jobs?date=2026-09-08#job-jk4080609|JK4080609>\n01:00 PM - 02:00 PM\n*Jeremy Cannell*\n<tel:+19852013122|(985) 201-3122>",
    text: "New Appointment",
    threadReply: false,
    appointment: {
      title: "New Appointment",
      jobNumber: "JK4080609",
      territory: "New Orleans",
      customerName: "Jeremy Cannell",
      phone: "(985) 201-3122",
      appointmentTime: "01:00 PM - 02:00 PM",
      address: "7831 Plum St New Orleans, LA 70118",
      items: [],
      href: "/jobs?date=2026-09-08#job-jk4080609",
      nextAction: "",
    },
  });
  assert.deepEqual(newAppointmentCard && {
    kind: newAppointmentCard.kind,
    label: newAppointmentCard.label,
    territory: newAppointmentCard.territory,
    territoryTone: newAppointmentCard.territoryTone,
    jobNumber: newAppointmentCard.jobNumber,
    href: newAppointmentCard.href,
    timeSlot: newAppointmentCard.timeSlot,
    bodyLines: newAppointmentCard.bodyLines,
  }, {
    kind: "new-appointment",
    label: "New Appointment",
    territory: "New Orleans",
    territoryTone: "new-orleans",
    jobNumber: "JK4080609",
    href: "/jobs?date=2026-09-08#job-jk4080609",
    timeSlot: "01:00 PM - 02:00 PM",
    bodyLines: ["*Jeremy Cannell*", "<tel:+19852013122|(985) 201-3122>"],
  });

  const cancellationCard = slackAlertCardPresentation({
    id: "cancelled",
    timestamp: "2026-09-08T14:00:00.000Z",
    channel: "#northshore",
    rawText: ":x: *Cancellation*\n*<https://ops.junk-king.app/jobs?date=2026-09-08#job-jk4080611|JK4080611>*\n09:00 AM - 10:00 AM\nJoan Coffenverg\n*Reason:* Customer no longer needs service",
    text: "Cancellation",
    threadReply: false,
    appointment: {
      title: "Cancellation",
      jobNumber: "JK4080611",
      territory: "Northshore",
      customerName: "Joan Coffenverg",
      phone: "(480) 299-1867",
      appointmentTime: "09:00 AM - 10:00 AM",
      address: "320 De Zaire Dr Madisonville, LA 70447",
      items: [],
      href: "/jobs?date=2026-09-08#job-jk4080611",
      nextAction: "",
    },
  });
  assert.equal(cancellationCard?.kind, "cancellation");
  assert.equal(cancellationCard?.territoryTone, "northshore");
  assert.deepEqual(cancellationCard?.bodyLines, ["Joan Coffenverg", "*Reason:* Customer no longer needs service"]);

  const completedCard = slackAlertCardPresentation({
    id: "closed",
    timestamp: "2026-09-08T20:00:00.000Z",
    channel: "#truck-9",
    rawText: ":moneybag: *Job Closed*\n*<https://ops.junk-king.app/jobs?date=2026-09-08#job-jk4080610|JK4080610>*\n*Customer Name*\n*Total:* $248.00",
    text: "Job Closed",
    threadReply: false,
    closeout: {
      jobNumber: "JK4080610",
      territory: "Baton Rouge",
      appointmentTime: "03:00 PM - 04:00 PM",
      lines: ["Customer Name", "Total: $248.00"],
      href: "/jobs?date=2026-09-08#job-jk4080610",
    },
  });
  assert.equal(completedCard?.kind, "completed");
  assert.equal(completedCard?.label, "Job Completed");
  assert.equal(completedCard?.territoryTone, "baton-rouge");
  assert.deepEqual(completedCard?.bodyLines, ["*Customer Name*", "*Total:* $248.00"]);

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
      ":moneybag: *Job Completed*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052579|JK4052579>*",
      "*Legacy Customer*",
      "*Driver:* Legacy Driver",
      "*Navigator:* Legacy Navigator",
      "*Load:* $388.00 (1/3)",
      "*Discount:* $30.00",
      "*Tips:* $71.60",
      "*Total:* $358.00",
      "*Card Ending:* 9896",
        "*On-site time:* Unavailable · no confirmed visit",
      "*Payment:* Card ending 9896 ($429.60)",
      "*Card verification:* Awaiting QuickBooks verification",
    ].join("\n"),
  );
  assert.equal(
    normalizedLegacyCloseoutDigestText(
      ":white_check_mark: *Job Closed*\n*Job:* <https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4052999|JK4052999>",
      new Map(),
      "2026-08-14",
    ),
    [
      ":moneybag: *Job Completed*",
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
      ":moneybag: *Estimate Completed*",
      "*<https://ops.junk-king.app/jobs?date=2026-08-14#job-jk4053000|JK4053000>*",
      "*Closed Estimate Customer*",
      "*Driver:* Estimate Driver",
      "*Navigator:* Estimate Navigator",
      "*Load:* $180.00 (1/4)",
      "*Tips:*",
      "*Total:* $180.00",
      "*On-site time:* Unavailable · no confirmed visit",
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
      photos: [{ url: "https://junkware.junk-king.com/system/aspnet/local/media/test-before.jpg", category: "Before", fileName: "test-before.jpg" }],
      href: "/jobs?date=2026-08-14#job-jk4052608",
    }],
    completedRows: [{
      appt_id: "4039401",
      job_id: "JK4052579",
      truck: "Truck# 8",
      customer_name: "Legacy Customer",
      normalized_territory: "Baton Rouge",
      appointment_time: "03:00 PM - 04:00 PM",
      driver_normalized_name: "Legacy Driver",
      navigator_normalized_name: "Legacy Navigator",
      revenue: "$358.00",
      tip: "$71.60",
      final_status: "Completed",
      photos: [
        { url: "https://junkware.junk-king.com/system/aspnet/local/media/test-after.jpg", category: "After" },
        { url: "https://example.com/untrusted.jpg" },
        { url: "javascript:alert(1)" },
      ],
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
  assert.equal(digest.messages[2].closeout?.territory, "Baton Rouge");
  assert.equal(digest.messages[2].closeout?.appointmentTime, "03:00 PM - 04:00 PM");
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
  assert.equal(digest.messages[3].appointment?.territory, "New Orleans");
  assert.equal(toOperationalAlert(digest.messages[3]).territory, "New Orleans");
  assert.equal(toOperationalAlert(digest.messages[3]).facts.filter(fact => /^items$/i.test(fact.label)).length, 1, "Do not repeat Items from the source and Slack message");
  assert.equal(toOperationalAlert({ ...digest.messages[3], appointment: { ...digest.messages[3].appointment!, territory: "Jefferson Parish" } }).territory, "Jefferson Parish", "Source territory takes precedence over routing channel");
  assert.equal(toOperationalAlert({ ...digest.messages[3], appointment: { ...digest.messages[3].appointment!, territory: "Unknown territory" } }).territory, "New Orleans");
  assert.equal(toOperationalAlert(digest.messages[1]).territory, undefined, "Cancellation keeps its own heading");
  assert.equal(digest.messages[3].photos?.length, 1);
  assert.equal(digest.messages[2].photos?.length, 1, "Only trusted job media is exposed");
  assert.equal(toOperationalAlert(digest.messages[2]).photos?.[0].category, "After");
  assert.equal(toOperationalAlert(digest.messages[3]).photos, undefined, "New appointment alerts do not repeat closeout photos");
  assert.equal(toOperationalAlert(digest.messages[1]).photos, undefined, "Cancellation alerts do not show photos");
  const unmatchedAppointment = { ...digest.messages[3], appointment: undefined };
  assert.equal(toOperationalAlert(unmatchedAppointment).territory, "New Orleans", "Channel fallback when source record is unavailable");
  assert.equal(toOperationalAlert({ ...unmatchedAppointment, channel: "#dispatch" }).territory, "Territory unavailable");
  assert.equal(digest.messages[3].appointment?.href, "/jobs?date=2026-08-14#job-jk4052608");
  assert.match(digest.messages[3].rawText, /^:warning: \*New Appointment\*/);
  assert.doesNotMatch(digest.messages[3].text, /Alert ID|Truck# 1|Open in OpsCenter/);
  assert.equal(digest.messages[4].text, "🚚 Truck 3 arrived onsite.");
  assert.equal(digest.messages[5].text, "Older alert");
  assert.equal(requests.filter((request) => request.pathname.endsWith("conversations.history")).length, 2);
  assert.ok(requests.every((request) => request.searchParams.get("oldest") === "1786683600"));
  assert.ok(requests.every((request) => request.searchParams.has("latest")));

  const photoDigest = await fetchSlackDailyDigest("2026-08-14", {
    token: "xoxb-test-token", channelIds: ["C0BQNEV0GFJ"], appointments: [],
    completedRows: [{ job_id: "JK4000001", photos: [
      { url: "https://junkware.junk-king.com/system/aspnet/local/media/upload-after.jpg", category: "After" },
      { url: "https://junkware.junk-king.com/system/aspnet/local/media/upload-after.jpg", category: "After" },
    ] }],
    fetchImpl: (async () => Response.json({ ok: true, messages: [
      { ts: "1786719000.000003", text: ":camera_with_flash: *Photos Uploaded*\nJK4000001\n1 photo\nVerified" },
      { ts: "1786719001.000004", text: ":camera_with_flash: *Photos Uploaded*\nJK4000002\n1 photo\nPending" },
    ] })) as typeof fetch,
  });
  assert.equal(photoDigest.messages[0].photos?.length, 0, "Never attach another job's photos");
  assert.equal(photoDigest.messages[1].photos?.length, 1, "Photo alerts display current job media without duplicate URLs");
  assert.equal(toOperationalAlert(photoDigest.messages[1]).label, "Photos Uploaded");
  assert.equal(toOperationalAlert(photoDigest.messages[1]).photos, undefined, "Upload notices do not repeat the photos shown on Job Closed");
  for (const rawText of ["Payment recorded\nJK4000001\nPayment: Cash ($100.00)", "Truck 4 On-site\nJK4000001\n8:26 AM"]) {
    assert.equal(toOperationalAlert({ ...photoDigest.messages[1], rawText }).photos, undefined, "Pre-closeout alerts do not show photos");
  }

  const estimateClosed = toOperationalAlert({ ...photoDigest.messages[1], rawText: "Estimate Closed\nJK4000001" });
  assert.equal(estimateClosed.label, "Estimate Completed");
  assert.equal(estimateClosed.photos?.length, 1, "Closed estimates show their matched appointment photos");
  assert.equal(estimateClosed.photos?.[0].category, "After");
  console.log("Slack digest verification passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
