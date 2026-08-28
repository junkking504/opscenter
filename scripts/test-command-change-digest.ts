import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyCommandChange,
  summarizeCommandChanges,
} from "@/lib/command-change-digest";
import type { SlackDigestMessage } from "@/lib/slack-digest";

function message(
  id: string,
  timestamp: string,
  text: string,
  extra: Partial<SlackDigestMessage> = {},
): SlackDigestMessage {
  return {
    id,
    timestamp,
    channel: "#command",
    rawText: text,
    text,
    threadReply: false,
    ...extra,
  };
}

const newJob = message("new-job", "2026-08-28T14:15:00.000Z", ":warning: *New Appointment*", {
  appointment: {
    title: "New Appointment",
    jobNumber: "JK4000001",
    customerName: "Test Customer",
    phone: "(504) 555-0100",
    appointmentTime: "10:00 AM - 11:00 AM",
    address: "123 Test Street",
    items: [],
    href: "/jobs?date=2026-08-28#job-jk4000001",
    nextAction: "",
  },
});
const exception = message("exception", "2026-08-28T14:20:00.000Z", ":warning: Route needs attention");
const completed = message("completed", "2026-08-28T14:25:00.000Z", ":moneybag: *Job Closed*", {
  closeout: {
    jobNumber: "JK4000002",
    lines: ["Total: $500.00."],
    href: "/jobs?date=2026-08-28#job-jk4000002",
  },
});
const routine = message("routine", "2026-08-28T14:30:00.000Z", ":truck: Truck 3 arrived onsite.");

assert.equal(classifyCommandChange(newJob), "new-job");
assert.equal(classifyCommandChange(exception), "exception");
assert.equal(classifyCommandChange(completed), "completed");
assert.equal(classifyCommandChange(routine), null);

const all = summarizeCommandChanges([routine, completed, exception, newJob], null);
assert.deepEqual(all["new-job"].map((item) => item.id), ["new-job"]);
assert.deepEqual(all.exception.map((item) => item.id), ["exception"]);
assert.deepEqual(all.completed.map((item) => item.id), ["completed"]);

const since = summarizeCommandChanges(
  [routine, completed, exception, newJob],
  "2026-08-28T14:20:00.000Z",
);
assert.equal(since["new-job"].length, 0);
assert.equal(since.exception.length, 0, "the baseline itself is already reviewed");
assert.deepEqual(since.completed.map((item) => item.id), ["completed"]);

const componentSource = fs.readFileSync(new URL("../components/SlackAlertsDigest.tsx", import.meta.url), "utf8");
assert.match(componentSource, /opscenter:command:last-looked:v1/);
assert.match(componentSource, /Today so far on this browser/);
assert.match(componentSource, /Mark reviewed/);
assert.match(componentSource, /aria-pressed=/);
assert.match(componentSource, /window\.addEventListener\("pagehide", recordDeparture\)/);
assert.match(componentSource, /document\.addEventListener\("visibilitychange", recordWhenHidden\)/);
assert.match(componentSource, /Show all alerts/);

console.log("Command change digest verification passed.");
