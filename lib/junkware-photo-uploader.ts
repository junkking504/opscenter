import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "@playwright/test";
import type { WhatsAppPhotoCategory } from "@/lib/whatsapp-job-photo-matching";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN = "/account/login.aspx";

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

function storageStateFile(): string {
  const dataDirectory = process.env.OPSBOT_DATA_DIR
    || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data");
  return path.join(dataDirectory, "protected", "junkware_storage_state.json");
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
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
}

async function ensureAuthenticated(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
  if (page.url().toLowerCase().includes(LOGIN)) await logIn(page, targetUrl);
  if (!page.url().startsWith(ORIGIN) || page.url().toLowerCase().includes(LOGIN)) {
    throw new Error("The authenticated JunkWare appointment did not load.");
  }
}

async function appointmentMediaCount(page: Page): Promise<number> {
  return page.evaluate(() => new Set(
    Array.from(document.querySelectorAll("a[href],img[src]"))
      .map((node) => node.getAttribute(node instanceof HTMLAnchorElement ? "href" : "src") || "")
      .flatMap((raw) => {
        try {
          const url = new URL(raw, location.href);
          return url.hostname === "junkware.junk-king.com"
            && url.pathname.toLowerCase().startsWith("/system/aspnet/local/media/")
            && /\.(?:jpe?g|png|webp)$/i.test(url.pathname)
            ? [url.href]
            : [];
        } catch {
          return [];
        }
      }),
  ).size);
}

async function persistStorageState(context: BrowserContext): Promise<void> {
  const target = storageStateFile();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  await context.storageState({ path: target });
  fs.chmodSync(target, 0o600);
}

export async function findJunkwareAppointmentIdByJkNumber(inputJkNumber: string): Promise<string | null> {
  const jkNumber = inputJkNumber.replace(/\s+/g, "").toUpperCase();
  if (!/^JK\d{4,12}$/.test(jkNumber)) throw new Error("The JK number is invalid.");
  const appointmentIdNumber = Number(jkNumber.slice(2)) - 13_178;
  if (!Number.isSafeInteger(appointmentIdNumber) || appointmentIdNumber < 1) return null;
  const appointmentId = String(appointmentIdNumber);

  const stateFile = storageStateFile();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
    const page = await context.newPage();
    await ensureAuthenticated(page, `${ORIGIN}/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}`);
    const titleJk = String(await page.title()).replace(/\s+/g, "").toUpperCase();
    await persistStorageState(context);
    return titleJk.includes(jkNumber) ? appointmentId : null;
  } finally {
    await browser.close();
  }
}

export async function uploadJunkwareJobPhoto(input: {
  appointmentId: string;
  jkNumber: string;
  filePath: string;
  category: WhatsAppPhotoCategory;
}): Promise<{ beforeCount: number; afterCount: number }> {
  if (!/^\d{1,12}$/.test(input.appointmentId)) throw new Error("The JunkWare appointment ID is invalid.");
  if (!/^JK\d{4,12}$/i.test(input.jkNumber)) throw new Error("The JK number is invalid.");
  const resolvedFile = fs.realpathSync(input.filePath);
  const stats = fs.statSync(resolvedFile);
  if (!stats.isFile() || !stats.size || stats.size > 5 * 1024 * 1024) throw new Error("The WhatsApp photo file is invalid.");

  const stateFile = storageStateFile();
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
    const page = await context.newPage();
    const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${encodeURIComponent(input.appointmentId)}`;
    await ensureAuthenticated(page, targetUrl);
    const titleJk = String(await page.title()).replace(/\s+/g, "").toUpperCase();
    if (!titleJk.includes(input.jkNumber.replace(/\s+/g, "").toUpperCase())) {
      throw new Error("JunkWare loaded a different JK appointment than the matched job.");
    }

    const beforeCount = await appointmentMediaCount(page);
    const fileInput = page.locator("#ctl00_Content_FileUpload1");
    const uploadButton = page.locator("#ctl00_Content_AddImageBtn");
    const categorySelector = input.category === "before"
      ? "#ctl00_Content_ImageBeforeRB"
      : input.category === "donation"
        ? "#ctl00_Content_ImageDonationRB"
        : "#ctl00_Content_ImageAfterRB";
    if (!(await fileInput.count()) || !(await uploadButton.count()) || !(await page.locator(categorySelector).count())) {
      throw new Error("The JunkWare photo upload controls are unavailable.");
    }
    await fileInput.setInputFiles(resolvedFile);
    // JunkWare visually hides these radio inputs behind their styled labels,
    // so a normal Playwright click cannot reach them. Set the native form
    // state and emit the same change event before submitting the form.
    const categorySelected = await page.locator(categorySelector).evaluate((element) => {
      const input = element as HTMLInputElement;
      input.checked = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return input.checked;
    });
    if (!categorySelected) throw new Error("The JunkWare photo category could not be selected.");
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
      uploadButton.evaluate((element) => (element as HTMLInputElement).click()),
    ]);
    if (page.url().toLowerCase().includes(LOGIN)) throw new Error("JunkWare signed out during photo upload.");
    const afterCount = await appointmentMediaCount(page);
    if (afterCount <= beforeCount) throw new Error("JunkWare did not confirm a new appointment photo.");
    await persistStorageState(context);
    return { beforeCount, afterCount };
  } finally {
    await browser.close();
  }
}
