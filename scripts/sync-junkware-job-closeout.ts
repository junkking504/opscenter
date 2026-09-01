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
    const pageText = clean(document.body?.innerText || document.body?.textContent);
    const jobNumber = pageText.match(/\bJK\d+\b/i)?.[0]?.toUpperCase() || "";
    const truckSelect =
      document.getElementById("ctl00_Content_TruckDD") ||
      document.querySelector('select[id$="TruckDD"], select[id*="Truck"][id$="DD"]');
    return {
      jobNumber,
      truck: truckSelect instanceof HTMLSelectElement
        ? clean(truckSelect.options[truckSelect.selectedIndex]?.textContent)
        : "",
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

async function selectWithoutPostback(page: Page, selector: string, value: string): Promise<void> {
  const control = page.locator(selector);
  if (!(await control.count())) throw new Error(`A JunkWare closeout control is unavailable (${selector}).`);
  const selected = await control.evaluate((node, nextValue) => {
    const select = node as HTMLSelectElement;
    if (!Array.from(select.options).some((option) => option.value === nextValue)) return false;
    select.value = nextValue;
    return select.value === nextValue;
  }, value);
  if (!selected) throw new Error(`A JunkWare closeout option is unavailable (${selector}).`);
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
  // JunkWare uses ASP.NET WebForms. Changing these selects with selectOption()
  // fires AutoPostBack and reloads the full appointment once per field. Set the
  // selected values directly so the final Save post submits them together.
  await selectWithoutPostback(page, "#ctl00_Content_StatusDD", "8");

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
  await selectWithoutPostback(page, "#ctl00_Content_DriverDD", input.driverId);

  for (let index = 0; index < input.navigatorIds.length; index += 1) {
    const selector = `#ctl00_Content_AppointmentTechniciansLV_ctrl${index}_NavigatorDD`;
    await selectWithoutPostback(page, selector, input.navigatorIds[index]);
  }

  await fill(page, "#ctl00_Content_LoadSizeTruckQtyTB", input.loadQuantity);
  await selectWithoutPostback(page, "#ctl00_Content_LoadSizeDD", input.loadSize);
  await fill(page, "#ctl00_Content_BillingAmountTB", input.loadPrice);
  await fill(page, "#ctl00_Content_BedloadTruckQtyTB", input.bedloadQuantity);
  await selectWithoutPostback(page, "#ctl00_Content_BedloadDD", input.bedloadSize);
  await fill(page, "#ctl00_Content_BedLoadPriceTB", input.bedloadPrice);
  await fill(page, "#ctl00_Content_DiscountsTB", input.discount);
  await fill(page, "#ctl00_Content_TipsTB", input.tip);
  await selectWithoutPostback(page, "#ctl00_Content_JobCategoryDD", input.jobCategoryId);
  await selectWithoutPostback(page, "#ctl00_Content_ActualStartHourDD", input.actualStartHour);
  await selectWithoutPostback(page, "#ctl00_Content_ActualStartMinuteDD", input.actualStartMinute);
  await selectWithoutPostback(page, "#ctl00_Content_ActualEndHourDD", input.actualEndHour);
  await selectWithoutPostback(page, "#ctl00_Content_ActualEndMinuteDD", input.actualEndMinute);

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

function row(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function selectedValue(value: unknown): string {
  return String(row(value).value || "");
}

function numericValue(value: unknown): number | null {
  const text = String(value ?? "").replace(/[^0-9.-]/g, "");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function sameNumber(left: unknown, right: unknown): boolean {
  const leftNumber = numericValue(left);
  const rightNumber = numericValue(right);
  return leftNumber === null && rightNumber === null
    ? true
    : leftNumber !== null && rightNumber !== null && Math.abs(leftNumber - rightNumber) < 0.005;
}

function optionLabel(optionsValue: unknown, value: string): string {
  if (!Array.isArray(optionsValue)) return "";
  const option = optionsValue.find((candidate) => String(row(candidate).value || "") === value);
  return String(row(option).label || "").replace(/\s+/g, " ").trim();
}

function chargeSignature(value: unknown): string {
  const charge = row(value);
  return [
    String(charge.label || "").replace(/\s+/g, " ").trim().toLowerCase(),
    numericValue(charge.quantity),
    numericValue(charge.price),
  ].join("|");
}

function paymentSignature(value: unknown): string {
  const payment = row(value);
  return [
    String(payment.description || "").replace(/\s+/g, " ").trim().toLowerCase(),
    numericValue(payment.amount),
  ].join("|");
}

function removePriorRows(beforeValue: unknown, afterValue: unknown, signature: (value: unknown) => string): unknown[] {
  const remaining = Array.isArray(afterValue) ? [...afterValue] : [];
  for (const prior of Array.isArray(beforeValue) ? beforeValue : []) {
    const index = remaining.findIndex((candidate) => signature(candidate) === signature(prior));
    if (index < 0) throw new Error("JunkWare changed an existing closeout row while applying the request.");
    remaining.splice(index, 1);
  }
  return remaining;
}

function verifyCloseout(
  closeout: { status: { value: string }; [key: string]: unknown },
  input: CloseoutInput,
  before: { status: { value: string }; [key: string]: unknown },
): void {
  if (closeout.status.value !== "8") throw new Error("JunkWare did not retain the completed status.");
  const driver = closeout.driver && typeof closeout.driver === "object"
    ? String((closeout.driver as Record<string, unknown>).value || "")
    : "";
  const navigators = Array.isArray(closeout.navigators)
    ? closeout.navigators.map((row) => row && typeof row === "object" ? String((row as Record<string, unknown>).value || "") : "").filter(Boolean)
    : [];
  if (driver !== input.driverId) throw new Error("JunkWare did not retain the selected driver.");
  if (navigators.length !== input.navigatorIds.length || navigators.some((value, index) => value !== input.navigatorIds[index])) {
    throw new Error("JunkWare did not retain the selected navigators.");
  }
  const exactSelects: Array<[string, string, string]> = [
    ["loadSize", input.loadSize, "load size"],
    ["bedloadSize", input.bedloadSize, "bedload size"],
    ["jobCategory", input.jobCategoryId, "job category"],
    ["actualStartHour", input.actualStartHour, "actual start hour"],
    ["actualStartMinute", input.actualStartMinute, "actual start minute"],
    ["actualEndHour", input.actualEndHour, "actual end hour"],
    ["actualEndMinute", input.actualEndMinute, "actual end minute"],
  ];
  for (const [field, expected, label] of exactSelects) {
    if (selectedValue(closeout[field]) !== expected) throw new Error(`JunkWare did not retain the selected ${label}.`);
  }
  const exactNumbers: Array<[string, string, string]> = [
    ["loadQuantity", input.loadQuantity, "truck quantity"],
    ["loadPrice", input.loadPrice, "load price"],
    ["bedloadQuantity", input.bedloadQuantity, "bedload quantity"],
    ["bedloadPrice", input.bedloadPrice, "bedload price"],
    ["discount", input.discount, "discount"],
    ["tip", input.tip, "tip"],
  ];
  for (const [field, expected, label] of exactNumbers) {
    if (!sameNumber(closeout[field], expected)) throw new Error(`JunkWare did not retain the selected ${label}.`);
  }

  const addedCharges = removePriorRows(before.otherCharges, closeout.otherCharges, chargeSignature);
  if (addedCharges.length !== input.otherChargesToAdd.length) {
    throw new Error("JunkWare did not retain the exact requested Other Charges.");
  }
  for (const requested of input.otherChargesToAdd) {
    const label = optionLabel(before.otherChargeOptions, requested.typeValue).toLowerCase();
    const isPercentage = requested.typeValue.split("|")[2] === "1";
    const index = addedCharges.findIndex((candidate) => {
      const charge = row(candidate);
      const sameLabel = String(charge.label || "").replace(/\s+/g, " ").trim().toLowerCase() === label;
      return sameLabel && (isPercentage || (sameNumber(charge.quantity, requested.quantity) && sameNumber(charge.price, requested.price)));
    });
    if (index < 0) throw new Error("JunkWare did not retain a requested Other Charge.");
    addedCharges.splice(index, 1);
  }

  const addedPayments = removePriorRows(before.payments, closeout.payments, paymentSignature);
  if (input.addPayment) {
    const label = optionLabel(before.paymentMethods, input.addPayment.methodId).toLowerCase();
    if (addedPayments.length !== 1) throw new Error("JunkWare did not retain exactly one requested payment.");
    const payment = row(addedPayments[0]);
    if (
      String(payment.description || "").replace(/\s+/g, " ").trim().toLowerCase() !== label
      || !sameNumber(payment.amount, input.addPayment.amount)
    ) throw new Error("JunkWare did not retain the requested payment method and amount.");
  } else if (addedPayments.length) {
    throw new Error("JunkWare added an unrequested payment.");
  }
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
    const input = mode === "write" ? parsePayload() : null;
    const before = await capture(page);
    if (input) await applyCloseout(page, input);
    const closeout = await capture(page);
    if (input) verifyCloseout(closeout, input, before);
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
