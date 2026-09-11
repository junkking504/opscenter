import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium, type Page } from "@playwright/test";
import { clickWithWebFormsCompletion, sanitizeJunkwareCustomerEmail, selectWithWebFormsPostback, setInputWithWebFormsPostback } from "./junkware-webforms";

const ORIGIN = "https://junkware.junk-king.com";
const LOGIN_FRAGMENT = "/account/login.aspx";
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
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) throw new Error("JunkWare sign-in was not accepted.");
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

async function ensureAuthenticated(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
  if (!page.url().startsWith(ORIGIN) || page.url().toLowerCase().includes(LOGIN_FRAGMENT)) {
    throw new Error("The authenticated JunkWare appointment did not load.");
  }
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

export async function rescheduleOnPage(page: Page, input: {appointmentId:string;date:string;appointmentStartMinutes:number;expectedDate:string;expectedAppointmentStartMinutes:number;expectedEndMinutes:number;expectedTruck:string;restore?:boolean}, reopen:()=>Promise<void>) {
  const {appointmentId,date,appointmentStartMinutes,expectedDate,expectedAppointmentStartMinutes,expectedEndMinutes,expectedTruck}=input;
  let submitted=false;
  const read=async()=>{
    const label=await page.locator("#ctl00_Content_TruckDD").evaluate(node=>node.parentElement?.textContent || '');
    const truckNumber=label.match(/Assigned:\s*Truck#?\s*(\d+)/i)?.[1];
    const start=clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
    const duration=Number(await page.locator("#ctl00_Content_DurationDD").inputValue());
    return {date:dateKey(await page.locator("#ctl00_Content_AppointmentDateTB").inputValue()),appointmentStartMinutes:start,appointmentEndMinutes:start===null?null:start+duration*60,truck:truckNumber?'Truck '+truckNumber:'',status:(await page.locator("#ctl00_Content_StatusDD option:checked").textContent() || '').trim()};
  };
  try {
    const before=await read();
    if (input.restore ? !/^cancel(?:ed|led)$/i.test(before.status) : /cancel|complete|closed/i.test(before.status)) throw new Error(input.restore ? "Only canceled appointments can be restored." : "This appointment is already canceled or closed.");
    const targetStatus = input.restore ? 'Confirmed' : before.status;
    if (before.date!==expectedDate || before.appointmentStartMinutes!==expectedAppointmentStartMinutes || before.appointmentEndMinutes!==expectedEndMinutes || before.truck!==expectedTruck) throw new Error("The JunkWare date, time, duration or truck changed. Refresh before rescheduling.");
    const duration=expectedEndMinutes-expectedAppointmentStartMinutes;
    if (input.restore) {
      const option = page.locator('#ctl00_Content_StatusDD option', {hasText:/^Confirmed$/i});
      if (await option.count() !== 1) throw new Error('The JunkWare Confirmed status is unavailable.');
      await selectWithWebFormsPostback(page, '#ctl00_Content_StatusDD', await option.getAttribute('value') || '', 'the unsaved appointment restoration');
    }
    await setInputWithWebFormsPostback(page,"#ctl00_Content_AppointmentDateTB",displayDate(date),"the appointment date selection");
    const timeValue=clockValue(appointmentStartMinutes);
    if (clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue())!==appointmentStartMinutes) {
      if (!(await page.locator('#ctl00_Content_AvailableTimesDD option[value="'+timeValue+'"]').count())) throw new Error("That time is not available in JunkWare for the selected date.");
      await selectWithWebFormsPostback(page,"#ctl00_Content_AvailableTimesDD",timeValue,"the appointment time selection");
    }
    const staged=await read();
    if(staged.date!==date || staged.appointmentStartMinutes!==appointmentStartMinutes || staged.appointmentEndMinutes!==appointmentStartMinutes+duration || staged.truck!==expectedTruck || staged.status!==targetStatus) throw new Error("JunkWare did not retain the requested date and time while preserving the truck, duration and status.");
    await sanitizeJunkwareCustomerEmail(page);
    submitted=true;
    let saveError='';
    try {await clickWithWebFormsCompletion(page,"#ctl00_Content_SaveAppointmentBtn","the appointment reschedule");}
    catch(error){saveError=error instanceof Error?error.message:'Save response unavailable.';}
    // Reopen even after a lost save response. Never click Save twice.
    await reopen();
    const saved=await read();
    if(saved.date!==date || saved.appointmentStartMinutes!==appointmentStartMinutes || saved.appointmentEndMinutes!==appointmentStartMinutes+duration || saved.truck!==expectedTruck || saved.status!==targetStatus) throw new Error(saveError || "JunkWare has not verified the requested reschedule.");
    return {ok:true,mode:input.restore?"restore":"reschedule",appointmentId,...saved,submitted,verifiedAt:new Date().toISOString()};
  } catch(error) {
    return {ok:false,submitted,error:error instanceof Error?error.message:"The reschedule could not be verified."};
  }
}

async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  const date = argument("date");
  const expectedDate = argument("expected-date");
  const appointmentStartMinutes = Number(argument("start-minutes"));
  const expectedAppointmentStartMinutes = Number(argument("expected-start-minutes"));
  const expectedEndMinutes=Number(argument("expected-end-minutes"));
  const expectedTruck=argument("expected-truck")==="unassigned"?"":argument("expected-truck");
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid JunkWare appointment ID is required.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedDate)) throw new Error("A valid appointment date is required.");
  for (const minutes of [appointmentStartMinutes, expectedAppointmentStartMinutes]) {
    if (!Number.isInteger(minutes) || minutes < 0 || minutes >= 24 * 60 || minutes % 60 !== 0) {
      throw new Error("A valid hourly appointment start time is required.");
    }
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const targetUrl = `${ORIGIN}/franchise/appointment.aspx?id=${appointmentId}`;
    await ensureAuthenticated(page, targetUrl);

    const result=await rescheduleOnPage(page,{appointmentId,date,appointmentStartMinutes,expectedDate,expectedAppointmentStartMinutes,expectedEndMinutes,expectedTruck,restore:process.argv.includes("--restore")},()=>ensureAuthenticated(page,targetUrl));
    process.stdout.write(JSON.stringify(result)+"\n");
    await context.close();
  } finally {
    await browser.close();
  }
}

if(process.argv[1]?.endsWith("reschedule-junkware-appointment.ts")) main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
