import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { CrewExpenseRecord } from "@/lib/whatsapp-crew-expenses";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN = "/account/login.aspx";
const TRUCK_RECORDS_URL = `${ORIGIN}/franchise/accounting/truck-records.aspx`;
const WRITE_LOCK = "/tmp/com.openclaw.opscenter.junkware-truck-record.lock";

function clean(value: unknown): string {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function keychain(service: string): string {
  try {
    return execFileSync("security", ["find-generic-password", "-w", "-s", service], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000,
    }).trim();
  } catch {
    return "";
  }
}

function environmentSecret(name: string): string {
  const encoded = clean(process.env[`${name}_BASE64`]);
  if (encoded) {
    try { return Buffer.from(encoded, "base64").toString("utf8"); } catch { return ""; }
  }
  return String(process.env[name] || "");
}

function storageStateFile(): string {
  const dataDirectory = process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
  return path.join(dataDirectory, "protected", "junkware_storage_state.json");
}

async function logIn(page: Page): Promise<void> {
  const username = environmentSecret("JUNKWARE_USERNAME").trim() || keychain("opsbot-junkware-username");
  const password = environmentSecret("JUNKWARE_PASSWORD") || keychain("opsbot-junkware-password");
  if (!username || !password) throw new Error("JunkWare credentials are unavailable.");
  await page.locator("#ctl00_Content_UsernameTB").fill(username);
  await page.locator("#ctl00_Content_PasswordTB").fill(password);
  const remember = page.locator("#ctl00_Content_RememberMeCB");
  if (await remember.count()) await remember.check();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    page.locator("#ctl00_Content_LoginBtn").click(),
  ]);
  if (page.url().toLowerCase().includes(LOGIN)) throw new Error("JunkWare sign-in was not accepted.");
  await page.goto(TRUCK_RECORDS_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
}

