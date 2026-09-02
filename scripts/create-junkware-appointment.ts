import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";
import {
  normalizeJunkwareAppointmentCreationInput,
  type JunkwareAppointmentCreationInput,
  type JunkwareAppointmentCreationResult,
} from "../lib/junkware-appointment-creation";
import {
  clickWithWebFormsCompletion,
  sanitizeJunkwareCustomerEmail,
  selectWithWebFormsPostback,
  setInputWithWebFormsPostback,
} from "./junkware-webforms";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN = "/account/login.aspx";
const NEW_APPOINTMENT_URL = `${ORIGIN}/franchise/new-appointment.aspx`;
const STORAGE_STATE = path.join(
  process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  "protected",
  "junkware_storage_state.json",
);

let stage: "preflight" | "saving" | "verifying" = "preflight";

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
    try {
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return String(process.env[name] || "");
}

async function readInput(): Promise<JunkwareAppointmentCreationInput> {
  let source = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) source += chunk;
  return normalizeJunkwareAppointmentCreationInput(JSON.parse(source || "{}"));
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
    throw new Error("The authenticated JunkWare appointment page did not load.");
  }
}

async function persistStorageState(context: BrowserContext): Promise<void> {
  fs.mkdirSync(path.dirname(STORAGE_STATE), { recursive: true, mode: 0o700 });
  await context.storageState({ path: STORAGE_STATE });
  fs.chmodSync(STORAGE_STATE, 0o600);
}

function normalized(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function phoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

function dateForJunkware(value: string): string {
  const [year, month, day] = value.split("-");
  return `${month}/${day}/${year}`;
}

function isoDate(value: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return "";
  return `${match[3]}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

function time24(value: string): string {
  const text = value.trim();
  const direct = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (direct && !/[ap]m/i.test(text)) return `${direct[1].padStart(2, "0")}:${direct[2]}`;
  const twelveHour = text.match(/\b(1[0-2]|0?\d):([0-5]\d)\s*([ap])\.?m\.?/i);
  if (!twelveHour) return "";
  let hour = Number(twelveHour[1]) % 12;
  if (twelveHour[3].toLowerCase() === "p") hour += 12;
  return `${String(hour).padStart(2, "0")}:${twelveHour[2]}`;
}

async function setValue(page: Page, selector: string, value: string): Promise<void> {
  const control = page.locator(selector).first();
  if (!(await control.count())) throw new Error(`A required JunkWare field is unavailable (${selector}).`);
  await control.evaluate((node, nextValue) => {
    (node as HTMLInputElement | HTMLTextAreaElement).value = nextValue;
  }, value);
}

async function setRadio(page: Page, selector: string): Promise<void> {
  const control = page.locator(selector).first();
  if (!(await control.count())) throw new Error(`A required JunkWare customer field is unavailable (${selector}).`);
  await control.evaluate((node) => {
    const radio = node as HTMLInputElement;
    const group = radio.form?.elements.namedItem(radio.name);
    const radios = group instanceof RadioNodeList ? Array.from(group) : [radio];
    for (const item of radios) if (item instanceof HTMLInputElement) item.checked = item === radio;
  });
}

async function optionByText(page: Page, selector: string, requested: string, aliases: string[] = []): Promise<{ value: string; text: string }> {
  const options = await page.locator(`${selector} option`).evaluateAll((nodes) => nodes.map((node) => ({
    value: (node as HTMLOptionElement).value,
    text: (node.textContent || "").replace(/\s+/g, " ").trim(),
  })));
  const candidates = [requested, ...aliases].map(normalized);
  const match = options.find((option) => candidates.includes(normalized(option.text)) || candidates.includes(normalized(option.value)));
  if (!match?.value) throw new Error(`JunkWare does not offer ${requested} for this appointment.`);
  return match;
}

async function setSelectValue(page: Page, selector: string, value: string): Promise<void> {
  const control = page.locator(selector).first();
  if (!(await control.count())) throw new Error(`A required JunkWare selection is unavailable (${selector}).`);
  await control.evaluate((node, nextValue) => {
    const select = node as HTMLSelectElement;
    if (!Array.from(select.options).some((option) => option.value === nextValue)) throw new Error("The requested JunkWare option is unavailable.");
    select.value = nextValue;
  }, value);
}

async function chooseFranchise(page: Page, input: JunkwareAppointmentCreationInput): Promise<void> {
  const franchise = await optionByText(page, "#ctl00_FranchiseDD", `Junk King ${input.franchise}`);
  await selectWithWebFormsPostback(page, "#ctl00_FranchiseDD", franchise.value, "the franchise selection");
}

async function chooseCustomer(page: Page, input: JunkwareAppointmentCreationInput): Promise<"existing" | "new"> {
  await page.locator("#ctl00_Content_FirstNameTB").fill(input.firstName);
  await page.locator("#ctl00_Content_LastNameTB").fill(input.lastName);
  await page.locator("#ctl00_Content_Phone1TB").fill(input.phone);
  await clickWithWebFormsCompletion(page, "#ctl00_Content_SearchBtn", "the customer search");
  await page.waitForFunction(() => Boolean(
    document.querySelector("#ctl00_Content_NewAccountBtn")
    || document.querySelector("[id^='ctl00_Content_CustomerLV_'][id$='_ItemRow']"),
  ), undefined, { timeout: 30_000 });

  const rows = page.locator("[id^='ctl00_Content_CustomerLV_'][id$='_ItemRow']");
  const exactIndexes: number[] = [];
  for (let index = 0; index < await rows.count(); index += 1) {
    const text = (await rows.nth(index).innerText()).replace(/\s+/g, " ").trim();
    const normalizedText = normalized(text);
    const nameMatch = normalizedText.includes(normalized(input.firstName))
      && normalizedText.includes(normalized(input.lastName));
    const phoneMatch = phoneDigits(text).includes(input.phone);
    if (nameMatch && phoneMatch) exactIndexes.push(index);
  }
  if (exactIndexes.length > 1) throw new Error("Multiple JunkWare customer records match this name and phone. Resolve the customer match in JunkWare before booking.");
  if (exactIndexes.length === 1) {
    await clickWithWebFormsCompletion(page, `#${await rows.nth(exactIndexes[0]).getAttribute("id")}`, "the existing customer selection");
    await page.locator("#ctl00_Content_SaveAppointmentBtn").waitFor({ state: "attached", timeout: 30_000 });
    return "existing";
  }

  const newAccount = page.locator("#ctl00_Content_NewAccountBtn").first();
  if (!(await newAccount.count())) throw new Error("JunkWare did not provide a safe new-customer option after the customer search.");
  await clickWithWebFormsCompletion(page, "#ctl00_Content_NewAccountBtn", "the new customer selection");
  await page.locator("#ctl00_Content_SaveAppointmentBtn").waitFor({ state: "attached", timeout: 30_000 });
  return "new";
}

