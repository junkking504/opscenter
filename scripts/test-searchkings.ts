import assert from "node:assert/strict";
import { appointmentScheduleHref } from "../lib/job-links";
import { formatSearchKingsDateHeading, groupSearchKingsLeadsByDate } from "../lib/searchkings-date-groups";
import {
  buildSearchKingsCallBrowser,
  normalizeSearchKingsCallFilter,
  normalizeSearchKingsCallRange,
} from "../lib/searchkings-call-browser";
import { searchKingsPhoneHref } from "../lib/searchkings-phone";
import {
  buildSearchKingsViewFromData,
  explicitCallValue,
  type LostLeadOverride,
  type SearchKingsAppointmentMatch,
  type SearchKingsSnapshot,
} from "../lib/searchkings";

const metrics = (cost: number, conversions: number) => [
  { id: 1, order: 1, label: "Cost", value: cost, type: "currency" },
  { id: 2, order: 2, label: "Conversions", value: conversions, type: "number" },
  { id: 3, order: 3, label: "Cost Per Conversion", value: cost / conversions, type: "currency" },
];

const snapshot: SearchKingsSnapshot = {
  version: 1,
  source: "searchkings_reports_api",
  fetchedAt: "2026-08-03T12:00:00.000Z",
  customerId: "SKC1002034843",
  range: { startDate: "2026-08-01", endDate: "2026-08-03", timezone: "America/Chicago" },
  accounts: [
    { id: "a", name: "Baton Rouge LSA", type: "lsa", metrics: metrics(300, 10) },
    { id: "b", name: "NOLA Google Ads", type: "google_ads", metrics: metrics(200, 5) },
  ],
  calls: {
    total: { currentCalls: 4, currentScoredCalls: 4 },
    callsQuality: [],
    calls: [
      { id: "booked", name: "Booked Caller", callerNumberComplete: "+1 504 555 0101", city: "New Orleans", score: 4, tagList: [], reportingTag: "Asked about a same-day pickup.", trackingLabel: "NOLA", duration: "03:20", calledAtDate: "2026-08-01", calledAtTime: "10:00 AM" },
      { id: "lost", name: "Lost Caller", callerNumberComplete: "+1 225 555 0102", city: "Baton Rouge", score: 5, tagList: ["Availability objection"], reportingTag: "Agent quoted $250; customer declined.", trackingLabel: "Baton Rouge LSA", duration: "02:00", calledAtDate: "2026-08-01", calledAtTime: "9:00 AM" },
      { id: "unqualified", name: "Bad Caller", callerNumberComplete: "+1 504 555 0103", city: "New Orleans", score: 1, tagList: [], duration: "00:30", calledAtDate: "2026-08-02", calledAtTime: "9:00 AM" },
      { id: "recovered", name: "Recovered Caller", callerNumberComplete: "+1 225 555 0104", city: "Baton Rouge", score: 4, tagList: [], duration: "01:30", calledAtDate: "2026-08-01", calledAtTime: "8:00 AM" },
    ],
  },
};

const appointments: SearchKingsAppointmentMatch[] = [
  { date: "2026-08-02", appointmentId: "appt-1", jobId: "JK-101", customerName: "Booked Caller", phone: "5045550101", territory: "New Orleans", revenue: 600, completed: true, status: "Completed" },
  { date: "2026-08-03", appointmentId: "appt-1", jobId: "JK-101", customerName: "Booked Caller", phone: "5045550101", territory: "New Orleans", revenue: 99999, completed: true, status: "Completed" },
  { date: "2026-08-03", appointmentId: "appt-2", jobId: "JK-102", customerName: "Recovered Caller", phone: "2255550104", territory: "Baton Rouge", revenue: null, completed: false, status: "Scheduled" },
  { date: "2026-08-02", appointmentId: "average", jobId: "JK-103", customerName: "Other Customer", phone: "2255559999", territory: "Baton Rouge", revenue: 800, completed: true, status: "Completed" },
];

const overrides: LostLeadOverride[] = [{
  callId: "recovered",
  status: "lost",
  reason: "no_follow_up",
  note: "Originally lost, then booked.",
  franchiseContacted: true,
  updatedAt: "2026-08-02T12:00:00.000Z",
  updatedBy: "manager@junk-king.com",
}];

const view = buildSearchKingsViewFromData(snapshot, appointments, overrides, new Date("2026-08-05T18:00:00.000Z"));

