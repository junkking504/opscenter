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
assert.match(commandPage, /kernelDatabase\.status === "ready" \? "Controlled execution"/, "The Command header must disclose when controlled execution is connected.");

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
  "Registered commands and audit ledger",
]) {
  assert.ok(component.includes(copy), `OpsBot Control is missing its safety contract: ${copy}`);
}
for (const source of ["OpsCenter health + readiness", "JunkWare", "LinxUp", "JunkWare + QBO", "Podium + JunkWare"]) {
  assert.ok(component.includes(source), `OpsBot Control must identify ${source} as a source lane.`);
}
assert.match(component, /<OpsBotActionConsole date=\{date\} enabled=\{kernelReady\}/, "OpsBot Control must mount the kernel-gated action console.");

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
assert.match(docs, /The Dispatch control pack adds/);
assert.match(docs, /The Systems control pack adds/);
assert.match(docs, /platform kernel, operator authentication, JunkWare\s+schedule, LinxUp delivery, QBO reconciliation/);
assert.match(docs, /risk-class 2 recovery review with required disposition, owner, next bounded action/);
assert.match(docs, /never restarts a service\s+or collector, changes credentials, touches a tunnel or database/);
assert.match(docs, /same-day hourly rescheduling/);
assert.match(docs, /cancellation requests with a required reason/);
assert.match(docs, /cross-date moves with risk-class 3 approval/);
assert.match(docs, /pre-write current-date\/time checks/);
assert.match(docs, /The Fleet control pack adds/);
assert.match(docs, /risk-class 3 out-of-service requests/);
assert.match(docs, /blocks return to service while any other out-of-service repair remains/);
assert.match(docs, /LinxUp telemetry and checklist signals are advisory/);
assert.match(docs, /The LinxUp control pack adds/);
assert.match(docs, /per-device evidence view/);
assert.match(docs, /fresh collector\s+file never labels a truck `Live GPS` unless that device supplied an actual current point/);
assert.match(docs, /risk-class 2 review dispositions/);
assert.match(docs, /exact current device observation/);
assert.match(docs, /does not rewrite telemetry, change the vehicle map,\s+contact LinxUp, or change truck availability/);
assert.match(docs, /The Finance control pack adds/);
assert.match(docs, /manual bonuses and payroll corrections/);
assert.match(docs, /risk-class 2 payment-exception reviews/);
assert.match(docs, /required disposition, owner, next action/);
assert.match(docs, /exact source observation, review-store version, and prior record version/);
assert.match(docs, /never clears the source exception, posts\s+or refunds a QBO transaction, changes JunkWare/);
assert.match(docs, /Direct QBO\s+writes remain locked/);
assert.match(docs, /only `MISSION_CONTROL` may change shared bonus or payroll-correction state/);
assert.match(docs, /The Krewe control pack adds/);
assert.match(docs, /worked or were attributed to a job today from\s+roster-only people/);
assert.match(docs, /risk-class 1 available or unavailable responses/);
assert.match(docs, /risk-class 2 call-in commitments/);
assert.match(docs, /does not message the employee,\s+assign a JunkWare job/);
assert.match(docs, /only `MISSION_CONTROL` may change shared Krewe control state/);
assert.match(docs, /The Communications control pack adds/);
assert.match(docs, /risk-class 2 internal Ops Command notice/);
assert.match(docs, /only to the owned `#ops-command` channel/);
assert.match(docs, /customer-facing sends remain controlled by the\s+verified JunkWare upload, quiet-window batching, and existing delivery workers/);
assert.match(docs, /approved `read_reviews` and `read_locations` scopes/);
assert.match(docs, /WhatsApp retry or manual customer send controls remain locked/);
assert.match(docs, /The Marketing control pack adds/);
assert.match(docs, /candidate customer, JK number, completed appointment date, territory, and Krewe/);
assert.match(docs, /separate `confirm suggestion` and `re-assign` intents/);
assert.match(docs, /risk-class 2 registered attribution request/);
assert.match(docs, /exact Podium snapshot, review, assignment-store, prior-assignment, and completed-job/);
assert.match(docs, /never replies to the reviewer, changes\s+the Podium review, edits the JunkWare appointment/);
assert.match(docs, /only `MISSION_CONTROL` may change shared Dispatch or JunkWare state/);
assert.match(docs, /Money, payroll, customer communication, access, deletion, and broad operational\s+changes remain approval-gated/);

console.log("OpsBot Control route, source, autonomy, safety, and responsive contracts passed.");
