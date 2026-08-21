import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { clickWithWebFormsCompletion, selectWithWebFormsPostback } from "./junkware-webforms";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN_FRAGMENT = "/account/login.aspx";
const STORAGE_STATE = path.join(process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"), "protected", "junkware_storage_state.json");

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? String(process.argv[index + 1] || "").trim() : "";
}

function keychain(service: string): string {
  try { return execFileSync("security", ["find-generic-password", "-w", "-s", service], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).trim(); } catch { return ""; }
}

function environmentSecret(name: string): string {
  const encoded = String(process.env[`${name}_BASE64`] || "").trim();
  if (encoded) {
    try { return Buffer.from(encoded, "base64").toString("utf8"); } catch { return ""; }
  }
  return String(process.env[name] || "");
}

async function logIn(page: Page, targetUrl: string): Promise<void> {
  const username = environmentSecret("JUNKWARE_USERNAME").trim() || keychain("opsbot-junkware-username");
  const password = environmentSecret("JUNKWARE_PASSWORD") || keychain("opsbot-junkware-password");
  if (!username || !password) throw new Error("JunkWare credentials are unavailable.");
  const usernameField = page.locator("#ctl00_Content_UsernameTB").first();
  const passwordField = page.locator("#ctl00_Content_PasswordTB").first();
  if (!(await usernameField.count()) || !(await passwordField.count())) throw new Error("The JunkWare sign-in form has changed.");
  await usernameField.fill(username);
  await passwordField.fill(password);
  const remember = page.locator("#ctl00_Content_RememberMeCB").first();
  if (await remember.count()) await remember.check();
  await Promise.all([page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }), page.locator("#ctl00_Content_LoginBtn").click()]);
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) throw new Error("JunkWare sign-in was not accepted.");
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

async function ensureAuthenticated(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
  if (!page.url().startsWith(ORIGIN) || page.url().toLowerCase().includes(LOGIN_FRAGMENT)) throw new Error("The authenticated JunkWare appointment did not load.");
}

function dateKey(value: string): string {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error("The JunkWare appointment date is unavailable.");
  return `${match[3]}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

function displayDate(date: string): string {
  const [year, month, day] = date.split("-");
  return `${Number(month)}/${Number(day)}/${year}`;
}

function clockMinutes(value: string): number | null {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === "PM") hour += 12;
  return hour * 60 + Number(match[2]);
}

function clockValue(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  const date = argument("date");
  const appointmentStartMinutes = Number(argument("start-minutes"));
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment ID is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("A valid appointment date is required.");
  if (!Number.isInteger(appointmentStartMinutes) || appointmentStartMinutes < 0 || appointmentStartMinutes >= 24 * 60 || appointmentStartMinutes % 60 !== 0) throw new Error("A valid hourly appointment start time is required.");

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}) });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${appointmentId}`;
    await ensureAuthenticated(page, targetUrl);

    const dateField = page.locator("#ctl00_Content_AppointmentDateTB").first();
    const startField = page.locator("#ctl00_Content_StartTimeTB").first();
    const availableTimes = page.locator("#ctl00_Content_AvailableTimesDD").first();
    const save = page.locator("#ctl00_Content_SaveAppointmentBtn").first();
    if (!(await dateField.count()) || !(await startField.count()) || !(await availableTimes.count()) || !(await save.count())) throw new Error("The JunkWare reschedule controls have changed.");

    const previousDate = dateKey(await dateField.inputValue());
    const previousAppointmentStartMinutes = clockMinutes(await startField.inputValue());
    if (previousAppointmentStartMinutes == null) throw new Error("The JunkWare appointment time is unavailable.");
    const changed = previousDate !== date || previousAppointmentStartMinutes !== appointmentStartMinutes;
    if (changed) {
      // The date travels with the available-time postback, allowing JunkWare to
      // validate the destination slot before the final Update commits either change.
      await dateField.fill(displayDate(date));
      const timeValue = clockValue(appointmentStartMinutes);
      if (!(await availableTimes.locator(`option[value="${timeValue}"]`).count())) throw new Error("That start time is not available for this appointment in JunkWare.");
      await selectWithWebFormsPostback(page, "#ctl00_Content_AvailableTimesDD", timeValue, "the appointment time selection");
      if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
      const selectedDate = dateKey(await page.locator("#ctl00_Content_AppointmentDateTB").inputValue());
      const selectedStart = clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
      if (selectedDate !== date || selectedStart !== appointmentStartMinutes) throw new Error("JunkWare did not retain the requested date and time before the update.");
      await clickWithWebFormsCompletion(page, "#ctl00_Content_SaveAppointmentBtn", "the appointment reschedule");
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
    const verifiedDate = dateKey(await page.locator("#ctl00_Content_AppointmentDateTB").inputValue());
    const verifiedAppointmentStartMinutes = clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
    if (verifiedDate !== date || verifiedAppointmentStartMinutes !== appointmentStartMinutes) throw new Error("JunkWare did not retain the requested appointment date and time.");
    process.stdout.write(`${JSON.stringify({ ok: true, mode: "reschedule", appointmentId, previousDate, previousAppointmentStartMinutes, date, appointmentStartMinutes, changed, verifiedAt: new Date().toISOString() })}\n`);
    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
