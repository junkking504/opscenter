import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const interfaceSource = [
  read("app/(protected)/page.tsx"),
  read("components/OpsBotCommandBrief.tsx"),
  read("components/OpsNav.tsx"),
  read("components/JobCloseoutEditor.tsx"),
].join("\n");
const generatedStatusCopy = [
  read("lib/systems-control.ts"),
  read("lib/linxup-control.ts"),
].join("\n");

for (const required of [
  "Only appears when something needs attention",
  "Needs attention",
  "Waiting for approval",
  "Recent results",
  "Another manager must review",
  "OpsCenter changes",
  "LinxUp GPS updates",
  "QBO payment check",
  "This tracker does not have a current location",
]) {
  assert.ok(`${interfaceSource}\n${generatedStatusCopy}`.includes(required), `The dashboard is missing its plain-language promise: ${required}`);
}

for (const oldStatusCopy of [
  "Platform action kernel",
  "LinxUp telemetry delivery",
  "QBO payment reconciliation",
  "No authoritative device delivery lane is available",
  "Current device evidence is available",
]) {
  assert.ok(!generatedStatusCopy.includes(oldStatusCopy), `System status still exposes internal wording: ${oldStatusCopy}`);
}

for (const jargon of [
  "Control OpsCenter through registered actions",
  "control pack",
  "Risk class",
  "Risk 2",
  "Risk 3",
  "Mission Control",
  "Preview simulation",
  "Action ledger",
  "Disposition</span>",
  "Command runtime",
  "Autonomy ladder",
  "Trust architecture",
  "source lanes",
  "OpsBot AI Dashboard",
  "label: \"OpsBot Control\"",
]) {
  assert.ok(!interfaceSource.includes(jargon), `The dashboard still exposes internal wording: ${jargon}`);
}

console.log("Embedded OpsBot plain-language contract passed.");
