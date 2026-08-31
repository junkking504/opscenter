import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PageSubnav from "../components/PageSubnav";

const navSource = readFileSync(new URL("../components/OpsNav.tsx", import.meta.url), "utf8");
const pageSubnavSource = readFileSync(new URL("../components/PageSubnav.tsx", import.meta.url), "utf8");
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
  "Reviews",
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
assert.doesNotMatch(navSource, /mobileItems|ops-bottom-nav-more|>More</, "Bottom navigation must not collapse behind a More control.");
assert.match(navSource, /variant === "bottom"[\s\S]*navigationItems\.map/, "Bottom navigation must render the full role-filtered destination set.");

for (const selector of [".ops-nav-subitems", ".ops-nav-subitem", ".ops-nav-subitem.active"]) {
  assert.ok(designSystemSource.includes(selector), `Secondary navigation styling is missing ${selector}.`);
}
assert.ok(designSystemSource.includes(".ops-sidebar > .ops-nav"), "The expanded view hierarchy must have its own scroll region.");
assert.ok(designSystemSource.includes("overflow-y: auto"), "Dense sidebar views must remain reachable at short desktop heights.");
assert.ok(designSystemSource.includes(".ops-sidebar > .ops-sidebar-footer"), "The account footer must remain outside the scrolling view hierarchy.");

const subnavMarkup = renderToStaticMarkup(createElement(PageSubnav, {
  title: "Fleet Maintenance",
  sections: [
    { label: "Maintenance overview", href: "/fleet?section=overview", active: true },
    { label: "Service planner", href: "/fleet?section=service" },
    { label: "Reports", href: "/fleet?section=reports" },
  ],
}));
assert.match(pageSubnavSource, /import Link from ["']next\/link["']/, "Page subnavigation must use Next Link for client-side transitions.");
assert.doesNotMatch(pageSubnavSource, /<a\s/, "Page subnavigation must not retain full-document anchors.");
assert.match(subnavMarkup, /<details class="ops-page-subnav-mobile">/, "Mobile page navigation must expose a one-tap section chooser.");
assert.match(subnavMarkup, /<summary><span>Maintenance Overview<\/span><small>All sections<\/small><\/summary>/, "The mobile chooser must identify the current section.");
assert.equal((subnavMarkup.match(/href="\/fleet\?section=/g) || []).length, 6, "Desktop and mobile navigation must both expose every section.");

console.log("Secondary navigation discovery checks passed.");
