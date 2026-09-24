import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { attributeWexTransactionToLinxup } from "../lib/wex-linxup-attribution";
import { enqueueWexExpenseAutomations, findMatchingWexAutomation, queuedWexExpenseAutomations, wexExpenseQueueCounts } from "../lib/wex-expense-automation";
import { formatWexExpenseSlackNotification } from "../lib/wex-expense-slack";
import type { CrewExpenseRecord } from "../lib/whatsapp-crew-expenses";
import type { WexFuelTransaction } from "../lib/wex-fuel";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "wex-expense-"));
process.env.OPSCENTER_DATA_DIR = root;
process.env.WEX_FUEL_DATA_DIR = path.join(root, "integrations", "wex-fuel");
const history = path.join(root, "history", "linxup");
fs.mkdirSync(history, { recursive: true });

const transaction: WexFuelTransaction = {
  transactionId: "wex-1", transactionDate: "2026-09-24", transactionTime: "10:00 AM", postedDate: "2026-09-25",
  truck: "Gas Card #1", driver: "Shared Card", driverPromptId: "", cardLastFive: "03290", units: 20, unitOfMeasure: "GA", gallons: 20,
  unitCost: 3.75, totalFuelCost: 75, totalNonFuelCost: 0, netCost: 75, product: "001", productDescription: "Fuel",
  merchant: "Shell Service Station", merchantAddress: "3032 Elysian Fields Ave", city: "New Orleans", state: "LA", postalCode: "70122",
  odometer: null, ticketNumber: "ticket-1", status: "posted",
};
const writeDay = (payload: Record<string, unknown>) => fs.writeFileSync(path.join(history, "linxup_location_2026-09-24.json"), JSON.stringify(payload));
writeDay({ stops: [{ driverName: "Truck #4", street: "3032 Elysian Fields Avenue", city: "New Orleans", stateCode: "LA", postalCode: "70122-3627", beginDate: Date.parse("2026-09-24T14:50:00Z"), endDate: Date.parse("2026-09-24T15:10:00Z"), latitude: 29.97, longitude: -90.06 }], trips: [], points: [] });
const direct = attributeWexTransactionToLinxup(transaction, root);
assert.equal(direct.status, "attributed");
assert.equal(direct.truck, "Truck# 4");
assert.equal(direct.method, "address_stop");
assert.equal(direct.transactionAt, "2026-09-24T15:00:00.000Z", "WEX local time is converted to the exact Chicago instant");

writeDay({ stops: [
  { driverName: "Truck #4", street: "3032 Elysian Fields Ave", city: "New Orleans", stateCode: "LA", postalCode: "70122", beginDate: Date.parse("2026-09-24T14:50:00Z"), endDate: Date.parse("2026-09-24T15:10:00Z") },
  { driverName: "Truck #7", street: "3032 Elysian Fields Ave", city: "New Orleans", stateCode: "LA", postalCode: "70122", beginDate: Date.parse("2026-09-24T14:55:00Z"), endDate: Date.parse("2026-09-24T15:05:00Z") },
], trips: [], points: [] });
assert.equal(attributeWexTransactionToLinxup(transaction, root).status, "ambiguous", "two matching trucks fail closed");

writeDay({ stops: [{ driverName: "Truck #4", street: "3032 Elysian Fields Avenue", city: "New Orleans", stateCode: "LA", postalCode: "70122", beginDate: Date.parse("2026-09-24T14:50:00Z"), endDate: Date.parse("2026-09-24T15:10:00Z"), latitude: 29.97, longitude: -90.06 }], trips: [], points: [] });
const queued = enqueueWexExpenseAutomations([transaction], new Date("2026-09-25T12:00:00Z"));
assert.deepEqual(queued, { queued: 1, matched: 0, review: 0, existing: 0 });
assert.equal(queuedWexExpenseAutomations().length, 1);
assert.deepEqual(enqueueWexExpenseAutomations([transaction]), { queued: 0, matched: 0, review: 0, existing: 1 }, "WEX transaction ID is idempotent across queue states");
const automation = JSON.parse(fs.readFileSync(queuedWexExpenseAutomations()[0], "utf8"));
const slack = formatWexExpenseSlackNotification(automation);
assert.match(slack, /\$75\.00/);
assert.match(slack, /Truck# 4/);
assert.match(slack, /LinxUp address stop/);

const manual: CrewExpenseRecord = { version: 1, messageId: "manual-1", kind: "fuel", date: "2026-09-24", truck: "Truck# 4", location: "Shell", cost: 75, weight: null, gallons: 20, time: "10:05 AM", reportedAt: "2026-09-24T15:05:00Z", senderHash: "sender", source: "whatsapp_opsbot" };
assert.equal(findMatchingWexAutomation(manual)?.transaction.transactionId, "wex-1", "later manual input resolves to the one automated expense");

const expenseDirectory = path.join(root, "history", "junkware", "expenses", "2026-09-24", "352");
fs.mkdirSync(expenseDirectory, { recursive: true });
fs.writeFileSync(path.join(expenseDirectory, "4.json"), JSON.stringify({
  date: "2026-09-24", market: "352", verified: true, truck: "Truck# 4", observedAt: "2026-09-24T18:00:00Z",
  entries: [{ id: "a".repeat(32), date: "2026-09-24", market: "352", truck: "Truck# 4", kind: "fuel", transactionAt: "2026-09-24T15:03:00Z", location: "Shell", receipt: "manual-receipt", amount: 88, notify: false }],
}));
const alreadyManual = { ...transaction, transactionId: "wex-2", netCost: 88, totalFuelCost: 88 };
assert.deepEqual(enqueueWexExpenseAutomations([alreadyManual]), { queued: 0, matched: 1, review: 0, existing: 0 }, "an existing verified manual expense is reused");
const matched = JSON.parse(fs.readFileSync(queuedWexExpenseAutomations().find(file => JSON.parse(fs.readFileSync(file, "utf8")).transaction.transactionId === "wex-2")!, "utf8"));
assert.equal(matched.action, "matched_existing");
assert.match(formatWexExpenseSlackNotification(matched), /no duplicate created/i);
assert.deepEqual(wexExpenseQueueCounts(), { pending: 2, processing: 0, completed: 0, failed: 0, review: 0 });

fs.rmSync(root, { recursive: true, force: true });
console.log("WEX LinxUp attribution and expense automation tests passed.");
