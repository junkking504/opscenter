import assert from "node:assert/strict";
import { employeeJobRevenueWorked } from "@/lib/opsData";

const splitCrewRow = {
  name: "Driver Example",
  individual_revenue: 200,
  truck_revenue_breakdown: [
    { job_id: "JK100", job_revenue: 300, credited_revenue: 150 },
    { job_id: "JK200", job_revenue: 500, credited_revenue: 250 },
    { job_id: "JK200", job_revenue: 500, credited_revenue: 250 },
  ],
};

assert.equal(employeeJobRevenueWorked(splitCrewRow), 800);
assert.equal(employeeJobRevenueWorked({ individual_revenue: 200 }), 0);

console.log("Crew job-value checks passed.");