async function ensureAuthenticated(page: Page): Promise<void> {
  await page.goto(TRUCK_RECORDS_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (page.url().toLowerCase().includes(LOGIN)) await logIn(page);
  if (!page.url().startsWith(ORIGIN) || page.url().toLowerCase().includes(LOGIN)) {
    throw new Error("The authenticated JunkWare Truck Records page did not load.");
  }
}

async function persistStorageState(context: BrowserContext): Promise<void> {
  const target = storageStateFile();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  await context.storageState({ path: target });
  fs.chmodSync(target, 0o600);
}

export function junkwareTruckRecordReceiptNumber(messageId: string): string {
  if (messageId.startsWith("wex:")) return `WEX-${messageId.slice(4).replace(/[^A-Za-z0-9-]/g, "").slice(0, 32)}`;
  return `OB-${crypto.createHash("sha256").update(messageId).digest("hex").slice(0, 12).toUpperCase()}`;
}

function recordReceiptNumber(record: CrewExpenseRecord): string {
  return junkwareTruckRecordReceiptNumber(record.receiptMessageId || record.messageId);
}

function truckNumber(truck: string): number {
  const match = clean(truck).match(/^(?:truck\s*#?\s*|t\s*#?\s*)?(\d{1,3})$/i);
  const value = Number(match?.[1]);
  if (!Number.isInteger(value) || value <= 0) throw new Error("The JunkWare truck number is invalid.");
  return value;
}

function junkwareDate(date: string): string {
  const match = clean(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error("The JunkWare Truck Records date is invalid.");
  return `${match[2]}/${match[3]}/${match[1]}`;
}

async function submitAspNetForm(page: Page, eventTarget: string): Promise<void> {
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    page.evaluate(({ target }) => {
      const form = document.forms.namedItem("aspnetForm") || document.forms[0];
      const eventTargetInput = document.getElementById("__EVENTTARGET") as HTMLInputElement | null;
      const eventArgumentInput = document.getElementById("__EVENTARGUMENT") as HTMLInputElement | null;
      if (!form || !eventTargetInput || !eventArgumentInput) throw new Error("JunkWare ASP.NET form controls are unavailable.");
      eventTargetInput.value = target;
      eventArgumentInput.value = "";
      form.submit();
    }, { target: eventTarget }),
  ]);
}

async function selectDate(page: Page, date: string): Promise<void> {
  const expected = junkwareDate(date);
  const input = page.locator("#ctl00_Content_DateTB");
  if (!(await input.count())) throw new Error("The JunkWare Truck Records date control is unavailable.");
  if (clean(await input.inputValue()) === expected) return;
  await input.fill(expected);
  await submitAspNetForm(page, "ctl00$Content$DateTB");
  if (clean(await page.locator("#ctl00_Content_DateTB").inputValue()) !== expected) {
    throw new Error("JunkWare did not accept the Truck Records date.");
  }
}

async function selectTruck(page: Page, truck: number): Promise<void> {
  const rows = page.locator('[id*="TrucksLV"][id$="ItemRow"]');
  let selectedRow: Locator | null = null;
  for (let index = 0; index < await rows.count(); index += 1) {
    const row = rows.nth(index);
    const cells = (await row.locator("td").allTextContents()).map(clean);
    if (cells.includes(`Truck# ${truck}`)) {
      selectedRow = row;
      break;
    }
  }
  if (!selectedRow) throw new Error(`Truck# ${truck} is unavailable in JunkWare for this date.`);
  await selectedRow.locator('[id$="SelectButton"]').evaluate((element) => (element as HTMLElement).click());
  await page.locator('[id$="AddNewLink"]').waitFor({ state: "visible", timeout: 30_000 });
}

async function entryEvidence(page: Page, receipt: string): Promise<string> {
  const exact = page.getByText(receipt, { exact: true });
  if (!(await exact.count())) return "";
  const row = exact.first().locator("xpath=ancestor::tr[1]");
  return clean(await (await row.count() ? row.innerText() : exact.first().innerText())).slice(0, 1_000);
}

function expectedCategory(record: CrewExpenseRecord): "Dumps" | "Gas" {
  return record.kind === "fuel" ? "Gas" : "Dumps";
}

function evidenceMatches(evidence: string, record: CrewExpenseRecord, receipt: string): boolean {
  const amount = record.cost.toFixed(2);
  return Boolean(evidence)
    && evidence.includes(receipt)
    && evidence.includes(expectedCategory(record))
    && evidence.includes(record.location)
    && evidence.replace(/[$,]/g, "").includes(amount);
}

function entryDescription(record: CrewExpenseRecord): string {
  return record.kind === "fuel"
    ? `${record.source === "wex_posted" ? "WEX posted fuel" : "OpsBot fuel"}${record.gallons === null ? "" : ` · ${record.gallons} gal`}`
    : `OpsBot dump${record.weight ? ` · ${record.weight}` : ""}`;
}

async function saveEntry(page: Page, record: CrewExpenseRecord, receipt: string): Promise<void> {
  await page.locator('[id$="AddNewLink"]').evaluate((element) => (element as HTMLElement).click());
  const category = page.locator('[id$="CategoryDD"]');
  await category.waitFor({ state: "visible", timeout: 30_000 });
  await category.selectOption(record.kind === "fuel" ? "3" : "2");
  await page.locator('[id$="ReceiptNoTB"]').fill(receipt);
  await page.locator('[id$="LocationTB"]').fill(record.location.slice(0, 120));
  await page.locator('[id$="DescriptionTB"]').fill(entryDescription(record).slice(0, 120));
  await page.locator('[id$="AmountTB"]').fill(record.cost.toFixed(2));
  await page.locator('[id$="TimeTB"]').fill(record.time);
  await page.locator('[id$="InsertButton"]').evaluate((element) => (element as HTMLElement).click());
  await page.waitForFunction((marker) => document.body.innerText.includes(marker), receipt, { timeout: 30_000 });
}

type EntryEditor = {
  rowId: string;
  editId: string;
  updateId: string;
  editor: Locator;
  update: Locator;
  cancel: Locator;
};

async function openEntryEditor(page: Page, receipt: string): Promise<EntryEditor> {
  const exact = page.getByText(receipt, { exact: true });
  if (await exact.count() !== 1) throw new Error("The exact JunkWare Truck Records row is unavailable for correction.");
  const row = exact.locator("xpath=ancestor::tr[1]");
  const rowId = clean(await row.getAttribute("id"));
  if (!rowId) throw new Error("The JunkWare Truck Records row identity is unavailable for correction.");
  const editId = `${rowId.replace(/_ItemRow$/, "")}_EditButton`;
  const updateId = `${rowId.replace(/_ItemRow$/, "")}_UpdateButton`;
  const edit = page.locator(`#${editId}`);
  if (await edit.count() !== 1) throw new Error("The exact JunkWare Truck Records edit control is unavailable.");
  await edit.evaluate((element) => (element as HTMLElement).click());
  const update = page.locator(`#${updateId}`);
  await update.waitFor({ state: "visible", timeout: 30_000 });
  const editor = update.locator("xpath=ancestor::tr[1]");
  return { rowId, editId, updateId, editor, update, cancel: editor.locator('[id$="CancelButton"]') };
}

async function editorMatches(entry: EntryEditor, record: CrewExpenseRecord, receipt: string): Promise<boolean> {
  const category = clean(await entry.editor.locator('[id$="CategoryDD"]').inputValue());
  const savedReceipt = clean(await entry.editor.locator('[id$="ReceiptNoTB"]').inputValue());
  const location = clean(await entry.editor.locator('[id$="LocationTB"]').inputValue());
  const description = clean(await entry.editor.locator('[id$="DescriptionTB"]').inputValue());
  const amount = Number(clean(await entry.editor.locator('[id$="AmountTB"]').inputValue()).replace(/[$,]/g, ""));
  const time = clean(await entry.editor.locator('[id$="TimeTB"]').inputValue()).replace(/^0/, "");
  return category === (record.kind === "fuel" ? "3" : "2")
    && savedReceipt === receipt
    && location === record.location
    && description === entryDescription(record)
    && Number.isFinite(amount)
    && Math.abs(amount - record.cost) < 0.005
    && time.toUpperCase() === record.time.toUpperCase();
}

async function cancelEditor(page: Page, entry: EntryEditor): Promise<void> {
  if (await entry.cancel.count() !== 1) throw new Error("The JunkWare Truck Records cancel control is unavailable.");
  await entry.cancel.evaluate((element) => (element as HTMLElement).click());
  await page.locator(`#${entry.editId}`).waitFor({ state: "visible", timeout: 30_000 });
}

async function saveEditor(page: Page, entry: EntryEditor, previous: CrewExpenseRecord, corrected: CrewExpenseRecord, receipt: string): Promise<void> {
  const { editor, update } = entry;
  await editor.locator('[id$="CategoryDD"]').selectOption(corrected.kind === "fuel" ? "3" : "2");
  await editor.locator('[id$="ReceiptNoTB"]').fill(receipt);
  await editor.locator('[id$="LocationTB"]').fill(corrected.location.slice(0, 120));
  await editor.locator('[id$="DescriptionTB"]').fill(entryDescription(corrected).slice(0, 120));
  await editor.locator('[id$="AmountTB"]').fill(corrected.cost.toFixed(2));
  await editor.locator('[id$="TimeTB"]').fill(previous.time);
  await update.evaluate((element) => (element as HTMLElement).click());
  await page.locator(`#${entry.editId}`).waitFor({ state: "visible", timeout: 30_000 });
}

export type JunkwareTruckRecordVerification = {
  receiptNumber: string;
  category: "Dumps" | "Gas";
  amount: number;
  evidence: string;
  duplicate: boolean;
  corrected?: boolean;
};

export async function uploadJunkwareTruckRecord(record: CrewExpenseRecord): Promise<JunkwareTruckRecordVerification> {
  fs.mkdirSync(WRITE_LOCK, { mode: 0o700 });
  const stateFile = storageStateFile();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
    const page = await context.newPage();
    await ensureAuthenticated(page);
    await selectDate(page, record.date);
    await selectTruck(page, truckNumber(record.truck));
    const receipt = recordReceiptNumber(record);
    let evidence = await entryEvidence(page, receipt);
    const duplicate = Boolean(evidence);
    if (!evidence) {
      await saveEntry(page, record, receipt);
      evidence = await entryEvidence(page, receipt);
    }
    const category = expectedCategory(record);
    if (!evidenceMatches(evidence, record, receipt)) {
      throw new Error("JunkWare did not verify the saved Truck Records line item.");
    }
    await persistStorageState(context);
    return { receiptNumber: receipt, category, amount: record.cost, evidence, duplicate };
  } finally {
    await browser.close();
    try { fs.rmdirSync(WRITE_LOCK); } catch { /* worker lock cleanup is best effort */ }
  }
}

export async function correctJunkwareTruckRecord(
  previous: CrewExpenseRecord,
  corrected: CrewExpenseRecord,
): Promise<JunkwareTruckRecordVerification> {
  if (previous.date !== corrected.date || previous.truck !== corrected.truck || previous.kind !== corrected.kind) {
    throw new Error("A Truck Records correction cannot change its date, truck, or expense type.");
  }
  const receipt = recordReceiptNumber(previous);
  if (receipt !== recordReceiptNumber(corrected)) throw new Error("The Truck Records correction lost its original receipt identity.");
  fs.mkdirSync(WRITE_LOCK, { mode: 0o700 });
  const stateFile = storageStateFile();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
    const page = await context.newPage();
    await ensureAuthenticated(page);
    await selectDate(page, previous.date);
    await selectTruck(page, truckNumber(previous.truck));
    let evidence = await entryEvidence(page, receipt);
    if (!evidence) throw new Error("The original JunkWare Truck Records row is missing; no correction was submitted.");
    let editor = await openEntryEditor(page, receipt);
    const alreadyCorrected = await editorMatches(editor, corrected, receipt);
    if (alreadyCorrected) {
      await cancelEditor(page, editor);
    } else {
      if (!await editorMatches(editor, previous, receipt)) {
        await cancelEditor(page, editor);
        throw new Error("The original JunkWare Truck Records row changed; no correction was submitted.");
      }
      await saveEditor(page, editor, previous, corrected, receipt);
      evidence = await entryEvidence(page, receipt);
      editor = await openEntryEditor(page, receipt);
      const verified = await editorMatches(editor, corrected, receipt);
      await cancelEditor(page, editor);
      if (!verified) throw new Error("JunkWare did not retain every corrected Truck Records field.");
    }
    if (!evidenceMatches(evidence, corrected, receipt)) {
      throw new Error("JunkWare did not verify the corrected Truck Records line item.");
    }
    await persistStorageState(context);
    return {
      receiptNumber: receipt,
      category: expectedCategory(corrected),
      amount: corrected.cost,
      evidence,
      duplicate: alreadyCorrected,
      corrected: true,
    };
  } finally {
    await browser.close();
    try { fs.rmdirSync(WRITE_LOCK); } catch { /* worker lock cleanup is best effort */ }
  }
}