async function fillCustomer(page: Page, input: JunkwareAppointmentCreationInput, customerMode: "existing" | "new"): Promise<void> {
  if (customerMode === "new") {
    await setValue(page, "#ctl00_Content_FirstNameTB", input.firstName);
    await setValue(page, "#ctl00_Content_LastNameTB", input.lastName);
    await setRadio(page, input.business ? "#ctl00_Content_BusinessYesNoRBL_0" : "#ctl00_Content_BusinessYesNoRBL_1");
    await setValue(page, "#ctl00_Content_CompanyTB", input.business ? input.company : "");
    await setValue(page, "#ctl00_Content_Phone1TB", input.phone);
    await setValue(page, "#ctl00_Content_EmailTB", input.email);
    await setValue(page, "#ctl00_Content_BillingAddressTB", input.billingAddress);
    await setInputWithWebFormsPostback(page, "#ctl00_Content_BillingZipTB", input.billingZip, "the billing ZIP update");
  }

  const howHeard = page.locator("#ctl00_Content_HowHeardDD").first();
  if (!(await howHeard.count())) throw new Error("The JunkWare referral-source control has changed.");
  if (customerMode === "new" || !(await howHeard.inputValue())) {
    const aliases: Record<string, string[]> = {
      "Google - Ads": ["Google - Google Adwords"],
      "Google - Search": ["Google - Google Organic"],
      "Google - Maps": ["Google - Maps"],
      "Print/Direct Mail - Direct Mail": ["Print/Direct Mail"],
    };
    const option = await optionByText(page, "#ctl00_Content_HowHeardDD", input.howHeard, aliases[input.howHeard] || []);
    await setSelectValue(page, "#ctl00_Content_HowHeardDD", option.value);
  }
  const billingEmail = page.locator("#ctl00_Content_BillingEmailTB").first();
  if (input.billingEmail && await billingEmail.count()) await setValue(page, "#ctl00_Content_BillingEmailTB", input.billingEmail);
}

