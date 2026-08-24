import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN = "/account/login.aspx";
const SEARCH_URL = `${ORIGIN}/franchise/search.aspx`;
const STORAGE_STATE = path.join(
  process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  "protected",
  "junkware_storage_state.json",
);
const MAX_PAGES = 25;
const MAX_RESULTS = 500;

export type JunkwareAppointmentSearchQuery = {
  startDate?: string;
  endDate?: string;
  appointmentType?: string;
  status?: string;
  jkNumber?: string;
  firstName?: string;
  lastName?: string;
  company?: string;
  email?: string;
  phone?: string;
  address?: string;
  checkNumber?: string;
  followupStartDate?: string;
  followupEndDate?: string;
  poNumber?: string;
  franchise?: string;
};

export type JunkwareAppointmentSearchResult = {
  appointmentId: string | null;
  date: string;
  time: string;
  jkNumber: string;
  appointmentType: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  paymentType: string;
  total: string;
  status: string;
};

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
    throw new Error("The authenticated JunkWare search page did not load.");
  }
}

async function fillQuery(page: Page, query: JunkwareAppointmentSearchQuery): Promise<void> {
  if (query.startDate) await page.locator("#ctl00_Content_StartDateTB").fill(query.startDate);
  if (query.endDate) await page.locator("#ctl00_Content_EndDateTB").fill(query.endDate);
  if (query.appointmentType) await page.locator("#ctl00_Content_AppointmentTypeDD").selectOption(query.appointmentType);
  if (query.status) await page.locator("#ctl00_Content_StatusDD").selectOption(query.status);
  if (query.jkNumber) await page.locator("#ctl00_Content_AppointmentCodeTB").fill(query.jkNumber);
  if (query.firstName) await page.locator("#ctl00_Content_FirstNameTB").fill(query.firstName);
  if (query.lastName) await page.locator("#ctl00_Content_LastNameTB").fill(query.lastName);
  if (query.company) await page.locator("#ctl00_Content_CompanyTB").fill(query.company);
  if (query.email) await page.locator("#ctl00_Content_EmailTB").fill(query.email);
  if (query.phone) await page.locator("#ctl00_Content_PhoneTB").fill(query.phone);
  if (query.address) await page.locator("#ctl00_Content_AddressTB").fill(query.address);
  if (query.checkNumber) await page.locator("#ctl00_Content_CheckNoTB").fill(query.checkNumber);
  if (query.followupStartDate) await page.locator("#ctl00_Content_FUStartDateTB").fill(query.followupStartDate);
  if (query.followupEndDate) await page.locator("#ctl00_Content_FUEndDateTB").fill(query.followupEndDate);
  if (query.poNumber) await page.locator("#ctl00_Content_PONumberTB").fill(query.poNumber);
  if (query.franchise) await page.locator("#ctl00_Content_FranchiseDD").selectOption(query.franchise);

  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null),
    page.locator("#ctl00_Content_SubmitBtn").click(),
  ]);
  if (page.url().toLowerCase().includes(LOGIN)) throw new Error("JunkWare session expired while searching appointments.");
}

function appointmentIdFromOnclick(onclick: string | null): string | null {
  if (!onclick) return null;
  const match = onclick.match(/id=(\d+)/);
  return match ? match[1] : null;
}

async function readCurrentPageRows(page: Page): Promise<JunkwareAppointmentSearchResult[]> {
  const rows = page.locator("table.list tr.list-item");
  const count = await rows.count();
  const results: JunkwareAppointmentSearchResult[] = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    const cells = row.locator("td");
    const cellCount = await cells.count();
    if (cellCount < 7) continue;
    const [onclick, date, time, jkAndType, customerBlock, paymentType, total, status] = await Promise.all([
      row.getAttribute("onclick"),
      cells.nth(0).innerText(),
      cells.nth(1).innerText(),
      cells.nth(2).innerText(),
      cells.nth(3).innerText(),
      cells.nth(4).innerText(),
      cells.nth(5).innerText(),
      cells.nth(6).innerText(),
    ]);
    const jkLines = jkAndType.trim().split("\n").map((line) => line.trim());
    const customerLines = customerBlock.trim().split("\n").map((line) => line.trim());
    const [namePhone, ...addressLines] = customerLines;
    const [customerName, customerPhone] = (namePhone || "").split(",").map((part) => part.trim());
    results.push({
      appointmentId: appointmentIdFromOnclick(onclick),
      date: date.trim(),
      time: time.trim(),
      jkNumber: jkLines[0] || "",
      appointmentType: jkLines[1] || "",
      customerName: customerName || "",
      customerPhone: customerPhone || "",
      customerAddress: addressLines.join(", "),
      paymentType: paymentType.trim(),
      total: total.trim(),
      status: status.trim(),
    });
    if (results.length >= MAX_RESULTS) break;
  }
  return results;
}

async function hasNextPage(page: Page): Promise<boolean> {
  const nextButton = page.locator("#ctl00_Content_ListView1_DataPager1_ctl00_NextPageBtn");
  if (!(await nextButton.count())) return false;
  const disabled = await nextButton.getAttribute("disabled");
  return disabled === null;
}

async function goToNextPage(page: Page): Promise<void> {
  const nextButton = page.locator("#ctl00_Content_ListView1_DataPager1_ctl00_NextPageBtn");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null),
    nextButton.click(),
  ]);
  if (page.url().toLowerCase().includes(LOGIN)) throw new Error("JunkWare session expired while paginating search results.");
}

async function readAllPages(page: Page): Promise<{ results: JunkwareAppointmentSearchResult[]; hasMorePages: boolean }> {
  const all: JunkwareAppointmentSearchResult[] = [];
  let pageIndex = 0;
  let truncated = false;
  for (;;) {
    all.push(...(await readCurrentPageRows(page)));
    pageIndex += 1;
    if (all.length >= MAX_RESULTS) { truncated = await hasNextPage(page); break; }
    if (pageIndex >= MAX_PAGES) { truncated = await hasNextPage(page); break; }
    if (!(await hasNextPage(page))) break;
    await goToNextPage(page);
  }
  return { results: all, hasMorePages: truncated };
}

async function main(): Promise<void> {
  const query: JunkwareAppointmentSearchQuery = {
    startDate: argument("start"),
    endDate: argument("end"),
    appointmentType: argument("type"),
    status: argument("status"),
    jkNumber: argument("jk"),
    firstName: argument("first-name"),
    lastName: argument("last-name"),
    company: argument("company"),
    email: argument("email"),
    phone: argument("phone"),
    address: argument("address"),
    checkNumber: argument("check-no"),
    followupStartDate: argument("fu-start"),
    followupEndDate: argument("fu-end"),
    poNumber: argument("po-number"),
    franchise: argument("franchise"),
  };

  const hasAnyCriterion = Object.values(query).some((value) => Boolean(value));
  if (!hasAnyCriterion) throw new Error("At least one search field is required.");

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    await ensureAuthenticated(page, SEARCH_URL);
    await fillQuery(page, query);

    const { results, hasMorePages } = await readAllPages(page);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: "appointment-search",
      results,
      hasMorePages,
      searchedAt: new Date().toISOString(),
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
