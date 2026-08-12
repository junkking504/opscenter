import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
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

function receiptNumber(messageId: string): string {
  return `OB-${crypto.createHash("sha256").update(messageId).digest("hex").slice(0, 12).toUpperCase()}`;
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
  const selectId = await page.locator('[id*="TrucksLV"][id$="ItemRow"]').evaluateAll((rows, number) => {
    const expected = `Truck# ${number}`.toLowerCase();
    for (const row of rows) {
      const cells = Array.from(row.querySelectorAll("td"));
      if (!cells.some((cell) => (cell.textContent || "").replace(/\s+/g, " ").trim().toLowerCase() === expected)) continue;
      return row.querySelector<HTMLElement>('[id$="SelectButton"]')?.id || "";
    }
    return "";
  }, truck);
  if (!selectId) throw new Error(`Truck# ${truck} is unavailable in JunkWare for this date.`);
  await page.locator(`#${selectId}`).evaluate((element) => (element as HTMLElement).click());
  await page.locator('[id$="AddNewLink"]').waitFor({ state: "visible", timeout: 30_000 });
}

async function entryEvidence(page: Page, receipt: string): Promise<string> {
  return page.locator("body").evaluate((body, marker) => {
    const tidy = (value: string | null | undefined) => String(value || "").replace(/\s+/g, " ").trim();
    const candidates = Array.from(body.querySelectorAll('[id*="EntriesLV"]'));
    const exact = candidates.find((element) => tidy(element.textContent) === marker);
    if (!exact) return "";
    let current: Element | null = exact;
    let evidence = tidy(exact.textContent);
    for (let depth = 0; depth < 7 && current; depth += 1, current = current.parentElement) {
      const text = tidy(current.textContent);
      if (text.includes(marker) && text.length >= evidence.length && text.length <= 1_000) evidence = text;
    }
    return evidence.slice(0, 1_000);
  }, receipt);
}

async function saveEntry(page: Page, record: CrewExpenseRecord, receipt: string): Promise<void> {
  await page.locator('[id$="AddNewLink"]').evaluate((element) => (element as HTMLElement).click());
  const category = page.locator('[id$="CategoryDD"]');
  await category.waitFor({ state: "visible", timeout: 30_000 });
  await category.selectOption(record.kind === "fuel" ? "3" : "2");
  await page.locator('[id$="ReceiptNoTB"]').fill(receipt);
  await page.locator('[id$="LocationTB"]').fill(record.location.slice(0, 120));
  const description = record.kind === "fuel"
    ? `OpsBot fuel${record.gallons === null ? "" : ` · ${record.gallons} gal`}`
    : `OpsBot dump${record.weight ? ` · ${record.weight}` : ""}`;
  await page.locator('[id$="DescriptionTB"]').fill(description.slice(0, 120));
  await page.locator('[id$="AmountTB"]').fill(record.cost.toFixed(2));
  await page.locator('[id$="TimeTB"]').fill(record.time);
  await page.locator('[id$="InsertButton"]').evaluate((element) => (element as HTMLElement).click());
  await page.waitForFunction((marker) => document.body.innerText.includes(marker), receipt, { timeout: 30_000 });
}

export type JunkwareTruckRecordVerification = {
  receiptNumber: string;
  category: "Dumps" | "Gas";
  amount: number;
  evidence: string;
  duplicate: boolean;
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
    const receipt = receiptNumber(record.messageId);
    let evidence = await entryEvidence(page, receipt);
    const duplicate = Boolean(evidence);
    if (!evidence) {
      await saveEntry(page, record, receipt);
      evidence = await entryEvidence(page, receipt);
    }
    const expectedCategory = record.kind === "fuel" ? "Gas" : "Dumps";
    const expectedAmount = record.cost.toFixed(2);
    if (!evidence || !evidence.includes(receipt) || !evidence.includes(expectedCategory) || !evidence.replace(/[$,]/g, "").includes(expectedAmount)) {
      throw new Error("JunkWare did not verify the saved Truck Records line item.");
    }
    await persistStorageState(context);
    return { receiptNumber: receipt, category: expectedCategory, amount: record.cost, evidence, duplicate };
  } finally {
    await browser.close();
    try { fs.rmdirSync(WRITE_LOCK); } catch { /* worker lock cleanup is best effort */ }
  }
}
