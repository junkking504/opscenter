import assert from "node:assert/strict";
import fs from "node:fs";

const compactCss = fs.readFileSync(new URL("../app/compact-verifiers.css", import.meta.url), "utf8");
const jobsCss = fs.readFileSync(new URL("../app/(protected)/jobs/jobs.css", import.meta.url), "utf8");
const jobsMap = fs.readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
const pageHeader = fs.readFileSync(new URL("../components/PageHeader.tsx", import.meta.url), "utf8");
const pageSubnav = fs.readFileSync(new URL("../components/PageSubnav.tsx", import.meta.url), "utf8");

assert.match(compactCss, /:is\(\.ops-maintenance-page, \.ops-finance-page\).*\.ops-page-subnav/);
assert.match(compactCss, /\.ops-page-subnav \{[\s\S]*?height: auto;[\s\S]*?overflow-x: auto;/);
assert.match(compactCss, /scroll-snap-type: x proximity/);
assert.match(compactCss, /\.ops-finance-page \.ops-finance-layout > \* \{\s*min-width: 0;/);
assert.match(compactCss, /\.ops-finance-page \.ops-reconciliation-job-link \{[\s\S]*?min-height: 44px/);
assert.match(compactCss, /\.ops-finance-page \.ops-finance-table-scroll \{[\s\S]*?touch-action: pan-x pan-y/);

assert.match(jobsCss, /\.ops-jobs-map-schedule \.ops-jobs-map-board \{[\s\S]*?min-width: 600px !important;[\s\S]*?--ops-jobs-map-time-cell-min: 44px !important;/);
assert.match(jobsCss, /\.ops-jobs-map-board-block \{[\s\S]*?touch-action: pan-x pan-y/);
assert.match(jobsCss, /\.ops-route-board-mobile-help \{ display: block; \}/);
assert.match(jobsMap, /Swipe for later times · tap an appointment to edit truck or time/);

assert.match(pageHeader, /<PageSubnav title=\{title\} sections=\{sections\} \/>/);
assert.match(pageSubnav, /scrollWidth <= nav\.clientWidth/);
assert.match(pageSubnav, /scrollIntoView\(\{ behavior: "instant", block: "nearest", inline: "center" \}\)/);
assert.match(pageSubnav, /aria-current=\{section\.active \? "page" : undefined\}/);

console.log("Mobile field workflow contracts passed.");
