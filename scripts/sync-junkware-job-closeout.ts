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

type Option = { value: string; label: string };
type OtherChargeInput = { typeValue: string; quantity: string; price: string };
type CloseoutInput = {
  driverId: string;
  navigatorIds: string[];
  loadQuantity: string;
  loadSize: string;
  loadPrice: string;
  bedloadQuantity: string;
  bedloadSize: string;
  bedloadPrice: string;
  otherChargesToAdd: OtherChargeInput[];
  discount: string;
  tip: string;
  jobCategoryId: string;
  actualStartHour: string;
  actualStartMinute: string;
  actualEndHour: string;
  actualEndMinute: string;
  addPayment?: { methodId: string; amount: string } | null;
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
    throw new Error("The authenticated JunkWare appointment did not load.");
  }
}

async function capture(page: Page): Promise<{ status: { value: string }; [key: string]: unknown }> {
  return page.evaluate(String.raw`(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const selectData = (id) => {
      const select = document.getElementById(id);
      return {
        value: select?.value || "",
        label: select?.options[select.selectedIndex]?.text.trim() || "",
        options: select ? Array.from(select.options).map((option) => ({ value: option.value, label: option.text.trim() })) : [],
      };
    };
    const input = (id) => document.getElementById(id)?.value || "";
    const navigators = Array.from(document.querySelectorAll('select[id*="AppointmentTechniciansLV"][id$="NavigatorDD"]'));
    const payments = Array.from(document.querySelectorAll('[id*="PaymentsLV"][id$="ItemRow"]')).map((row) => {
      const cells = Array.from(row.querySelectorAll("td")).map((cell) => clean(cell.innerText || cell.textContent));
      return { description: cells[0] || "Payment", amount: cells[1] || "" };
    });
    const driver = selectData("ctl00_Content_DriverDD");
    const firstNavigator = navigators[0];
    const otherChargeLabels = Array.from(document.querySelectorAll('label[id*="MiscellaneousChargesLV"][id$="MiscChargeLbl"]'));
    const otherCharges = otherChargeLabels.map((label) => {
      const prefix = label.id.replace(/MiscChargeLbl$/, "");
      return {
        label: clean(label.textContent),
        quantity: input(prefix + "MCQuantityTB"),
        price: input(prefix + "MCPriceTB"),
        total: clean(document.getElementById(prefix + "MCTotalLbl")?.textContent),
      };
    });
    return {
      status: selectData("ctl00_Content_StatusDD"),
      driver: { value: driver.value, label: driver.label },
      drivers: driver.options,
      navigators: navigators.map((select) => ({ value: select.value, label: select.options[select.selectedIndex]?.text.trim() || "" })),
      navigatorOptions: firstNavigator ? Array.from(firstNavigator.options).map((option) => ({ value: option.value, label: option.text.trim() })) : driver.options,
      loadQuantity: input("ctl00_Content_LoadSizeTruckQtyTB"),
      loadSize: selectData("ctl00_Content_LoadSizeDD"),
      loadPrice: input("ctl00_Content_BillingAmountTB"),
      bedloadQuantity: input("ctl00_Content_BedloadTruckQtyTB"),
      bedloadSize: selectData("ctl00_Content_BedloadDD"),
      bedloadPrice: input("ctl00_Content_BedLoadPriceTB"),
      otherChargeOptions: selectData("ctl00_Content_OtherChargeDD").options,
      otherCharges,
      discount: input("ctl00_Content_DiscountsTB"),
      tip: input("ctl00_Content_TipsTB"),
      jobCategory: selectData("ctl00_Content_JobCategoryDD"),
      actualStartHour: selectData("ctl00_Content_ActualStartHourDD"),
      actualStartMinute: selectData("ctl00_Content_ActualStartMinuteDD"),
      actualEndHour: selectData("ctl00_Content_ActualEndHourDD"),
      actualEndMinute: selectData("ctl00_Content_ActualEndMinuteDD"),
      paymentMethods: selectData("ctl00_Content_PaymentMethodDD").options,
      payments,
      balance: input("ctl00_Content_BalanceOwedHF"),
      total: clean(document.getElementById("ctl00_Content_TotalLbl")?.textContent),
    };
  })()`) as Promise<{ status: { value: string }; [key: string]: unknown }>;
}

