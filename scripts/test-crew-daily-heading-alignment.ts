import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
const dailyView = page.slice(page.indexOf("function DailyPerformanceView"), page.indexOf("function PayPeriodView"));
assert.equal((dailyView.match(/sectionHeaderCentered/g) || []).length, 2, "Daily Performance and Everyone’s Daily Metrics must use the centered heading layout.");

const styles = readFileSync(new URL("../app/my-pay/my-pay.module.css", import.meta.url), "utf8");
const ruleStart = styles.indexOf(".sectionHeaderCentered {");
const ruleEnd = styles.indexOf("}", ruleStart);
const rule = styles.slice(ruleStart, ruleEnd);
assert.ok(rule.includes("justify-items: center"), "Centered Crew headings must center their content.");
assert.ok(rule.includes("text-align: center"), "Centered Crew heading text must be centered.");

console.log("Crew daily heading alignment checks passed.");