assert.equal(view.spend, 500);
assert.equal(view.platformConversions, 15);
assert.equal(view.qualifiedCalls, 3);
assert.equal(view.bookedJobs, 2);
assert.equal(view.attributedRevenue, 600);
assert.equal(view.lostLeads, 1);
assert.equal(view.valuedLostLeads, 1);
assert.equal(view.estimatedLostRevenue, 250);
assert.equal(view.leads.find((lead) => lead.callerName === "Booked Caller")?.status, "booked");
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.status, "lost");
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.reason, "availability");
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.potentialRevenue, 250);
assert.equal(view.leads.find((lead) => lead.callerName === "Booked Caller")?.potentialRevenue, null);
assert.equal(view.leads.find((lead) => lead.callerName === "Bad Caller")?.status, "unqualified");
assert.equal(view.leads.find((lead) => lead.callerName === "Recovered Caller")?.status, "recovered");
assert.equal(view.leads.find((lead) => lead.callerName === "Recovered Caller")?.franchiseContacted, true);
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.franchiseContacted, false);
assert.equal(view.territoryRows.find((row) => row.territory === "Baton Rouge")?.lostLeads, 1);

const duplicateBookingSnapshot: SearchKingsSnapshot = {
  ...snapshot,
  calls: {
    ...snapshot.calls,
    total: { currentCalls: 2, currentScoredCalls: 2 },
    calls: [
      snapshot.calls.calls[0],
      { ...snapshot.calls.calls[0], id: "booked-again", calledAtTime: "10:30 AM" },
    ],
  },
};
const duplicateBookingView = buildSearchKingsViewFromData(duplicateBookingSnapshot, appointments, [], new Date("2026-08-01T20:00:00.000Z"));
assert.equal(duplicateBookingView.bookedJobs, 1);
assert.equal(duplicateBookingView.attributedRevenue, 600);
assert.equal(appointmentScheduleHref("2026-08-02", "JK-101"), "/jobs?date=2026-08-02#job-jk-101");

const callGroups = groupSearchKingsLeadsByDate(view.leads);
assert.deepEqual(callGroups.map((group) => [group.dateKey, group.leads.length]), [
  ["2026-08-02", 1],
  ["2026-08-01", 3],
]);
assert.equal(formatSearchKingsDateHeading("2026-08-02"), "Sunday, August 2, 2026");
assert.equal(formatSearchKingsDateHeading("unknown"), "Unknown date");

const latestCalls = buildSearchKingsCallBrowser(view.leads);
assert.equal(latestCalls.range, "latest");
assert.deepEqual(latestCalls.groups.map((group) => group.dateKey), ["2026-08-02"]);
assert.equal(latestCalls.totalInRange, 1);

const searchedCalls = buildSearchKingsCallBrowser(view.leads, { range: "all", query: "Baton Rouge" });
assert.equal(searchedCalls.matchCount, 2);
assert.ok(searchedCalls.groups.every((group) => group.leads.every((lead) => lead.territory === "Baton Rouge")));

const quotedLostCalls = buildSearchKingsCallBrowser(view.leads, { range: "all", filter: "quoted_lost" });
assert.equal(quotedLostCalls.matchCount, 1);
assert.equal(quotedLostCalls.groups[0]?.leads[0]?.callerName, "Lost Caller");

const completedRevenueCalls = buildSearchKingsCallBrowser(view.leads, { range: "all", filter: "completed_revenue" });
assert.equal(completedRevenueCalls.matchCount, 1);
assert.equal(completedRevenueCalls.groups[0]?.leads[0]?.callerName, "Booked Caller");

const matchedBookingCalls = buildSearchKingsCallBrowser(view.leads, { range: "all", filter: "matched_booking" });
assert.equal(matchedBookingCalls.matchCount, 2);

const qualifiedCalls = buildSearchKingsCallBrowser(view.leads, { range: "all", filter: "qualified" });
assert.equal(qualifiedCalls.matchCount, 3);

const pagedCalls = buildSearchKingsCallBrowser(view.leads, { range: "all", page: 2, pageSize: 2 });
assert.equal(pagedCalls.page, 2);
assert.equal(pagedCalls.firstResult, 3);
assert.equal(pagedCalls.lastResult, 4);
assert.equal(pagedCalls.groups.flatMap((group) => group.leads).length, 2);
assert.equal(normalizeSearchKingsCallRange("unexpected"), "latest");
assert.equal(normalizeSearchKingsCallFilter("unexpected"), "all");

assert.equal(explicitCallValue("King-size mattress pickup quoted $128."), 128);
assert.equal(explicitCallValue("Agent quoted $448, discounted to $388."), 388);
assert.equal(explicitCallValue("Agent quoted $128; caller had a $79 offer elsewhere."), 128);
assert.equal(searchKingsPhoneHref("(504) 555-0101"), "tel:+15045550101");
assert.equal(searchKingsPhoneHref("Unavailable"), "");
assert.equal(explicitCallValue("Agent provided $200 starting price."), 200);
assert.equal(explicitCallValue("Free on-site estimate scheduled between 12 PM and 2 PM."), null);
assert.equal(explicitCallValue("Quote requested outside the 25-mile service area."), null);
assert.equal(explicitCallValue("Agent quoted $128 or $158 depending on volume."), null);

console.log("SearchKings attribution and lost-lead checks passed.");
