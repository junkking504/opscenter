import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN = "/account/login.aspx";
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
    return execFileSync("security", ["find-generic-password", "-w", "-s", service], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 10_000,
    }).trim();
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
  if (page.url().toLowerCase().includes(LOGIN)) throw new Error("JunkWare sign-in was not accepted.");
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

async function ensureAuthenticated(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (page.url().toLowerCase().includes(LOGIN)) await logIn(page, targetUrl);
  if (!page.url().startsWith(ORIGIN) || page.url().toLowerCase().includes(LOGIN)) {
    throw new Error("The authenticated JunkWare appointment did not load.");
  }
}

async function appointmentStatus(page: Page): Promise<{ value: string; label: string }> {
  const status = page.locator("#ctl00_Content_StatusDD");
  if ((await status.count()) !== 1) throw new Error("The JunkWare appointment status control has changed.");
  return status.evaluate((node) => {
    const select = node as HTMLSelectElement;
    return { value: select.value, label: select.options[select.selectedIndex]?.text.trim() || "" };
  });
}

async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment ID is required.");
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${appointmentId}`;
    await ensureAuthenticated(page, targetUrl);

    const before = await appointmentStatus(page);
    if (/complete/i.test(before.label) || before.value === "8") {
      throw new Error("Completed appointments cannot be canceled from OpsCenter.");
    }

    let changed = false;
    if (!/cancel/i.test(before.label) && before.value !== "9") {
      const status = page.locator("#ctl00_Content_StatusDD");
      const cancellationOption = status.locator("option", { hasText: /^Cancelled$/i }).first();
      if (!(await cancellationOption.count())) throw new Error("The JunkWare cancellation option is unavailable.");
      const cancellationValue = await cancellationOption.getAttribute("value") || "";
      const selected = await status.evaluate((node, value) => {
        const select = node as HTMLSelectElement;
        select.value = String(value);
        return select.value;
      }, cancellationValue);
      if (!selected || selected !== cancellationValue) throw new Error("The JunkWare cancellation option could not be selected.");

      const update = page.locator("#ctl00_Content_SaveAppointmentBtn");
      if ((await update.count()) !== 1) throw new Error("The JunkWare appointment update control has changed.");
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
        update.click(),
      ]);
      changed = true;
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    if (page.url().toLowerCase().includes(LOGIN)) await logIn(page, targetUrl);
    const verified = await appointmentStatus(page);
    if (!/cancel/i.test(verified.label) && verified.value !== "9") {
      throw new Error("JunkWare did not retain the canceled status.");
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: "cancel",
      appointmentId,
      previousStatus: before.label,
      status: "Canceled",
      changed,
      verifiedAt: new Date().toISOString(),
    })}\n`);
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
