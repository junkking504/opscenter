import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { matchesExactJkReference, type WhatsAppPhotoCategory } from "@/lib/whatsapp-job-photo-matching";
import { newVerifiedAppointmentMedia } from "@/lib/verified-job-photos";
import { junkwarePhotoPageIdentity, verifyJunkwarePhotoPostbackIdentity } from "@/lib/junkware-photo-identity";

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

async function appointmentMediaUrls(page: Page): Promise<string[]> {
  return page.evaluate(() => [...new Set(
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
  )]);
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
    const titleJk = String(await page.title());
    await persistStorageState(context);
    return matchesExactJkReference(titleJk, jkNumber) ? appointmentId : null;
  } finally {
    await browser.close();
  }
}

type PhotoUploadInput = {
  appointmentId: string;
  jkNumber: string;
  filePath: string;
  category: WhatsAppPhotoCategory;
};
type PhotoUploadResult = { beforeCount: number; afterCount: number; mediaUrls: string[]; galleryUrls: string[]; galleryObservedAt: string; identityReadbackReason?: string };

export function createJunkwarePhotoUploadSession(dependencies: {
  launch?: () => Promise<Browser>;
  persist?: (context: BrowserContext) => Promise<void>;
} = {}) {
  let browser: Browser | undefined;
  let context: BrowserContext | undefined;
  let page: Page | undefined;
  let busy = false;
  let closed = false;
  const discard = async () => {
    const previous = browser;
    browser = undefined; context = undefined; page = undefined;
    await previous?.close().catch(() => {});
  };
  const upload = async (input: PhotoUploadInput): Promise<PhotoUploadResult> => {
    if (closed) throw new Error("The JunkWare upload session is closed.");
    if (busy) throw new Error("JunkWare photo uploads must remain sequential.");
    busy = true;
    try {
      if (!/^\d{1,12}$/.test(input.appointmentId)) throw new Error("The JunkWare appointment ID is invalid.");
      if (!/^JK\d{4,12}$/i.test(input.jkNumber)) throw new Error("The JK number is invalid.");
      const resolvedFile = fs.realpathSync(input.filePath);
      const stats = fs.statSync(resolvedFile);
      if (!stats.isFile() || !stats.size || stats.size > 5 * 1024 * 1024) throw new Error("The WhatsApp photo file is invalid.");

      if (!browser) {
        const stateFile = storageStateFile();
        browser = await (dependencies.launch || (() => chromium.launch({ headless: true })))();
        context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
        page = await context.newPage();
      }
      const activePage = page!;
      const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${encodeURIComponent(input.appointmentId)}`;
      const current = await activePage.evaluate(() => ({ url: location.href, title: document.title }));
      if (!junkwarePhotoPageIdentity(current.url, current.title, input.appointmentId, input.jkNumber)) {
        await ensureAuthenticated(activePage, targetUrl);
      }
      const identity = await activePage.evaluate(() => ({ url: location.href, title: document.title }));
      if (!junkwarePhotoPageIdentity(identity.url, identity.title, input.appointmentId, input.jkNumber)) {
        throw new Error("JunkWare loaded a different JK appointment than the matched job.");
      }

      const beforeMedia = await appointmentMediaUrls(activePage);
      const beforeCount = beforeMedia.length;
      const fileInput = activePage.locator("#ctl00_Content_FileUpload1");
      const uploadButton = activePage.locator("#ctl00_Content_AddImageBtn");
      const categorySelector = input.category === "before"
        ? "#ctl00_Content_ImageBeforeRB"
        : input.category === "donation"
          ? "#ctl00_Content_ImageDonationRB"
          : "#ctl00_Content_ImageAfterRB";
      if (!(await fileInput.count()) || !(await uploadButton.count()) || !(await activePage.locator(categorySelector).count())) {
        throw new Error("The JunkWare photo upload controls are unavailable.");
      }
      await fileInput.setInputFiles(resolvedFile);
      // JunkWare visually hides these radio inputs behind their styled labels,
      // so a normal Playwright click cannot reach them. Set the native form
      // state and emit the same change event before submitting the form.
      const categorySelected = await activePage.locator(categorySelector).evaluate((element) => {
        const input = element as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input.checked;
      });
      if (!categorySelected) throw new Error("The JunkWare photo category could not be selected.");
      await Promise.all([
        activePage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
        uploadButton.evaluate((element) => (element as HTMLInputElement).click()),
      ]);
      if (activePage.url().toLowerCase().includes(LOGIN)) throw new Error("JunkWare signed out during photo upload.");
      const identityReadbackReason = await verifyJunkwarePhotoPostbackIdentity({
        appointmentId: input.appointmentId,
        jkNumber: input.jkNumber,
        readIdentity: () => activePage.evaluate(() => ({ url: location.href, title: document.title })),
        // A POST response can have temporary navigation/title state. Read the
        // pre-verified appointment once; never repeat the upload to reconcile it.
        readAppointment: async () => { await activePage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 }); },
      });
      const afterMedia = await appointmentMediaUrls(activePage);
      const galleryObservedAt = new Date().toISOString();
      const afterCount = afterMedia.length;
      if (afterCount <= beforeCount) throw new Error("JunkWare did not confirm a new appointment photo.");
      const fileStem = path.parse(resolvedFile).name;
      const mediaUrls = newVerifiedAppointmentMedia(beforeMedia, afterMedia, input.appointmentId).filter(url => {
        const uploaded = path.parse(decodeURIComponent(new URL(url).pathname)).name;
        // JunkWare supplies its own category suffix (for example Donation Rcpt).
        // The materialized message hash, bounded as a filename segment, is the
        // ownership evidence; the selected radio already verifies the category.
        return uploaded.includes(`-${fileStem}-`) || uploaded.endsWith(`-${fileStem}`);
      });
      if (!mediaUrls.length) throw new Error("JunkWare did not expose a verified new image for this appointment.");
      await (dependencies.persist || persistStorageState)(context!);
      return { beforeCount, afterCount, mediaUrls, galleryUrls: afterMedia, galleryObservedAt, ...(identityReadbackReason ? { identityReadbackReason } : {}) };
    } catch (error) {
      // The owning queue records uncertain outcomes; discard state, never resubmit.
      await discard();
      throw error;
    } finally { busy = false; }
  };
  return { upload, close: async () => { closed = true; await discard(); } };
}

export async function uploadJunkwareJobPhoto(input: PhotoUploadInput): Promise<PhotoUploadResult> {
  const session = createJunkwarePhotoUploadSession();
  try { return await session.upload(input); }
  finally { await session.close(); }
}
