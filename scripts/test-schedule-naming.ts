import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const navItems = source("../components/navItems.ts");
const opsNav = source("../components/OpsNav.tsx");
const jobsPage = source("../app/(protected)/jobs/page.tsx");
const jobsMap = source("../components/JobsMap.tsx");
const routePlanner = source("../components/JobRoutePlanner.tsx");
const addOnNotifications = source("../components/AddOnNotifications.tsx");
const readme = source("../README.md");
const constitution = source("../docs/OPSCENTER_OS_CONSTITUTION.md");

assert.match(navItems, /href: "\/jobs", label: "Schedule", mobileLabel: "Schedule"/);
assert.ok(!opsNav.includes('label: "Dispatch"'), "Schedule sidebar still exposes the retired Dispatch section name.");
assert.ok(opsNav.includes('label: "Schedule"'), "Schedule sidebar label is missing.");

for (const label of [
  'title={isOpenEstimatesWorkspace ? "Estimates"',
  '{ label: "Schedule", href: buildJobsHref({ date, view: "daily", workspace: "dispatch"',
  'aria-label="Schedule workspace views"',
  "using the schedule layout",
  "Open schedule",
]) {
  assert.ok(jobsPage.includes(label), `Schedule page is missing canonical copy: ${label}`);
}
for (const retiredCopy of [
  '? "Dispatch" : "Schedule"',
  '{ label: "Dispatch", href: buildJobsHref',
  'aria-label="Dispatch workspace views"',
  "using the dispatch layout",
  "Open dispatch",
]) {
  assert.ok(!jobsPage.includes(retiredCopy), `Schedule page still exposes retired copy: ${retiredCopy}`);
}

assert.ok(jobsMap.includes("Schedule Workspace"), "Map card must use the Schedule section name.");
assert.ok(routePlanner.includes("Schedule Routes"), "Route planner must use the Schedule section name.");
assert.ok(addOnNotifications.includes("Schedule alerts"), "Add-on panel must use the Schedule section name.");
assert.ok(readme.includes("dashboard, Schedule, Krewe, Fleet, Marketing"), "README surface list must use Schedule.");
assert.ok(constitution.includes("across Schedule, Krewe, Fleet, and Finance"), "Product boundary must use Schedule.");

assert.ok(jobsPage.includes('workspace: "dispatch"'), "Internal dispatch workspace key must remain compatible.");
assert.ok(navItems.includes('href: "/jobs"'), "Internal /jobs route must remain compatible.");

console.log("Schedule naming contract passed.");