async function fillAppointment(page: Page, input: JunkwareAppointmentCreationInput): Promise<void> {
  await setInputWithWebFormsPostback(page, "#ctl00_Content_AppointmentZipTB", input.serviceZip, "the service ZIP update");
  await setValue(page, "#ctl00_Content_AppointmentAddressTB", input.serviceAddress);
  await setValue(page, "#ctl00_Content_ServiceContactNameTB", input.serviceContactName);
  await setValue(page, "#ctl00_Content_ServiceContactPhoneTB", input.serviceContactPhone);
  await setInputWithWebFormsPostback(page, "#ctl00_Content_AppointmentDateTB", dateForJunkware(input.date), "the appointment date update");
  await selectWithWebFormsPostback(
    page,
    "#ctl00_Content_AppointmentTypeDD",
    input.appointmentType === "Estimate" ? "1" : "2",
    "the appointment category update",
  );
  await selectWithWebFormsPostback(page, "#ctl00_Content_DurationDD", String(input.durationHours), "the appointment duration update");

  const time = await optionByText(page, "#ctl00_Content_AvailableTimesDD", input.startTime, [input.startTime.replace(/^0/, "")]);
  await selectWithWebFormsPostback(page, "#ctl00_Content_AvailableTimesDD", time.value, "the appointment time selection");
  const selectedStart = time24(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
  if (selectedStart !== input.startTime) throw new Error("JunkWare did not retain the selected appointment time.");

  const truckNumber = input.truck.replace("Truck ", "");
  const truck = await optionByText(page, "#ctl00_Content_TruckDD", `Truck# ${truckNumber}`, [`Truck ${truckNumber}`]);
  await setSelectValue(page, "#ctl00_Content_TruckDD", truck.value);

  const itemIndex = 3 + input.estimatedPickups * 2;
  const loadItem = page.locator(`#ctl00_Content_ItemsCBL_${itemIndex}`).first();
  if (!(await loadItem.count())) throw new Error("The JunkWare load-size options have changed.");
  await loadItem.evaluate((node) => { (node as HTMLInputElement).checked = true; });

  const noteParts = [
    `Work: ${input.scope}`,
    input.notes,
    input.duplicateOverrideReason ? `Duplicate reviewed in OpsCenter: ${input.duplicateOverrideReason}` : "",
  ].filter(Boolean);
  await setValue(page, "#ctl00_Content_AppointmentNotesTB", noteParts.join("\n").slice(0, 2_000));
}

async function saveAndRequireNavigation(page: Page): Promise<void> {
  const save = page.locator("#ctl00_Content_SaveAppointmentBtn").first();
  if (!(await save.count())) throw new Error("The JunkWare appointment save control has changed.");
  let resolveDialog: ((message: string) => void) | null = null;
  const dialogMessage = new Promise<string>((resolve) => { resolveDialog = resolve; });
  const onDialog = async (dialog: { message(): string; dismiss(): Promise<void> }) => {
    const message = dialog.message().trim();
    await dialog.dismiss();
    resolveDialog?.(message || "JunkWare blocked the appointment save.");
  };
  page.once("dialog", onDialog);
  const navigation = page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }).then(
    () => ({ kind: "navigation" as const }),
    () => ({ kind: "timeout" as const }),
  );
  try {
    await save.evaluate((node) => (node as HTMLInputElement).click());
    const outcome = await Promise.race([
      navigation,
      dialogMessage.then((message) => ({ kind: "dialog" as const, message })),
    ]);
    if (outcome.kind === "dialog") throw new Error(`JunkWare blocked the appointment save: ${outcome.message}`);
    if (outcome.kind === "timeout") throw new Error("JunkWare did not finish saving the appointment within 90 seconds.");
  } finally {
    page.off("dialog", onDialog);
  }
}

async function selectedText(page: Page, selector: string): Promise<string> {
  return page.locator(selector).first().evaluate((node) => {
    const select = node as HTMLSelectElement;
    return select.options[select.selectedIndex]?.text.replace(/\s+/g, " ").trim() || "";
  });
}

