import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const navSource = readFileSync(new URL("../components/OpsNav.tsx", import.meta.url), "utf8");
const designSystemSource = readFileSync(new URL("../app/ops-design-system.css", import.meta.url), "utf8");

for (const section of [
  'pathname === "/"',
  'pathname.startsWith("/jobs")',
  'pathname.startsWith("/marketing")',
  'pathname.startsWith("/crew")',
  'pathname.startsWith("/fleet")',
  'pathname.startsWith("/finance")',
]) {
  assert.ok(navSource.includes(section), `Secondary navigation is missing the ${section} surface.`);
}

for (const destination of [
  "Monthly overview",
  "Lost Leads",
  "Pay period",
  "Maintenance overview",
  "Service planner",
  "Data quality",
  "Payments & recon",
  "Resale inventory",
]) {
  assert.ok(navSource.includes(destination), `Secondary navigation is missing ${destination}.`);
}

assert.ok(navSource.includes("roleVisibleSubItems(sidebarSubItems(pathname, searchParams), role)"), "Only the active section should expose its view map.");
assert.ok(navSource.includes("authorizeOpsRequest(role, target.pathname, \"GET\", target.searchParams)"), "Secondary links must preserve role restrictions.");
assert.ok(navSource.includes('className="ops-nav-subitems" role="group"'), "Sidebar view links must render as a labeled group.");
assert.ok(navSource.includes("aria-current={subItem.active ? \"page\" : undefined}"), "The current secondary view must be announced.");

for (const selector of [".ops-nav-subitems", ".ops-nav-subitem", ".ops-nav-subitem.active"]) {
  assert.ok(designSystemSource.includes(selector), `Secondary navigation styling is missing ${selector}.`);
}
assert.ok(designSystemSource.includes(".ops-sidebar > .ops-nav"), "The expanded view hierarchy must have its own scroll region.");
assert.ok(designSystemSource.includes("overflow-y: auto"), "Dense sidebar views must remain reachable at short desktop heights.");
assert.ok(designSystemSource.includes(".ops-sidebar > .ops-sidebar-footer"), "The account footer must remain outside the scrolling view hierarchy.");

console.log("Secondary navigation discovery checks passed.");
