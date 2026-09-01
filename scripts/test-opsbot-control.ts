import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

const commandPage = read("app/(protected)/page.tsx");
assert.match(commandPage, /requestedSection === "opsbot"\s*\? "overview"/, "The retired OpsBot URL must fall back to Command Overview.");
assert.match(commandPage, /<OpsBotCommandBrief date=\{date\} exceptions=\{commandExceptions\}/, "Command must embed the useful OpsBot brief.");
assert.doesNotMatch(commandPage, /<OpsBotControl/, "Command must not retain the standalone OpsBot dashboard.");
assert.match(commandPage, /title="Command"/, "Command must retain one primary destination.");

const nav = read("components/OpsNav.tsx");
assert.doesNotMatch(nav, /label: "OpsBot Control"/, "OpsBot must not remain a separate navigation destination.");
assert.doesNotMatch(nav, /section: "opsbot"/, "Command navigation must not create a second OpsBot page.");

const component = read("components/OpsBotCommandBrief.tsx");
for (const copy of [
  "Only appears when something needs attention.",
  "Needs attention",
  "Waiting for approval",
  "Recent results",
  "Another manager must review",
]) {
  assert.ok(component.includes(copy), `The embedded OpsBot brief is missing: ${copy}`);
}
assert.match(component, /\/api\/platform\/action-runs/, "The embedded brief must load real approval activity.");
assert.match(component, /\/api\/inbox\?date=/, "The embedded brief must identify the current actor before offering approval.");
assert.match(component, /run\.riskClass >= 2 && run\.actorId === actorId/, "The requester must not approve their own important change.");
assert.match(component, /if \(!hasUsefulWork\) return null/, "OpsBot must disappear when nothing useful needs attention.");

const theme = read("components/OpsBotCommandBrief.module.css");
for (const contract of [
  ".columns",
  ".approvalActions",
  "@media (max-width: 900px)",
  "@media (max-width: 620px)",
]) {
  assert.ok(theme.includes(contract), `The embedded OpsBot theme is missing ${contract}.`);
}

const docs = read("docs/OPSBOT_CONTROL.md");
assert.match(docs, /OpsBot is the AI operator identity/);
assert.match(docs, /OpsCenter OS remains the operating layer/);
assert.match(docs, /it is not a separate dashboard destination/);
assert.match(docs, /appears only\s+when an exception, approval, or failed result needs attention/);
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
assert.match(docs, /WhatsApp retry controls remain locked/);
assert.match(docs, /The Customer Contact control pack adds/);
assert.match(docs, /without copying the customer name or phone into the action\s+input, audit record, or governed contact ledger/);
assert.match(docs, /risk-class 2 call or SMS plan requiring approval by a different manager or administrator/);
assert.match(docs, /OpsBot never presses send/);
assert.match(docs, /serialized JunkWare appointment-note adapter/);
assert.match(docs, /an `SMS sent` confirmation is not a carrier delivery receipt/);
assert.match(docs, /The Marketing control pack adds/);
assert.match(docs, /The SearchKings recovery pack adds/);
assert.match(docs, /priority worklist over verified lost and needs-follow-up calls/);
assert.match(docs, /only a completed JunkWare appointment may supply attributed revenue/);
assert.match(docs, /never calls or messages a\s+customer, changes a SearchKings call, creates or edits a JunkWare appointment/);
assert.match(docs, /candidate customer, JK number, completed appointment date, territory, and Krewe/);
assert.match(docs, /separate `confirm suggestion` and `re-assign` intents/);
assert.match(docs, /risk-class 2 registered attribution request/);
assert.match(docs, /exact Podium snapshot, review, assignment-store, prior-assignment, and completed-job/);
assert.match(docs, /never replies to the reviewer, changes\s+the Podium review, edits the JunkWare appointment/);
assert.match(docs, /only `MISSION_CONTROL` may change shared Dispatch or JunkWare state/);
assert.match(docs, /The JunkWare closeout pack adds/);
assert.match(docs, /`jobs\.update_closeout\.v1`/);
assert.match(docs, /does not directly resolve the work item/);
assert.match(docs, /Money, payroll, customer communication, access, deletion, and broad operational\s+changes remain approval-gated/);

console.log("Embedded OpsBot Command brief, approval safety, route fallback, and responsive contracts passed.");
