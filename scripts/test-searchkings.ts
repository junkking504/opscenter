import assert from "node:assert/strict";
import { appointmentScheduleHref } from "../lib/job-links";
import {
  buildSearchKingsViewFromData,
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
      { id: "lost", name: "Lost Caller", callerNumberComplete: "+1 225 555 0102", city: "Baton Rouge", score: 5, tagList: ["Availability objection"], trackingLabel: "Baton Rouge LSA", duration: "02:00", calledAtDate: "2026-08-01", calledAtTime: "9:00 AM" },
      { id: "unqualified", name: "Bad Caller", callerNumberComplete: "+1 504 555 0103", city: "New Orleans", score: 1, tagList: [], duration: "00:30", calledAtDate: "2026-08-02", calledAtTime: "9:00 AM" },
      { id: "recovered", name: "Recovered Caller", callerNumberComplete: "+1 225 555 0104", city: "Baton Rouge", score: 4, tagList: [], duration: "01:30", calledAtDate: "2026-08-01", calledAtTime: "8:00 AM" },
    ],
  },
};

const appointments: SearchKingsAppointmentMatch[] = [
  { date: "2026-08-02", appointmentId: "appt-1", jobId: "JK-101", customerName: "Booked Caller", phone: "5045550101", territory: "New Orleans", revenue: 600, status: "Completed" },
  { date: "2026-08-03", appointmentId: "appt-2", jobId: "JK-102", customerName: "Recovered Caller", phone: "2255550104", territory: "Baton Rouge", revenue: 400, status: "Scheduled" },
  { date: "2026-08-02", appointmentId: "average", jobId: "JK-103", customerName: "Other Customer", phone: "2255559999", territory: "Baton Rouge", revenue: 800, status: "Completed" },
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
assert.equal(view.attributedRevenue, 1000);
assert.equal(view.lostLeads, 1);
assert.equal(view.leads.find((lead) => lead.callerName === "Booked Caller")?.status, "booked");
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.status, "lost");
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.reason, "availability");
assert.equal(view.leads.find((lead) => lead.callerName === "Bad Caller")?.status, "unqualified");
assert.equal(view.leads.find((lead) => lead.callerName === "Recovered Caller")?.status, "recovered");
assert.equal(view.leads.find((lead) => lead.callerName === "Recovered Caller")?.franchiseContacted, true);
assert.equal(view.leads.find((lead) => lead.callerName === "Lost Caller")?.franchiseContacted, false);
assert.equal(view.territoryRows.find((row) => row.territory === "Baton Rouge")?.lostLeads, 1);
assert.equal(appointmentScheduleHref("2026-08-02", "JK-101"), "/jobs?date=2026-08-02#job-jk-101");

console.log("SearchKings attribution and lost-lead checks passed.");
