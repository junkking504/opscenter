import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN_FRAGMENT = "/account/login.aspx";
const STORAGE_STATE = path.join(
  process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  "protected",
  "junkware_storage_state.json",
);

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function keychain(service: string): string {
  try {
    return execFileSync("security", ["find-generic-password", "-w", "-s", service], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim();
  } catch {
    return "";
  }
}

function environmentSecret(name: string): string {
  const encoded = String(process.env[`${name}_BASE64`] || "").trim();
  if (encoded) {
    try { return Buffer.from(encoded, "base64").toString("utf8"); } catch { return ""; }
  }
  return String(process.env[name] || "");
}

function decodeNote(value: string): string {
  try { return Buffer.from(value, "base64url").toString("utf8").trim(); } catch { return ""; }
}

function clean(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

async function logIn(page: Page, targetUrl: string): Promise<void> {
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
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) throw new Error("JunkWare sign-in was not accepted.");
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

async function ensureAuthenticated(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
  if (!page.url().startsWith(ORIGIN) || page.url().toLowerCase().includes(LOGIN_FRAGMENT)) throw new Error("The authenticated JunkWare appointment did not load.");
}

async function appointmentNoteCount(page: Page, note: string): Promise<number> {
  const needle = clean(note).toLowerCase();
  return page.locator("#other-notes-cont [id$='NoteLbl']").evaluateAll((nodes, expected) => nodes
    .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim().toLowerCase())
    .filter((text) => text.includes(expected)).length, needle);
}

async function openNoteEditor(page: Page): Promise<void> {
  const edit = page.locator("#ctl00_Content_EditOtherNotesLB");
  if (!(await edit.count())) throw new Error("The JunkWare appointment-notes control has changed.");
  await edit.click();
  await page.locator("#other-notes-dialog.in").waitFor({ state: "visible", timeout: 15_000 });
  const newItem = page.locator("#ctl00_Content_NotesLV_AddNewLink");
  if (!(await newItem.count())) throw new Error("JunkWare could not open appointment notes.");
  await newItem.click();
  await page.locator("#other-notes-cont textarea").waitFor({ state: "visible", timeout: 30_000 });
}

async function addNote(page: Page, note: string): Promise<void> {
  await openNoteEditor(page);
  await page.locator("#other-notes-cont textarea").fill(note);
  const save = page.locator("#other-notes-cont [id$='InsertButton']");
  if (!(await save.count())) throw new Error("The JunkWare appointment-note save control has changed.");
  const completion = Promise.race([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 60_000 }),
    page.locator("#ctl00_Content_NotesLV_AddNewLink").waitFor({ state: "visible", timeout: 60_000 }),
  ]);
  await save.click();
  await completion;
}

async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  const inspect = process.argv.includes("--inspect");
  const note = decodeNote(argument("note-base64"));
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment ID is required.");
  if (!inspect && (!note || note.length > 500)) throw new Error("A JunkWare appointment note of up to 500 characters is required.");

  const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${appointmentId}`;
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    await ensureAuthenticated(page, targetUrl);
    if (inspect) {
      await openNoteEditor(page);
      process.stdout.write(`${JSON.stringify({ ok: true, mode: "inspect-note", appointmentId })}\n`);
      await context.close();
      return;
    }
    const before = await appointmentNoteCount(page, note);
    await addNote(page, note);
    await ensureAuthenticated(page, targetUrl);
    const after = await appointmentNoteCount(page, note);
    if (after <= before) throw new Error("JunkWare did not retain the appointment note.");
    process.stdout.write(`${JSON.stringify({ ok: true, mode: "add-note", appointmentId, verifiedAt: new Date().toISOString() })}\n`);
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