function cleanMoney(value: unknown): string {
  const cleaned = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!cleaned) return "";
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number < 0 || number > 1_000_000) throw new Error("A closeout amount is not valid.");
  return number.toFixed(2);
}

function cleanCount(value: unknown): string {
  const cleaned = String(value ?? "").trim();
  if (!cleaned) return "";
  const number = Number(cleaned);
  if (!Number.isFinite(number) || number < 0 || number > 100) throw new Error("A closeout quantity is not valid.");
  return String(number);
}

async function selectWithPostback(page: Page, selector: string, value: string): Promise<void> {
  const control = page.locator(selector);
  if (!(await control.count())) throw new Error(`A JunkWare closeout control is unavailable (${selector}).`);
  if (await control.inputValue() === value) return;
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    control.selectOption(value),
  ]);
}

async function fill(page: Page, selector: string, value: string): Promise<void> {
  const control = page.locator(selector);
  if (!(await control.count())) throw new Error(`A JunkWare closeout control is unavailable (${selector}).`);
  await control.fill(value);
}

function parsePayload(): CloseoutInput {
  const encoded = argument("payload-base64");
  if (!encoded) throw new Error("The closeout details are unavailable.");
  let payload: unknown;
  try { payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")); } catch { throw new Error("The closeout details are not valid."); }
  if (!payload || typeof payload !== "object") throw new Error("The closeout details are not valid.");
  const row = payload as Record<string, unknown>;
  const navigatorIds = Array.isArray(row.navigatorIds) ? row.navigatorIds.map(String).map((value) => value.trim()).filter(Boolean) : [];
  if (navigatorIds.length > 50 || new Set(navigatorIds).size !== navigatorIds.length) throw new Error("The crew assignment contains duplicates or too many people.");
  const rawOtherCharges = Array.isArray(row.otherChargesToAdd) ? row.otherChargesToAdd : [];
  if (rawOtherCharges.length > 20) throw new Error("Too many Other Charges were added at once.");
  const otherChargesToAdd = rawOtherCharges.map((charge) => {
    if (!charge || typeof charge !== "object") throw new Error("An Other Charge is not valid.");
    const item = charge as Record<string, unknown>;
    const typeValue = String(item.typeValue || "").trim();
    const quantity = cleanCount(item.quantity);
    const price = cleanMoney(item.price);
    const isPercentage = typeValue.split("|")[2] === "1";
    if (!typeValue || !quantity || (!isPercentage && !price)) throw new Error("Each Other Charge needs a type, quantity, and price.");
    return { typeValue, quantity, price };
  });
  return {
    driverId: String(row.driverId || "").trim(),
    navigatorIds,
    loadQuantity: cleanCount(row.loadQuantity),
    loadSize: String(row.loadSize || "").trim(),
    loadPrice: cleanMoney(row.loadPrice),
    bedloadQuantity: cleanCount(row.bedloadQuantity),
    bedloadSize: String(row.bedloadSize || "").trim(),
    bedloadPrice: cleanMoney(row.bedloadPrice),
    otherChargesToAdd,
    discount: cleanMoney(row.discount),
    tip: cleanMoney(row.tip),
    jobCategoryId: String(row.jobCategoryId || "").trim(),
    actualStartHour: String(row.actualStartHour || "").trim(),
    actualStartMinute: String(row.actualStartMinute || "").trim(),
    actualEndHour: String(row.actualEndHour || "").trim(),
    actualEndMinute: String(row.actualEndMinute || "").trim(),
    addPayment: row.addPayment && typeof row.addPayment === "object" ? {
      methodId: String((row.addPayment as Record<string, unknown>).methodId || "").trim(),
      amount: cleanMoney((row.addPayment as Record<string, unknown>).amount),
    } : null,
  };
}

async function applyCloseout(page: Page, input: CloseoutInput): Promise<void> {
  await selectWithPostback(page, "#ctl00_Content_StatusDD", "8");

  const currentNavigatorCount = await page.locator('select[id*="AppointmentTechniciansLV"][id$="NavigatorDD"]').count();
  if (currentNavigatorCount !== input.navigatorIds.length) {
    await fill(page, "#ctl00_Content_AdditionalNavigatorsTB", String(input.navigatorIds.length));
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
      page.locator("#ctl00_Content_AdditionalNavigatorsBtn").click(),
    ]);
  }

  const driver = page.locator("#ctl00_Content_DriverDD");
  if (!(await driver.count())) throw new Error("The JunkWare driver control is unavailable.");
  await driver.selectOption(input.driverId);

  for (let index = 0; index < input.navigatorIds.length; index += 1) {
    const selector = `#ctl00_Content_AppointmentTechniciansLV_ctrl${index}_NavigatorDD`;
    await selectWithPostback(page, selector, input.navigatorIds[index]);
  }

  await fill(page, "#ctl00_Content_LoadSizeTruckQtyTB", input.loadQuantity);
  await page.locator("#ctl00_Content_LoadSizeDD").selectOption(input.loadSize);
  await fill(page, "#ctl00_Content_BillingAmountTB", input.loadPrice);
  await fill(page, "#ctl00_Content_BedloadTruckQtyTB", input.bedloadQuantity);
  await page.locator("#ctl00_Content_BedloadDD").selectOption(input.bedloadSize);
  await fill(page, "#ctl00_Content_BedLoadPriceTB", input.bedloadPrice);
  await fill(page, "#ctl00_Content_DiscountsTB", input.discount);
  await fill(page, "#ctl00_Content_TipsTB", input.tip);
  await page.locator("#ctl00_Content_JobCategoryDD").selectOption(input.jobCategoryId);
  await page.locator("#ctl00_Content_ActualStartHourDD").selectOption(input.actualStartHour);
  await page.locator("#ctl00_Content_ActualStartMinuteDD").selectOption(input.actualStartMinute);
  await page.locator("#ctl00_Content_ActualEndHourDD").selectOption(input.actualEndHour);
  await page.locator("#ctl00_Content_ActualEndMinuteDD").selectOption(input.actualEndMinute);

  for (const charge of input.otherChargesToAdd) {
    const isPercentage = charge.typeValue.split("|")[2] === "1";
    await selectWithPostback(page, "#ctl00_Content_OtherChargeDD", charge.typeValue);
    if (!isPercentage) {
      await fill(page, "#ctl00_Content_OCQtyTB", charge.quantity);
      await fill(page, "#ctl00_Content_OCPriceTB", charge.price);
    }
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
      page.locator("#ctl00_Content_OCAddBtn").click(),
    ]);
  }

  if (input.addPayment?.methodId && input.addPayment.amount) {
    await selectWithPostback(page, "#ctl00_Content_PaymentMethodDD", input.addPayment.methodId);
    await fill(page, "#ctl00_Content_PaymentAmountTB", input.addPayment.amount);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
      page.locator("#ctl00_Content_AddPaymentBtn").click(),
    ]);
  }

  const save = page.locator("#ctl00_Content_SaveAppointmentBtn");
  if (!(await save.count())) throw new Error("The JunkWare closeout update control is unavailable.");
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    save.click(),
  ]);
}

async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  const mode = argument("mode") || "read";
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment ID is required.");
  if (!/^(read|write)$/.test(mode)) throw new Error("The closeout action is not valid.");
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
    if (mode === "write") {
      await applyCloseout(page, parsePayload());
      await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    }
    const closeout = await capture(page);
    if (mode === "write" && closeout.status.value !== "8") throw new Error("JunkWare did not retain the completed status.");
    process.stdout.write(`${JSON.stringify({ ok: true, mode, appointmentId, closeout, verifiedAt: new Date().toISOString() })}\n`);
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
