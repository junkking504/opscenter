import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import postcss, { type Rule } from "postcss";

const root = process.cwd();
const layout = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");
const entry = fs.readFileSync(path.join(root, "app/ops-styles.css"), "utf8");
const usability = fs.readFileSync(path.join(root, "app/ops-usability.css"), "utf8");
const visualSystem = fs.readFileSync(path.join(root, "app/ops-visual-system.css"), "utf8");
const jobsCss = fs.readFileSync(path.join(root, "app/(protected)/jobs/jobs.css"), "utf8");
const maintenanceCss = fs.readFileSync(path.join(root, "app/(protected)/fleet/maintenance.css"), "utf8");
const jobsPage = fs.readFileSync(path.join(root, "app/(protected)/jobs/page.tsx"), "utf8");
const crewPage = fs.readFileSync(path.join(root, "app/(protected)/crew/page.tsx"), "utf8");
const crewPayPeriodCards = fs.readFileSync(path.join(root, "components/CrewPayPeriodCards.tsx"), "utf8");
const styleFiles = [
  "globals.css",
  "ops-redesign.css",
  "ops-design-system.css",
  "dashboard-v2.css",
  "ops-usability.css",
  "crew-responsive.css",
  "compact-verifiers.css",
  "ops-visual-system.css",
];

assert.match(layout, /import "\.\/ops-styles\.css";/, "The root layout must load the single OpsCenter style entry.");
for (const file of styleFiles) {
  assert.doesNotMatch(layout, new RegExp(`import ["']\\./${file.replace(".", "\\.")}["']`), `${file} must be loaded through the layered entry.`);
}

let previousIndex = -1;
for (const file of styleFiles) {
  const statement = `@import "./${file}";`;
  const statementIndex = entry.indexOf(statement);
  assert.ok(statementIndex > previousIndex, `${file} must remain in the intended cascade order.`);
  previousIndex = statementIndex;
}

const totalLines = styleFiles.reduce((sum, file) => {
  const content = fs.readFileSync(path.join(root, "app", file), "utf8");
  return sum + content.split(/\r?\n/).length;
}, 0);
assert.ok(totalLines <= 18_000, `Shared CSS exceeded the 18,000-line migration budget (${totalLines}).`);
for (const file of styleFiles) {
  const content = fs.readFileSync(path.join(root, "app", file), "utf8");
  assert.doesNotMatch(content, /^@media\s*$/m, `${file} must not contain orphaned media queries.`);
}
assert.match(entry, /@import "\.\/ops-visual-system\.css";/, "The visual system must remain the final shared cascade layer.");

const visualRoot = postcss.parse(visualSystem);
function declarationsFor(selector: string): Set<string> {
  const declarations = new Set<string>();
  visualRoot.walkRules((rule: Rule) => {
    if (rule.selectors.map((entrySelector) => entrySelector.trim()).includes(selector)) {
      rule.walkDecls((declaration) => {
        declarations.add(declaration.prop);
      });
    }
  });
  return declarations;
}

for (const property of ["border-color", "background", "color"]) {
  assert.ok(declarationsFor(".ops-nav-item:hover").has(property), `The final nav hover rule must provide ${property}.`);
}
for (const property of ["border-color", "background", "color", "box-shadow"]) {
  assert.ok(declarationsFor(".ops-nav-item.active").has(property), `The final active nav rule must provide ${property}.`);
}
assert.ok(declarationsFor(".ops-nav-item.active .ops-nav-icon").has("color"), "The final active nav icon rule must provide color.");
const focusSelector = ":where(a, button, input, select, textarea, summary):focus-visible";
assert.deepEqual(
  [...declarationsFor(focusSelector)].sort(),
  ["outline", "outline-offset"],
  "The final shared focus-visible rule must retain its visible ring.",
);
const reducedMotionDeclarations = new Set<string>();
visualRoot.walkAtRules("media", (atRule) => {
  if (atRule.params !== "(prefers-reduced-motion: reduce)") return;
  atRule.walkDecls((declaration) => {
    reducedMotionDeclarations.add(declaration.prop);
  });
});
for (const property of ["scroll-behavior", "transition-duration", "animation-duration", "animation-iteration-count"]) {
  assert.ok(reducedMotionDeclarations.has(property), `Reduced-motion handling must retain ${property}.`);
}

function hexRgb(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((channel) => Number.parseInt(channel, 16));
  assert.equal(channels?.length, 3, `Expected a six-digit hex color, received ${hex}.`);
  return channels as [number, number, number];
}

function luminance(hex: string) {
  return hexRgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const semanticColors = Object.fromEntries(
  Array.from(usability.matchAll(/--oc-(success-text|warning-text|success-on-dark|warning-on-dark):\s*(#[0-9a-f]{6})/gi))
    .map((match) => [match[1], match[2]]),
);
assert.ok(contrast(semanticColors["success-text"], "#ffffff") >= 7, "Light-surface success text must meet AAA contrast.");
assert.ok(contrast(semanticColors["warning-text"], "#ffffff") >= 7, "Light-surface warning text must meet AAA contrast.");
assert.ok(contrast(semanticColors["success-on-dark"], "#10151b") >= 7, "Dark-surface success text must meet AAA contrast.");
assert.ok(contrast(semanticColors["warning-on-dark"], "#10151b") >= 7, "Dark-surface warning text must meet AAA contrast.");
assert.match(usability, /@media \(hover: hover\)[\s\S]*--oc-interaction-ring/, "Clickable controls must retain shared hover feedback.");
assert.match(
  usability,
  /\.ops-main :where\(\.ops-crew-employee-summary, \.ops-crew-period-day-summary\):is\(:hover, :active\)/,
  "Every employee summary card must use the shared interaction treatment.",
);
assert.match(crewPage, /className="ops-crew-employee-summary"/, "Today employee cards must use the shared summary class.");
assert.match(crewPayPeriodCards, /className="ops-crew-employee-summary"/, "Pay-period employee cards must use the shared summary class.");
assert.match(jobsCss, /\.ops-jobs-page \.ops-appointment-detail-grid > div\s*\{\s*min-width: 0;/, "Every job detail cell must be allowed to shrink.");
assert.match(jobsCss, /\.ops-jobs-page \.ops-appointment-detail-grid strong,[\s\S]*?overflow-wrap: anywhere;/, "Every long job detail value must wrap inside its column.");
assert.equal(
  Array.from(jobsPage.matchAll(/className="ops-appointment-detail-grid"/g)).length,
  2,
  "Both appointment-card render paths must use the shared detail grid.",
);
assert.doesNotMatch(`${usability}\n${jobsCss}`, /Anthony Dozier|Regina Marshall|JK4047670/i, "Card styling must never target a specific person or job.");
assert.match(maintenanceCss, /\.ops-maintenance-page \.ops-repair-table td,\s*\.ops-maintenance-page \.ops-repair-table td strong/, "Repair queue text must override the old dark-surface palette on the rendered maintenance page.");
assert.doesNotMatch(maintenanceCss, /\.ops-maintenance-layout\s+:where\(/, "Maintenance contrast rules must target the rendered maintenance page class.");

console.log(`CSS architecture verification passed (${totalLines.toLocaleString()} ordered shared lines).`);
