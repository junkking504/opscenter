import { clickWithWebFormsCompletion, selectWithWebFormsPostback } from './junkware-webforms';
import { closeoutSourceVersion, verifyCloseoutFields, verifyAddedCloseoutCharges } from '../lib/desktop-closeout-contract';
import { classificationCompletionTimeWarning, parseClassificationChange, verifyClassificationChange, type ClassificationChange } from '../lib/appointment-classification';
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
type OtherChargeInput = { typeValue: string; quantity: string; price: string; sourceCalculatedPrice?: string };
type CloseoutInput = {
  expectedSourceVersion?: string;
  appointmentType?: string;
  estimateOutcome?: { reason: 'Price/Budget' | 'Date/Time' | 'Other'; explanation: string; noDiscountReason?: string };
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

async function capture(page: Page): Promise<{ status: { value: string; label: string }; [key: string]: unknown }> {
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
    const inlineScripts = Array.from(document.scripts).map((script) => script.textContent || '').join('\n');
    const priceList = (name) => {
      const match = inlineScripts.match(new RegExp('var\\s+' + name + '\\s*=\\s*new\\s+Array\\(([^)]*)\\)', 'i'));
      return match ? match[1].split(',').map((value) => Number(value.trim())).filter((value) => Number.isFinite(value) && value >= 0) : [];
    };
    const jobNumber = pageText.match(/\bJK\d+\b/i)?.[0]?.toUpperCase() || "";
    const truckSelect =
      document.getElementById("ctl00_Content_TruckDD") ||
      document.querySelector('select[id$="TruckDD"], select[id*="Truck"][id$="DD"]');
    return {
      jobNumber,
      truck: truckSelect instanceof HTMLSelectElement
        ? clean(truckSelect.options[truckSelect.selectedIndex]?.textContent)
        : "",
      truckOptions: truckSelect instanceof HTMLSelectElement ? Array.from(truckSelect.options).map(option=>({value:option.value,label:clean(option.textContent)})) : [],
      appointmentType: selectData("ctl00_Content_AppointmentTypeDD"),
      appointmentWindow: {startTime:input('ctl00_Content_StartTimeTB'),durationHours:selectData('ctl00_Content_DurationDD').value},
      status: selectData("ctl00_Content_StatusDD"),
      appointmentNotes: Array.from(document.querySelectorAll('[id*="NotesLV"][id$="NoteLbl"]')).map(node=>clean(node.textContent)),
      driver: { value: driver.value, label: driver.label },
      drivers: driver.options,
      navigators: navigators.map((select) => ({ value: select.value, label: select.options[select.selectedIndex]?.text.trim() || "" })),
      navigatorOptions: firstNavigator ? Array.from(firstNavigator.options).map((option) => ({ value: option.value, label: option.text.trim() })) : driver.options,
      loadQuantity: input("ctl00_Content_LoadSizeTruckQtyTB"),
      loadSize: selectData("ctl00_Content_LoadSizeDD"),
      loadPrices: priceList('Prices'),
      loadPrice: input("ctl00_Content_BillingAmountTB"),
      bedloadQuantity: input("ctl00_Content_BedloadTruckQtyTB"),
      bedloadSize: selectData("ctl00_Content_BedloadDD"),
      bedloadPrices: priceList('BedloadPrices'),
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
  })()`) as Promise<{ status: { value: string; label: string }; [key: string]: unknown }>;
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
  const appointmentType = ["Job", "Estimate"].includes(String(row.appointmentType)) ? String(row.appointmentType) : undefined;
  const rawOutcome = row.estimateOutcome;
  let estimateOutcome: CloseoutInput['estimateOutcome'];
  if (rawOutcome !== undefined) {
    const outcome = rawOutcome && typeof rawOutcome === 'object' ? rawOutcome as Record<string, unknown> : null;
    if (!outcome || appointmentType !== 'Estimate' || !['Price/Budget', 'Date/Time', 'Other'].includes(String(outcome.reason)) || typeof outcome.explanation !== 'string' || !outcome.explanation.trim() || outcome.explanation.length > 2000 || (outcome.noDiscountReason !== undefined && (typeof outcome.noDiscountReason !== 'string' || outcome.noDiscountReason.length > 2000))) {
      throw new Error('An estimate outcome and explanation are required before JunkWare can close this estimate.');
    }
    estimateOutcome = {
      reason: outcome.reason as 'Price/Budget' | 'Date/Time' | 'Other',
      explanation: outcome.explanation.trim(),
      ...(typeof outcome.noDiscountReason === 'string' && outcome.noDiscountReason.trim() ? { noDiscountReason: outcome.noDiscountReason.trim() } : {}),
    };
  }
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
    expectedSourceVersion: row.expectedSourceVersion ? String(row.expectedSourceVersion) : undefined,
    appointmentType,
    ...(estimateOutcome ? { estimateOutcome } : {}),
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

async function applyCloseout(page: Page, input: CloseoutInput, before: Record<string, unknown>): Promise<void> {
  // JunkWare uses ASP.NET WebForms. Changing these selects with selectOption()
  // fires AutoPostBack and reloads the full appointment once per field. Set the
  // selected values directly so the final Save post submits them together.
  const priorStatus = String((before.status as { value?: unknown } | undefined)?.value || '');
  const completingEstimate = input.appointmentType === 'Estimate' && priorStatus !== '8';
  if (completingEstimate && !input.estimateOutcome) {
    throw new Error('An estimate outcome and explanation are required before JunkWare can close this estimate.');
  }
  if (completingEstimate && !(Number(input.discount) > 0) && !input.estimateOutcome?.noDiscountReason) {
    throw new Error('JunkWare requires a reason why no discount was offered before closing this estimate.');
  }
  if (input.appointmentType) {
    const options = await page.locator('#ctl00_Content_AppointmentTypeDD option').evaluateAll(elements => elements.map(element => ({ value: (element as HTMLOptionElement).value, label: element.textContent?.trim() || '' })));
    const selected = options.find(option => option.label.toLowerCase() === input.appointmentType!.toLowerCase());
    if (!selected) throw new Error('The selected JunkWare appointment category is unavailable.');
    await selectWithPostback(page, '#ctl00_Content_AppointmentTypeDD', selected.value);
  }
  await selectWithoutPostback(page, "#ctl00_Content_StatusDD", "8");

  const currentNavigatorCount = await page.locator('select[id*="AppointmentTechniciansLV"][id$="NavigatorDD"]').count();
  if (currentNavigatorCount !== input.navigatorIds.length) {
    await fill(page, "#ctl00_Content_AdditionalNavigatorsTB", String(input.navigatorIds.length));
    // JunkWare can apply this as an ASP.NET partial postback. Waiting only for
    // a full navigation leaves a closeout blocked for 90 seconds when removing
    // its default empty navigator row.
    await clickWithWebFormsCompletion(page, "#ctl00_Content_AdditionalNavigatorsBtn", "the navigator count update");
    const updatedNavigatorCount = await page.locator('select[id*="AppointmentTechniciansLV"][id$="NavigatorDD"]').count();
    if (updatedNavigatorCount !== input.navigatorIds.length) throw new Error("JunkWare did not apply the requested navigator count.");
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
    const beforeCharge = await capture(page);
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
    const [savedCharge] = verifyAddedCloseoutCharges(await capture(page), beforeCharge, [charge], true);
    if (isPercentage) charge.sourceCalculatedPrice = String(savedCharge.price ?? "");
  }

  if (input.addPayment?.methodId && input.addPayment.amount) {
    await selectWithPostback(page, "#ctl00_Content_PaymentMethodDD", input.addPayment.methodId);
    await fill(page, "#ctl00_Content_PaymentAmountTB", input.addPayment.amount);
    await Promise.all([
      page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
      page.locator("#ctl00_Content_AddPaymentBtn").click(),
    ]);
  }

  // Capture final provider-calculated prices after all added charges/payment postbacks.
  const stagedCharges = verifyAddedCloseoutCharges(await capture(page), before, input.otherChargesToAdd, true);
  input.otherChargesToAdd.forEach((charge, index) => { if (charge.typeValue.split("|")[2] === "1") charge.sourceCalculatedPrice = String(stagedCharges[index].price ?? ""); });
  const submit = async (selector: string, eventTarget: string, description: string) => {
    const response = page.waitForResponse((value) => value.request().method() === 'POST'
      && new URL(value.url()).pathname.toLowerCase() === '/franchise/appointment.aspx'
      && new URLSearchParams(value.request().postData() || '').get('__EVENTTARGET') === eventTarget, { timeout: 30_000 })
      .then(async (value) => { await value.finished(); return value.ok(); }, () => false);
    await clickWithWebFormsCompletion(page, selector, description);
    if (!await response) throw new Error(`JunkWare did not confirm ${description}.`);
    await page.waitForLoadState('networkidle', { timeout: 15_000 });
  };
  await submit('#ctl00_Content_SaveAppointmentBtn', 'ctl00$Content$SaveAppointmentBtn', 'the closeout save');
  // JunkWare opens a second form for completed estimates. The first save only
  // presents that form; it does not complete the appointment yet.
  if (await page.locator('#ctl00_Content_UENoteOkBtn').isVisible()) {
    const outcome = input.estimateOutcome;
    if (!outcome) throw new Error('An estimate outcome and explanation are required before JunkWare can close this estimate.');
    await selectWithoutPostback(page, '#ctl00_Content_UEReasonDD', outcome.reason);
    await fill(page, '#ctl00_Content_UENoteTB', outcome.explanation);
    if (await page.locator('#ctl00_Content_UENoDiscountTB').isVisible()) {
      if (!outcome.noDiscountReason) throw new Error('JunkWare requires a reason why no discount was offered before closing this estimate.');
      await fill(page, '#ctl00_Content_UENoDiscountTB', outcome.noDiscountReason);
    }
    const sendPictures = page.locator('#ctl00_Content_SendPicturesCB');
    if (await sendPictures.count()) await sendPictures.evaluate((node) => { (node as HTMLInputElement).checked = false; });
    await submit('#ctl00_Content_UENoteOkBtn', 'ctl00$Content$UENoteOkBtn', 'the estimate outcome save');
  }
}

function verifyCloseout(closeout: { status: { value: string }; [key: string]: unknown }, input: CloseoutInput): void {
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
}

function verifyEstimateOutcome(closeout: Record<string, unknown>, before: Record<string, unknown>, input: CloseoutInput): void {
  if (!input.estimateOutcome) return;
  const previous = Array.isArray(before.appointmentNotes) ? before.appointmentNotes.map(String) : [];
  const current = Array.isArray(closeout.appointmentNotes) ? closeout.appointmentNotes.map(String) : [];
  const added = current.filter((note) => !previous.includes(note));
  const { reason, explanation, noDiscountReason } = input.estimateOutcome;
  const expected = `${reason}: ${explanation}${noDiscountReason ? `, no discount: ${noDiscountReason}` : ''}`.replace(/\s+/g, ' ').trim();
  if (added.length !== 1 || !added[0].startsWith(`${expected} (`)) throw new Error('JunkWare did not retain the estimate outcome notes.');
}

let writeStarted = false;
let failureCode = 'closeout_unavailable';
async function applyClassification(page: Page, change: ClassificationChange, before: Record<string,unknown>) {
  const currentType = before.appointmentType as {value:string;options:Option[]};
  const target = currentType.options.find(option=>option.label === change.appointmentType);
  const status = before.status as {value:string;label:string};
  if (!target || !['1','8'].includes(status.value)) throw new Error('This appointment cannot change type from its current source status.');
  if ((change.completeEstimate || status.value === '8') && !before.truck && !change.truck) throw new Error('JunkWare requires a truck to complete this appointment. Select its completion truck and review the change.');
  if (change.truck && before.truck) throw new Error('Use dispatch controls to change an existing truck assignment.');
  const truck = change.truck ? (before.truckOptions as Option[]).find(option=>option.label.replace(/Truck#?\s*/i,'Truck ').trim() === change.truck) : null;
  if (change.truck && !truck) throw new Error('The selected completion truck is unavailable in JunkWare.');
  const completingEstimate = change.appointmentType === 'Estimate' && (change.completeEstimate || status.value === '8');
  if (completingEstimate && !change.estimateOutcome) throw new Error('JunkWare requires an estimate outcome and explanation before completion.');
  if (completingEstimate && !(Number(String(before.discount || '').replace(/[^0-9.-]/g,'')) > 0) && !change.estimateOutcome?.noDiscountReason) throw new Error('JunkWare requires an explanation for why no discount was offered.');
  writeStarted = true;
  try {
    await selectWithWebFormsPostback(page,'#ctl00_Content_AppointmentTypeDD',target.value,'the appointment type');
    await page.waitForLoadState('networkidle',{timeout:15_000});
    if (truck) await selectWithWebFormsPostback(page,'#ctl00_Content_TruckDD',truck.value,'the completion truck');
    await page.waitForLoadState('networkidle',{timeout:15_000});
    // Dependent postbacks can reset pending selections; submit all intended
    // values together after they finish. Wait for the actual save response,
    // not only a spinner that may still be hidden before the request starts.
    await selectWithoutPostback(page,'#ctl00_Content_AppointmentTypeDD',target.value);
    if (truck) await selectWithoutPostback(page,'#ctl00_Content_TruckDD',truck.value);
    await selectWithoutPostback(page,'#ctl00_Content_StatusDD',change.completeEstimate ? '8' : status.value);
    verifyClassificationChange(before,await capture(page),change,false);
    // A classification correction must not email photos as a side effect.
    const sendPictures=page.locator('#ctl00_Content_SendPicturesCB');
    if(await sendPictures.count()) await sendPictures.evaluate(node=>{(node as HTMLInputElement).checked=false;});
    const submit = async (selector:string,eventTarget:string) => {
      const response=page.waitForResponse(value=>value.request().method()==='POST' && new URL(value.url()).pathname.toLowerCase()==='/franchise/appointment.aspx' && new URLSearchParams(value.request().postData() || '').get('__EVENTTARGET')===eventTarget,{timeout:30_000}).then(async value=>{await value.finished();return value.ok();},()=>false);
      await clickWithWebFormsCompletion(page,selector,'the appointment change');
      if(!await response) throw new Error('JunkWare did not confirm the appointment save response.');
      await page.waitForLoadState('networkidle',{timeout:15_000});
    };
    await submit('#ctl00_Content_SaveAppointmentBtn','ctl00$Content$SaveAppointmentBtn');
    // Completed estimates require a second, explicit outcome form. The first
    // successful HTTP response only opens this form and has not saved anything.
    if(await page.locator('#ctl00_Content_UENoteOkBtn').isVisible()) {
      if(!change.estimateOutcome) throw new Error('JunkWare requires estimate outcome notes before it can save.');
      await selectWithoutPostback(page,'#ctl00_Content_UEReasonDD',change.estimateOutcome.reason);
      await fill(page,'#ctl00_Content_UENoteTB',change.estimateOutcome.explanation);
      if(await page.locator('#ctl00_Content_UENoDiscountTB').isVisible()) {
        if(!change.estimateOutcome.noDiscountReason) throw new Error('JunkWare requires a reason why no discount was offered.');
        await fill(page,'#ctl00_Content_UENoDiscountTB',change.estimateOutcome.noDiscountReason);
      }
      if(await sendPictures.count()) await sendPictures.evaluate(node=>{(node as HTMLInputElement).checked=false;});
      await submit('#ctl00_Content_UENoteOkBtn','ctl00$Content$UENoteOkBtn');
    }
    const messages=await page.locator('[id*="Validation"],[id*="Error"],.alert-danger').allTextContents();
    if(messages.some(message=>message.trim())) throw new Error('JunkWare validation: '+messages.filter(message=>message.trim()).join(' ').slice(0,300));
    // Always read a fresh appointment page, including after partial postbacks.
    await page.goto(`${ORIGIN}/franchise/appointment.aspx?id=${argument('appointment')}`,{waitUntil:'domcontentloaded'});
    verifyClassificationChange(before,await capture(page),change);
  } catch (error) {
    await page.goto(`${ORIGIN}/franchise/appointment.aspx?id=${argument('appointment')}`,{waitUntil:'domcontentloaded'});
    const current = await capture(page);
    if (closeoutSourceVersion(current) === closeoutSourceVersion(before)) {
      writeStarted = false; failureCode = 'source_validation_rejected';
      throw error;
    }
    // A transport/navigation problem is not proof that Save failed.
    try {verifyClassificationChange(before,current,change);} catch {
      try {verifyClassificationChange(before,current,{...change,appointmentType:(before.appointmentType as {label:'Job'|'Estimate'}).label,completeEstimate:false,truck:undefined,estimateOutcome:undefined});writeStarted=false;failureCode='source_validation_rejected';} catch {/* Other source changes remain uncertain. */}
      throw new Error(`${error instanceof Error ? error.message : 'JunkWare did not confirm the save.'} Read-back: ${(current.appointmentType as {label:string}).label} / ${(current.status as {label:string}).label}.`);
    }
  }
}
async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  const mode = argument("mode") || "read";
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment ID is required.");
  if (!/^(read|write|classify)$/.test(mode)) throw new Error("The closeout action is not valid.");
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const storage = fs.existsSync(STORAGE_STATE) ? JSON.parse(fs.readFileSync(STORAGE_STATE,'utf8')) : undefined;
    if (storage?.cookies) storage.cookies=storage.cookies.filter((cookie:{name:string})=>cookie.name!=='ASP.NET_SessionId');
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...(storage ? {storageState:storage} : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${appointmentId}`;
    await ensureAuthenticated(page, targetUrl);
    if (mode === 'read' && argument('diagnostics') === 'classification') {
      const diagnostics = await page.evaluate(() => ({
        save: document.getElementById('ctl00_Content_SaveAppointmentBtn')?.outerHTML,
        type: document.getElementById('ctl00_Content_AppointmentTypeDD')?.getAttribute('onchange'),
        status: document.getElementById('ctl00_Content_StatusDD')?.getAttribute('onchange'),
        validators: Array.from(document.querySelectorAll('[id*="Validator"], [id*="Validation"]')).map(node => ({id:node.id,text:node.textContent?.trim(),control:node.getAttribute('controltovalidate')})),
        completionFields: ['LoadSizeHF','BedloadSizeHF','HowHeardDD','TruckDD','AppointmentTypeDD','StatusDD','AppointmentDateTB'].map(suffix => { const node=document.querySelector<HTMLInputElement | HTMLSelectElement>(`[id$="${suffix}"]`); return {field:suffix,value:node?.value || '',disabled:node?.disabled,label:node instanceof HTMLSelectElement ? node.selectedOptions[0]?.textContent?.trim() : undefined}; }),
      }));
      process.stdout.write(JSON.stringify({ok:true,diagnostics})+'\n');
      await context.close(); return;
    }
    const input = mode === "write" ? parsePayload() : null;
    const classification = mode === 'classify' ? parseClassificationChange(JSON.parse(Buffer.from(argument('payload-base64'),'base64url').toString('utf8'))) : null;
    const before = input || classification ? await capture(page) : undefined;
    if (input?.expectedSourceVersion && before && closeoutSourceVersion(before) !== input.expectedSourceVersion) { failureCode = 'source_version_conflict'; throw new Error('This JunkWare closeout changed. Reload and review it before saving.'); }
    if (input) { writeStarted = true; await applyCloseout(page, input, before!); }
    if (classification && before) {
      if (closeoutSourceVersion(before) !== classification.expectedSourceVersion) {failureCode='source_version_conflict';throw new Error('This JunkWare appointment changed. Reload and review it before saving.');}
      await applyClassification(page,classification,before);
    }
    const closeout = await capture(page);
    if (input) { verifyCloseout(closeout, input); verifyCloseoutFields(closeout, input, before); verifyEstimateOutcome(closeout, before!, input); }
    if (classification && before) verifyClassificationChange(before,closeout,classification);
    const warning = classification && before ? classificationCompletionTimeWarning(before,closeout,classification) : undefined;
    process.stdout.write(`${JSON.stringify({ ok: true, mode, appointmentId, closeout, ...(warning ? {warning} : {}), verifiedAt: new Date().toISOString() })}\n`);
    await context.close();
  } finally {
    if (browser) await browser.close();
  }
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({ error: error instanceof Error ? error.message : 'JunkWare closeout failed.', stage: writeStarted ? 'uncertain' : 'preflight', code: failureCode })}\n`);
  process.exitCode = 1;
});