async function readBack(page: Page, input: JunkwareAppointmentCreationInput, customerMode: "existing" | "new"): Promise<JunkwareAppointmentCreationResult> {
  let appointmentId = new URL(page.url()).searchParams.get("id") || "";
  let title = await page.title();
  let jkNumber = title.match(/\b(JK\d{4,12})\b/i)?.[1]?.toUpperCase() || "";
  if (!appointmentId && jkNumber) {
    const derivedId = Number(jkNumber.slice(2)) - 13_178;
    if (Number.isSafeInteger(derivedId) && derivedId > 0) appointmentId = String(derivedId);
  }
  if (!appointmentId) throw new Error("JunkWare saved without returning an appointment ID. Search JunkWare before retrying.");

  const appointmentUrl = `${ORIGIN}/franchise/appointment.aspx?id=${encodeURIComponent(appointmentId)}`;
  if (!page.url().includes(`/franchise/appointment.aspx`) || new URL(page.url()).searchParams.get("id") !== appointmentId) {
    await ensureAuthenticated(page, appointmentUrl);
  }
  title = await page.title();
  jkNumber = title.match(/\b(JK\d{4,12})\b/i)?.[1]?.toUpperCase() || "";
  if (!jkNumber) throw new Error("JunkWare did not return a JK number for the saved appointment.");

  const verified = {
    firstName: await page.locator("#ctl00_Content_FirstNameTB").inputValue(),
    lastName: await page.locator("#ctl00_Content_LastNameTB").inputValue(),
    phone: await page.locator("#ctl00_Content_Phone1TB").inputValue(),
    serviceAddress: await page.locator("#ctl00_Content_AppointmentAddressTB").inputValue(),
    serviceZip: await page.locator("#ctl00_Content_AppointmentZipTB").inputValue(),
    date: await page.locator("#ctl00_Content_AppointmentDateTB").inputValue(),
    startTime: await page.locator("#ctl00_Content_StartTimeTB").inputValue(),
    appointmentType: await selectedText(page, "#ctl00_Content_AppointmentTypeDD"),
    truck: await selectedText(page, "#ctl00_Content_TruckDD"),
    franchise: await selectedText(page, "#ctl00_FranchiseDD"),
  };
  if (normalized(verified.firstName) !== normalized(input.firstName)
      || normalized(verified.lastName) !== normalized(input.lastName)
      || phoneDigits(verified.phone) !== input.phone
      || normalized(verified.serviceAddress) !== normalized(input.serviceAddress)
      || verified.serviceZip.slice(0, 5) !== input.serviceZip.slice(0, 5)
      || isoDate(verified.date) !== input.date
      || time24(verified.startTime) !== input.startTime
      || normalized(verified.appointmentType) !== normalized(input.appointmentType)
      || !normalized(verified.truck).includes(normalized(input.truck))
      || !normalized(verified.franchise).includes(normalized(input.franchise))) {
    throw new Error("The JunkWare read-back did not match the reviewed appointment. Search JunkWare before retrying.");
  }

  return {
    appointmentId,
    jkNumber,
    appointmentUrl,
    franchise: input.franchise,
    date: input.date,
    startTime: input.startTime,
    durationHours: input.durationHours,
    truck: input.truck,
    appointmentType: input.appointmentType,
    customerMode,
    verifiedAt: new Date().toISOString(),
  };
}

async function main(): Promise<void> {
  const input = await readInput();
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    await ensureAuthenticated(page, NEW_APPOINTMENT_URL);
    await chooseFranchise(page, input);
    const customerMode = await chooseCustomer(page, input);
    await fillCustomer(page, input, customerMode);
    await fillAppointment(page, input);
    await sanitizeJunkwareCustomerEmail(page);

    stage = "saving";
    await saveAndRequireNavigation(page);
    stage = "verifying";
    const result = await readBack(page, input, customerMode);
    await persistStorageState(context);
    process.stdout.write(`${JSON.stringify({ ok: true, result })}\n`);
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const code = /available|offer/i.test(message) ? "appointment_option_unavailable" : "appointment_creation_failed";
  process.stderr.write(`${JSON.stringify({ ok: false, stage, code, error: message.slice(0, 300) })}\n`);
  process.exitCode = 1;
});
