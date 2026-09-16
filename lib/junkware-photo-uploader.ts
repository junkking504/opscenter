import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { matchesExactJkReference, type WhatsAppPhotoCategory } from "@/lib/whatsapp-job-photo-matching";
import { newVerifiedAppointmentMedia } from "@/lib/verified-job-photos";
import { junkwarePhotoIdentityIssue, junkwarePhotoPageIdentity, verifyJunkwarePhotoPostbackIdentity } from "@/lib/junkware-photo-identity";

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

export type PhotoUploadInput = {
  appointmentId: string;
  jkNumber: string;
  filePath: string;
  category: WhatsAppPhotoCategory;
};
export type PhotoUploadResult = { beforeCount: number; afterCount: number; mediaUrls: string[]; galleryUrls: string[]; galleryObservedAt: string; submittedAt?: string; batchSize?: number; identityReadbackReason?: string };

export type PhotoUploadBatchResult = {
  submitted: true;
  results: Array<
    { filePath: string; status: "verified"; verification: PhotoUploadResult }
    | { filePath: string; status: "uncertain"; error: string }
  >;
};
export const JUNKWARE_PHOTO_BATCH_MAX_FILES = 5;
export const JUNKWARE_PHOTO_BATCH_MAX_BYTES = 4.5 * 1024 * 1024;

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
  const uploadBatch = async (inputs: PhotoUploadInput[]): Promise<PhotoUploadBatchResult> => {
    if (closed) throw new Error("The JunkWare upload session is closed.");
    if (busy) throw new Error("JunkWare photo uploads must remain sequential.");
    busy = true;
    let submitted = false;
    try {
      if (!inputs.length || inputs.length > JUNKWARE_PHOTO_BATCH_MAX_FILES) throw new Error("A JunkWare photo batch must contain one to five files.");
      const input = inputs[0];
      if (!/^\d{1,12}$/.test(input.appointmentId)) throw new Error("The JunkWare appointment ID is invalid.");
      if (!/^JK\d{4,12}$/i.test(input.jkNumber)) throw new Error("The JK number is invalid.");
      if (!["before", "after", "donation"].includes(input.category)) throw new Error("The JunkWare photo category is invalid.");
      const resolvedFiles: string[] = [];
      const stems = new Set<string>();
      let totalBytes = 0;
      for (const member of inputs) {
        if (member.appointmentId !== input.appointmentId || member.jkNumber.toUpperCase() !== input.jkNumber.toUpperCase()
          || member.category !== input.category) throw new Error("JunkWare photo batches must share the exact appointment, JK and category.");
        const resolvedFile = fs.realpathSync(member.filePath);
        const stats = fs.statSync(resolvedFile);
        const stem = path.parse(resolvedFile).name;
        if (!stats.isFile() || !stats.size || stats.size > 5 * 1024 * 1024
          || !/^[a-f0-9]{64}$/.test(stem) || !/\.(?:jpe?g|png)$/i.test(resolvedFile)) throw new Error("The WhatsApp photo file is invalid.");
        if (stems.has(stem)) throw new Error("A JunkWare photo batch contains duplicate message files.");
        stems.add(stem); resolvedFiles.push(resolvedFile); totalBytes += stats.size;
      }
      if (inputs.length > 1 && totalBytes > JUNKWARE_PHOTO_BATCH_MAX_BYTES) throw new Error("The JunkWare photo batch exceeds the aggregate upload limit.");

      if (!browser) {
        const stateFile = storageStateFile();
        browser = await (dependencies.launch || (() => chromium.launch({ headless: true })))();
        context = await browser.newContext(fs.existsSync(stateFile) ? { storageState: stateFile } : {});
        // Verification reads source identity and exact media URLs from the DOM.
        // Loading every existing gallery image after each POST/GET adds no
        // evidence and competes with the originals being uploaded.
        await context.route("**/*", route => {
          const type = route.request().resourceType();
          return ["image", "media", "font"].includes(type) ? route.abort() : route.continue();
        });
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
      const hasStem = (url: string, stem: string) => {
        const uploaded = path.parse(decodeURIComponent(new URL(url).pathname)).name;
        // The message hash is a complete filename segment; source category
        // suffixes vary (for example Donation Rcpt).
        return uploaded.includes(`-${stem}-`) || uploaded.endsWith(`-${stem}`);
      };
      if (beforeMedia.some(url => [...stems].some(stem => hasStem(url, stem)))) {
        throw new Error("A requested photo already appears on this appointment; reconcile it without repeating the upload.");
      }
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
      if (inputs.length > 1 && !await fileInput.evaluate(element => (element as HTMLInputElement).multiple)) {
        throw new Error("The JunkWare photo input does not support multiple files.");
      }
      await fileInput.setInputFiles(resolvedFiles);
      // JunkWare hides native radios behind styled labels. Set the form value
      // and emit its change event once for this homogeneous group.
      const categorySelected = await activePage.locator(categorySelector).evaluate((element) => {
        const input = element as HTMLInputElement;
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
        return input.checked;
      });
      if (!categorySelected) throw new Error("The JunkWare photo category could not be selected.");
      submitted = true;
      const submittedAt = new Date().toISOString();
      let navigationFailed = false;
      try {
        await Promise.all([
          activePage.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
          uploadButton.evaluate((element) => (element as HTMLInputElement).click()),
        ]);
      } catch { navigationFailed = true; }
      let identityReadbackReason: string | null;
      if (navigationFailed) {
        // Submission may already have succeeded. One read-only navigation can
        // reconcile every file; there is never another form submission.
        await activePage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 });
        const state = await activePage.evaluate(() => ({ url: location.href, title: document.title }));
        const issue = junkwarePhotoIdentityIssue(state.url, state.title, input.appointmentId, input.jkNumber);
        if (issue) throw new Error(`JunkWare appointment identity did not verify after photo upload: ${issue}.`);
        identityReadbackReason = "upload navigation did not complete";
      } else {
        identityReadbackReason = await verifyJunkwarePhotoPostbackIdentity({
          appointmentId: input.appointmentId,
          jkNumber: input.jkNumber,
          readIdentity: () => activePage.evaluate(() => ({ url: location.href, title: document.title })),
          readAppointment: async () => { await activePage.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: 90_000 }); },
        });
      }
      const afterMedia = await appointmentMediaUrls(activePage);
      const galleryObservedAt = new Date().toISOString();
      const afterCount = afterMedia.length;
      const newMedia = newVerifiedAppointmentMedia(beforeMedia, afterMedia, input.appointmentId);
      const results: PhotoUploadBatchResult["results"] = inputs.map((member, index) => {
        const mediaUrls = newMedia.filter(url => hasStem(url, path.parse(resolvedFiles[index]).name));
        const error = afterCount <= beforeCount ? "JunkWare did not confirm a new appointment photo."
          : mediaUrls.length !== 1 ? "JunkWare did not expose a verified new image for this appointment." : "";
        if (error) return { filePath: member.filePath, status: "uncertain", error };
        return { filePath: member.filePath, status: "verified", verification: {
          beforeCount, afterCount, mediaUrls, galleryUrls: afterMedia, galleryObservedAt, submittedAt, batchSize: inputs.length,
          ...(identityReadbackReason ? { identityReadbackReason } : {}),
        } };
      });
      if (results.some(result => result.status === "uncertain")) await discard();
      else {
        // Session persistence is not upload evidence. Preserve a verified source
        // result if local browser-state persistence fails, and discard the session.
        try { await (dependencies.persist || persistStorageState)(context!); }
        catch { await discard(); }
      }
      return { submitted: true, results };
    } catch (error) {
      await discard();
      if (!submitted) throw error;
      const detail = error instanceof Error ? error.message : "JunkWare photo read-back failed.";
      return { submitted: true, results: inputs.map(input => ({ filePath: input.filePath, status: "uncertain", error: detail })) };
    } finally { busy = false; }
  };
  const upload = async (input: PhotoUploadInput): Promise<PhotoUploadResult> => {
    const result = (await uploadBatch([input])).results[0];
    if (result.status === "uncertain") throw new Error(result.error);
    return result.verification;
  };
  return { upload, uploadBatch, close: async () => { closed = true; await discard(); } };
}

export async function uploadJunkwareJobPhoto(input: PhotoUploadInput): Promise<PhotoUploadResult> {
  const session = createJunkwarePhotoUploadSession();
  try { return await session.upload(input); }
  finally { await session.close(); }
}
