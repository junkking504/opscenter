import assert from "node:assert/strict";

async function main() {
  process.env.JUNKWARE_APPOINTMENT_SEARCH_STUB = "1";

  const { searchJunkwareAppointments } = await import("@/lib/junkware-appointment-search");

  await assert.rejects(
    () => searchJunkwareAppointments({}),
    /at least one search field is required/i,
    "An empty query must be rejected before shelling out to JunkWare.",
  );

  await assert.rejects(
    () => searchJunkwareAppointments({ appointmentType: "9", status: "2", franchise: "1" }),
    /at least one search field is required/i,
    "Unrecognized enum values must be sanitized away, leaving no valid criterion.",
  );

  const response = await searchJunkwareAppointments({ jkNumber: "JK4063306" });
  assert.equal(response.query.jkNumber, "JK4063306");
  assert.ok(Array.isArray(response.results));
  assert.ok(response.results.length > 0, "The stub search must return at least one result.");
  assert.equal(response.results[0].jkNumber, "JK4063306");
  assert.ok(response.searchedAt, "A search timestamp must be present.");
  assert.equal(response.hasMorePages, false);

  const dateFiltered = await searchJunkwareAppointments({
    startDate: "8/1/2026",
    endDate: "8/31/2026",
    franchise: "352",
  });
  assert.equal(dateFiltered.query.startDate, "8/1/2026");
  assert.equal(dateFiltered.query.franchise, "352");

  const badDate = await searchJunkwareAppointments({ startDate: "not-a-date", jkNumber: "JK1" });
  assert.equal(badDate.query.startDate, "", "A malformed date must be sanitized to empty rather than passed through.");

  console.log("JunkWare Appointment Search verification passed.");
}

void main();
