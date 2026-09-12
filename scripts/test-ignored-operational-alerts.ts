import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildOperationalExceptions } from "@/lib/operational-exceptions";
import { isOperationalSlackDigestMessage } from "@/lib/slack-digest";
import { formatSlackAlert, type SlackOpsAlert } from "@/lib/slack-alerts";
import { isIgnoredIncidentFingerprint } from "@/lib/ignored-operational-alerts";

const names = ["Robert McLaughlin", "Eugene Dabezies", "Branden Dozier"];
const cwd = process.cwd();
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-ignored-alerts-"));
try {
  const directory = path.join(fixture, "data/history/daily_metrics");
  fs.mkdirSync(directory, { recursive: true });
  process.chdir(fixture);
  for (const date of ["2030-01-01", "2030-01-02"]) {
    fs.writeFileSync(path.join(directory, `daily_metrics_${date}.json`), JSON.stringify({
      employee_leaderboard: names.map(name => ({ name, is_salary: true, hourly_rate: 20, hourly_pay: 100, total_pay: 100 })),
    }));
    const report = buildOperationalExceptions(date);
    assert.deepEqual(report.exceptions.filter(item => item.rule === "salaried_employee_incorrectly_treated_as_hourly").map(item => item.entityLabel), ["Branden Dozier"]);
    for (const name of names) {
      assert.ok(report.exceptions.some(item => item.entityLabel === name && item.rule === "stored_total_earnings_does_not_match_formula"), "Other payroll warnings remain visible");
    }
  }
} finally {
  process.chdir(cwd);
  fs.rmSync(fixture, { recursive: true, force: true });
}

for (const name of [...names, "McLaughlin, Robert", "Dabezies, Eugene", "Robert McLaughlin Jr"]) {
  const ignored = !["Branden Dozier", "Robert McLaughlin Jr"].includes(name);
  const alert: SlackOpsAlert = {
    fingerprint: `payroll_exception:crew-${name.toLowerCase()}-salary-as-hourly`,
    kind: "payroll_exception", lifecycle: "incident", severity: "critical", channelId: "C_TEST",
    title: "Salaried employee treated as hourly",
    detail: `${name}: ${name} is salaried but still has hourly pay or an hourly rate value recorded.`,
    nextAction: "Review", href: "/krewe",
  };
  const text = formatSlackAlert(alert);
  assert.equal(isOperationalSlackDigestMessage({ text }), !ignored);
  assert.equal(isOperationalSlackDigestMessage({ text: `:white_check_mark: *Resolved*\n${text}` }), !ignored);
  assert.equal(isIgnoredIncidentFingerprint(alert.fingerprint), ignored);
  assert.equal(isOperationalSlackDigestMessage({ text: formatSlackAlert({ ...alert, title: "Stored total earnings mismatch" }) }), true);
  assert.equal(isIgnoredIncidentFingerprint(alert.fingerprint.replace("salary-as-hourly", "earnings-mismatch")), false);
}
console.log("PASS: permanent salary-warning suppression, later dates, history, and unrelated payroll alerts");
