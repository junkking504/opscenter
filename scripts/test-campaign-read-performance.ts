import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Campaign reads every SearchKings month, Podium review history and every
// day's appointments. Readings are reused between loads, so this checks that
// they stay bounded and that a changed source file is seen on the next load.
const root = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-campaign-read-"));
const data = path.join(root, "data");
const prior = { data: process.env.OPSBOT_DATA_DIR, home: process.env.HOME };
process.env.OPSBOT_DATA_DIR = data;
process.env.HOME = root;
const write = (relative: string, value: unknown) => {
  const file = path.join(data, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value));
};
const metrics = (date: string, revenue: number) => ({
  appointments: [{ appt_id: `A-${date}`, job_id: `JK-${date}`, customer_name: "Pat Reed", customer_phone: "5045550100", territory: "Nashville", revenue, job_status: "Completed", driver_name: "Alex Crew" }],
  completed_appointment_ids: [`A-${date}`],
});
const reviews = (fetchedAt: string, count: number) => ({
  version: 1, source: "podium_api", fetchedAt,
  locations: [{ uid: "loc", name: "Junk King Nashville", address: "", averageRating: 5, reviewCount: count, reviews: Array.from({ length: count }, (_, index) => ({ uid: `r${index}`, authorName: "Pat Reed", body: "Great crew", url: "", rating: 5, createdAt: "2026-10-12T15:00:00.000Z", updatedAt: "2026-10-12T15:00:00.000Z", needsResponse: false, responseCount: 0 })) }],
});

async function main() {
  write("searchkings/current.json", {
    version: 1, source: "searchkings_reports_api", fetchedAt: "2026-10-16T23:00:00.000Z", customerId: "test",
    range: { startDate: "2026-10-01", endDate: "2026-10-16", timezone: "America/Chicago" }, accounts: [],
    calls: { total: {}, callsQuality: [], calls: Array.from({ length: 200 }, (_, index) => ({ id: `call-${index}`, name: "Pat Reed", calledAtDate: "2026-10-10", calledAtTime: `${1 + (index % 12)}:${String(index % 60).padStart(2, "0")} PM`, callerNumberComplete: index ? `50455501${String(index).padStart(2, "0")}` : "5045550100", score: 5, duration: `${index}:00`, reportingTag: "Quoted $450", tagList: [] })) },
  });
  write("processed/daily_metrics_2026-10-10.json", metrics("2026-10-10", 450));
  write("processed/daily_metrics_2026-10-11.json", metrics("2026-10-11", 0));
  fs.mkdirSync(path.join(root, ".openclaw", "workspace", "opsbot"), { recursive: true });
  fs.symlinkSync(data, path.join(root, ".openclaw", "workspace", "opsbot", "data"));
  fs.mkdirSync(path.join(data, "history"), { recursive: true });
  fs.symlinkSync(path.join(data, "processed"), path.join(data, "history", "daily_metrics"));
  write("podium-google-reviews/current.json", reviews("2026-10-16T13:00:00.000Z", 3));
  for (const [day, count] of [["2026-10-14", 1], ["2026-10-15", 2], ["2026-10-16", 3]] as const) {
    write(`history/podium-google-reviews/podium-google-reviews_${day}.json`, reviews(`${day}T13:00:00.000Z`, count));
  }

  const { buildSearchKingsInquiryHistory } = await import("../lib/searchkings");
  const { buildPodiumGoogleReviewsView } = await import("../lib/podium-reviews");
  const { podiumReviewNameSuggestions } = await import("../lib/podium-review-assignments");

  // The previous Podium snapshot is the newest one fetched earlier; older days are never parsed.
  const reads: string[] = [];
  const readFileSync = fs.readFileSync;
  fs.readFileSync = ((file: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
    reads.push(String(file));
    return (readFileSync as (...args: unknown[]) => unknown)(file, ...rest);
  }) as typeof fs.readFileSync;
  const NativeFormatter = Intl.DateTimeFormat;
  let formatters = 0;
  Intl.DateTimeFormat = class extends NativeFormatter {
    constructor(...args: ConstructorParameters<typeof NativeFormatter>) { super(...args); formatters++; }
  } as typeof NativeFormatter;
  try {
    const podium = buildPodiumGoogleReviewsView();
    assert.equal(podium.previousSnapshot?.fetchedAt, "2026-10-15T13:00:00.000Z");
    assert.equal(podium.locations[0].reviewCountChange, 1);
    assert.ok(!reads.some(file => file.endsWith("podium-google-reviews_2026-10-14.json")), "older Podium history was parsed");

    const first = buildSearchKingsInquiryHistory();
    assert.equal(first.length, 200);
    assert.equal(first.find(lead => lead.phone === "5045550100")?.matchedAppointment?.revenue, 450);
    assert.ok(formatters <= 4, `SearchKings call times allocated ${formatters} date formatters`);

    reads.length = 0;
    buildSearchKingsInquiryHistory();
    assert.ok(!reads.some(file => file.includes("daily_metrics_") || file.endsWith("current.json")), "unchanged sources were parsed again");
  } finally {
    fs.readFileSync = readFileSync;
    Intl.DateTimeFormat = NativeFormatter;
  }

  // A collector rewrite is seen on the next load.
  write("processed/daily_metrics_2026-10-10.json", metrics("2026-10-10", 1250));
  assert.equal(buildSearchKingsInquiryHistory().find(lead => lead.phone === "5045550100")?.matchedAppointment?.revenue, 1250);

  const input = [{ uid: "r0", authorName: "Pat Reed", createdAt: "2026-10-12T15:00:00.000Z", locationName: "Junk King Nashville" }];
  assert.deepEqual(podiumReviewNameSuggestions(input).r0.map(candidate => candidate.appointmentId).sort(), ["A-2026-10-10", "A-2026-10-11"]);
  write("processed/daily_metrics_2026-10-12.json", metrics("2026-10-12", 300));
  assert.deepEqual(podiumReviewNameSuggestions(input).r0.map(candidate => candidate.appointmentId).sort(), ["A-2026-10-10", "A-2026-10-11", "A-2026-10-12"]);

  write("history/podium-google-reviews/podium-google-reviews_2026-10-15.json", reviews("2026-10-15T09:00:00.000Z", 1));
  assert.equal(buildPodiumGoogleReviewsView().locations[0].reviewCountChange, 2);
}

main().then(() => {
  console.log("PASS Campaign read: bounded Podium history, reused SearchKings sources, fresh after collector writes");
}).finally(() => {
  if (prior.data === undefined) delete process.env.OPSBOT_DATA_DIR; else process.env.OPSBOT_DATA_DIR = prior.data;
  process.env.HOME = prior.home;
  fs.rmSync(root, { recursive: true, force: true });
});
