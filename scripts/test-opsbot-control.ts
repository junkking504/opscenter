import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const commandPage = read("app/(protected)/page.tsx");
assert.match(commandPage, /\["overview", "opsbot", "crew", "fleet"\]/, "Command must recognize the OpsBot subview.");
assert.match(commandPage, /section === "overview" \|\| section === "opsbot"/, "OpsBot must use the same current schedule and fleet observation path as Command.");
assert.match(commandPage, /<OpsBotControl/, "Command must render the OpsBot control surface.");
assert.match(commandPage, /recommendations=\{commandExceptions\}/, "OpsBot recommendations must come from current Command conditions.");
assert.match(commandPage, /kernelStatus=\{kernelDatabase\.status\}/, "OpsBot must disclose the real action-kernel state.");

const nav = read("components/OpsNav.tsx");
assert.match(nav, /label: "OpsBot Control"/, "Command navigation must expose OpsBot Control.");
assert.match(nav, /section: "opsbot"/, "OpsBot navigation must preserve the Command section contract.");

const component = read("components/OpsBotControl.tsx");
for (const copy of [
  "OpsBot is watching the operation.",
  "Observe + Recommend",
  "Human approval retained",
  "No autonomous production agent or unrestricted write access.",
  "Source authority preserved",
  "Signal to verified outcome",
  "Action execution is not live",
]) {
  assert.ok(component.includes(copy), `OpsBot Control is missing its safety contract: ${copy}`);
}
for (const source of ["JunkWare", "LinxUp", "JunkWare + QBO"]) {
  assert.ok(component.includes(source), `OpsBot Control must identify ${source} as a source lane.`);
}
assert.doesNotMatch(component, /<button|fetch\(/, "OpsBot Control v1 must remain a read-only control surface.");

const theme = read("components/OpsBotControl.module.css");
for (const contract of [
  ".primaryGrid",
  ".secondaryGrid",
  ".autonomyList",
  "@media (max-width: 820px)",
  "@media (max-width: 560px)",
]) {
  assert.ok(theme.includes(contract), `OpsBot Control theme is missing ${contract}.`);
}

const docs = read("docs/OPSBOT_CONTROL.md");
assert.match(docs, /OpsBot is the AI operator identity/);
assert.match(docs, /OpsCenter OS remains the operating layer/);
assert.match(docs, /Money, payroll, customer communication, access, deletion, and broad operational\s+changes remain approval-gated/);

console.log("OpsBot Control route, source, autonomy, safety, and responsive contracts passed.");
