import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type Page } from "@playwright/test";
import { resolveJunkwareAssignedTruck } from "@/lib/junkware-truck-label";
import { clickWithWebFormsCompletion, selectWithWebFormsPostback } from "./junkware-webforms";

const JUNKWARE_ORIGIN = "https://junkware.junk-king.com";
const LOGIN_FRAGMENT = "/account/login.aspx";
const ASSIGNMENT_LOCK_OVERRIDE = String(process.env.JUNKWARE_ASSIGNMENT_LOCK_FILE || "").trim();
const STORAGE_STATE = path.join(
  process.env.OPSBOT_DATA_DIR || path.join(
    process.env.HOME || "",
    ".openclaw",
    "workspace",
    "opsbot",
    "data",
  ),
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
    try {
      return Buffer.from(encoded, "base64").toString("utf8");
    } catch {
      return "";
    }
  }
  return String(process.env[name] || "");
}

async function logIn(page: Page, targetUrl: string): Promise<void> {
  const username = environmentSecret("JUNKWARE_USERNAME").trim()
    || keychain("opsbot-junkware-username");
  const password = environmentSecret("JUNKWARE_PASSWORD")
    || keychain("opsbot-junkware-password");
  if (!username || !password) throw new Error("JunkWare credentials are unavailable.");

  const usernameField = page.locator("#ctl00_Content_UsernameTB").first();
  const passwordField = page.locator("#ctl00_Content_PasswordTB").first();
  if (!(await usernameField.count()) || !(await passwordField.count())) {
    throw new Error("The JunkWare sign-in form has changed.");
  }
  await usernameField.fill(username);
  await passwordField.fill(password);
  const remember = page.locator("#ctl00_Content_RememberMeCB").first();
  if (await remember.count()) await remember.check();
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 90_000 }),
    page.locator("#ctl00_Content_LoginBtn").click(),
  ]);
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) {
    throw new Error("JunkWare sign-in was not accepted.");
  }
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
}

async function ensureAuthenticated(page: Page, targetUrl: string): Promise<void> {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
  if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
  if (!page.url().startsWith(JUNKWARE_ORIGIN) || page.url().toLowerCase().includes(LOGIN_FRAGMENT)) {
    throw new Error("The authenticated JunkWare appointment did not load.");
  }
}

function assignmentLockPath(appointmentId: string): string {
  return ASSIGNMENT_LOCK_OVERRIDE || path.join(os.tmpdir(), `opscenter-junkware-truck-assignment-${appointmentId}.lock`);
}

function acquireLock(lockPath: string): number {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return fs.openSync(lockPath, "wx", 0o600);
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      if (code !== "EEXIST") throw error;
      const age = Date.now() - fs.statSync(lockPath).mtimeMs;
      if (age < 5 * 60_000 || attempt) throw new Error("Another JunkWare assignment is already being saved.");
      fs.unlinkSync(lockPath);
    }
  }
  throw new Error("Could not reserve the JunkWare assignment session.");
}

function normalizedTruck(value: string): string {
  if (!value || /^unassigned$/i.test(value)) return "";
  const match = value.match(/^truck\s*#?\s*([1-9][0-9]?)$/i);
  if (!match) throw new Error("The truck assignment is not valid.");
  return `Truck ${match[1]}`;
}

async function assignedTruck(page: Page): Promise<string> {
  const truckSelect = page.locator("#ctl00_Content_TruckDD");
  if ((await truckSelect.count()) !== 1) throw new Error("The JunkWare truck assignment control has changed.");
  const assignment = await truckSelect.evaluate((select) => {
    const control = select as HTMLSelectElement;
    const selectedOption = control.options[control.selectedIndex]?.textContent || "";
    const containerText = control.parentElement?.innerText || control.parentElement?.textContent || "";
    const match = containerText.match(/Assigned:\s*(Truck#?\s*\d+)/i);
    return { selectedOption, assignedLabel: match?.[1] || "" };
  });
  // Completed appointments keep the current truck selected in the dropdown
  // but omit the separate "Assigned:" label rendered by open appointments.
  return resolveJunkwareAssignedTruck(assignment);
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

function clockLabel(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  return `${String(hour % 12 || 12).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

function junkwareDateKey(value: string): string {
  const match = String(value || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error("The JunkWare appointment date is unavailable.");
  return `${match[3]}-${String(Number(match[1])).padStart(2, "0")}-${String(Number(match[2])).padStart(2, "0")}`;
}

type ExternalBookingMetadata = {
  bookedAt: string;
  channel: "online" | "call_center" | "";
};

function localBookingDate(value: string): Date | null {
  const match = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s+(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[4]) % 12;
  if (match[7].toUpperCase() === "PM") hour += 12;
  const date = new Date(Number(match[3]), Number(match[1]) - 1, Number(match[2]), hour, Number(match[5]), Number(match[6]));
  return Number.isNaN(date.getTime()) ? null : date;
}

async function externalBookingMetadata(page: Page): Promise<ExternalBookingMetadata> {
  const details = await page.evaluate(String.raw`(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const bookedText = Array.from(document.querySelectorAll("div,span,td,label"))
      .map((element) => clean(element.innerText || element.textContent))
      .find((value) => /^Booked:\s*\d{1,2}\/\d{1,2}\/\d{4}/i.test(value) && value.length <= 250) || "";
    const directNotes = [
      "#ctl00_Content_NCustomerNotesTB",
      "#ctl00_Content_CustomerNotesTB",
      "#ctl00_Content_FranchiseNotesTB",
      "#ctl00_Content_BJAdditionalNotesTB",
      "#ctl00_Content_UENoteTB",
    ].map((selector) => {
      const control = document.querySelector(selector);
      return clean(control?.value);
    });
    const noteRows = Array.from(document.querySelectorAll("table.list tr"))
      .map((row) => clean(row.innerText || row.textContent))
      .filter((value) => value && value.length <= 6000)
      .slice(0, 100);
    return { bookedText, notes: [...directNotes, ...noteRows].filter(Boolean).join(" ") };
  })()`) as { bookedText: string; notes: string };
  const match = details.bookedText.match(
    /^Booked:\s*(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)),\s*(.*?)\s+History\b/i,
  );
  const bookedAt = match?.[1] || "";
  const bookedBy = match?.[2] || "";
  const signals = `${bookedBy} ${details.notes}`;
  const online = /\bonline\b|additional lead note label:\s*website|\b(?:booked|booking) online\b|\bonline booking\b/i.test(signals);
  const callCenter = /junk king customer care|customer care case type|\bcall center\b|\bcall summary\b|(?:^|\W)CCR(?:\W|$)/i.test(signals);
  return { bookedAt, channel: online ? "online" : callCenter ? "call_center" : "" };
}

async function main(): Promise<void> {
  const appointmentId = argument("appointment");
  const inspect = process.argv.includes("--inspect");
  const autoVirtualExternal = process.argv.includes("--auto-virtual-external");
  const requestedTruck = normalizedTruck(argument("truck"));
  const hasRequestedStart = process.argv.includes("--start-minutes");
  const requestedStartMinutes = hasRequestedStart ? Number(argument("start-minutes")) : null;
  const durationHours = hasRequestedStart ? Number(argument("duration-hours") || "1") : 1;
  if (inspect && autoVirtualExternal) throw new Error("Inspection and automatic assignment cannot run together.");
  if (!/^\d{1,12}$/.test(appointmentId)) throw new Error("A valid numeric appointment ID is required.");
  if (!inspect && !autoVirtualExternal && !process.argv.includes("--truck")) throw new Error("A truck or unassigned state is required.");
  if (hasRequestedStart && (
    !Number.isInteger(requestedStartMinutes)
    || Number(requestedStartMinutes) < 0
    || Number(requestedStartMinutes) >= 24 * 60
    || Number(requestedStartMinutes) % 60 !== 0
  )) throw new Error("A valid hourly appointment start time is required.");
  if (hasRequestedStart && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 12)) {
    throw new Error("A valid appointment duration is required.");
  }

  const lockPath = assignmentLockPath(appointmentId);
  const lock = inspect ? null : acquireLock(lockPath);
  let browser: Browser | null = null;
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      ...(fs.existsSync(STORAGE_STATE) ? { storageState: STORAGE_STATE } : {}),
    });
    const page = await context.newPage();
    page.setDefaultTimeout(45_000);
    const targetUrl = `${JUNKWARE_ORIGIN}/franchise/appointment.aspx?id=${appointmentId}`;
    await ensureAuthenticated(page, targetUrl);

    let automaticBooking: ExternalBookingMetadata | null = null;
    if (autoVirtualExternal) {
      automaticBooking = await externalBookingMetadata(page);
      const bookedDate = localBookingDate(automaticBooking.bookedAt);
      const maximumAgeMinutes = Number(argument("max-age-minutes") || "120");
      const ageMinutes = bookedDate ? (Date.now() - bookedDate.getTime()) / 60_000 : Number.POSITIVE_INFINITY;
      const status = (await page.locator("#ctl00_Content_StatusDD option:checked").textContent() || "").trim();
      const skipReason = !automaticBooking.channel
        ? "not_external_booking"
        : !Number.isFinite(maximumAgeMinutes) || maximumAgeMinutes < 1
          ? "invalid_maximum_age"
          : ageMinutes < -5 || ageMinutes > maximumAgeMinutes
            ? "outside_new_booking_window"
            : /complete|cancel|on route|en route|closed/i.test(status)
              ? "appointment_already_in_progress"
              : "";
      if (skipReason) {
        process.stdout.write(`${JSON.stringify({
          ok: true,
          mode: "auto-virtual-external",
          appointmentId,
          channel: automaticBooking.channel,
          bookedAt: automaticBooking.bookedAt,
          status,
          changed: false,
          skipped: true,
          reason: skipReason,
          checkedAt: new Date().toISOString(),
        })}\n`);
        await context.close();
        return;
      }
    }

    if (inspect) {
      const controls = await page.evaluate(() => ({
        urlPath: location.pathname,
        selects: Array.from(document.querySelectorAll("select")).map((select) => ({
          id: select.id,
          name: select.name,
          selected: select.options[select.selectedIndex]?.text.trim() || "",
          onChange: select.getAttribute("onchange") || "",
          truckOptions: Array.from(select.options)
            .map((option) => ({ text: option.text.trim(), value: option.value }))
            .filter((option) => (
              /(?:StatusDD|LoadSizeDD|BedloadDD|OtherChargeDD|PaymentMethodDD|JobCategoryDD|ActualStart|ActualEnd|DriverDD|NavigatorDD)$/.test(select.id)
                || !option.text
                || /truck|virtual|unassign/i.test(option.text)
            )),
        })),
        inputs: Array.from(document.querySelectorAll<HTMLInputElement>("input"))
          .map((control) => ({
            id: control.id,
            name: control.name,
            type: control.type,
            value: control.type === "hidden" && !/(?:LoadSize|Bedload|Balance|Completed|Estimate)/i.test(control.id)
              ? ""
              : control.value,
          }))
          .filter((control) => /(?:LoadSize|BillingAmount|Bedload|Discount|Tip|Gratuity|Total|Balance|Payment|Misc|Charge|Actual|Completed|Estimate|Driver|Navigator)/i.test(control.id)),
        submitControls: Array.from(document.querySelectorAll<HTMLElement>("button,input[type='submit'],input[type='button']"))
          .map((control) => ({
            id: control.id,
            name: control.getAttribute("name") || "",
            type: control.getAttribute("type") || control.tagName.toLowerCase(),
            text: (control.innerText || control.getAttribute("value") || "").trim(),
            onClick: control.getAttribute("onclick") || "",
          }))
          .filter((control) => /save|update|submit|add|remove|delete/i.test(control.text)),
      }));
      process.stdout.write(`${JSON.stringify({
        ok: true,
        mode: "inspect",
        assignedTruck: await assignedTruck(page),
        ...controls,
      })}\n`);
      await context.close();
      return;
    }

    let truckSelect = page.locator("#ctl00_Content_TruckDD").first();
    let updateButton = page.locator("#ctl00_Content_SaveAppointmentBtn").first();
    if (!(await truckSelect.count()) || !(await updateButton.count())) {
      throw new Error("The JunkWare truck assignment controls have changed.");
    }

    const beforeTruck = await assignedTruck(page);
    const beforeAppointmentStartMinutes = clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
    const appointmentDate = junkwareDateKey(await page.locator("#ctl00_Content_AppointmentDateTB").inputValue());
    let changed = false;
    if (beforeTruck !== requestedTruck) {
      let savedByScheduleMove = false;
      if (requestedTruck) {
        const number = requestedTruck.match(/\d+/)?.[0] || "";
        const targetOption = truckSelect.locator("option", { hasText: new RegExp(`^Truck#\\s*${number}$`, "i") }).first();
        if (!(await targetOption.count())) throw new Error(`${requestedTruck} is not available for this JunkWare appointment.`);
        const targetValue = await targetOption.getAttribute("value") || "";

        // JunkWare refreshes dependent scheduling controls through an ASP.NET
        // postback, then expects the truck value again on the final Update.
        await selectWithWebFormsPostback(page, "#ctl00_Content_TruckDD", targetValue, "the truck selection");
      } else {
        if (beforeAppointmentStartMinutes == null) throw new Error("The JunkWare appointment time is unavailable.");
        const dailyScheduleUrl = `${JUNKWARE_ORIGIN}/franchise/daily-schedule.aspx?d=${appointmentDate}`;
        await page.goto(dailyScheduleUrl, { waitUntil: "domcontentloaded" });
        if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, dailyScheduleUrl);
        const virtualLane = await page.evaluate(() => {
          for (const header of Array.from(document.querySelectorAll<HTMLTableCellElement>("table.schedule-table th"))) {
            const label = (header.innerText || header.textContent || "").replace(/\s+/g, " ").trim();
            if (label !== "Virtual Truck") continue;
            const truckId = header.querySelector<HTMLInputElement>(".truck-id")?.value || "";
            const userId = (document.querySelector<HTMLInputElement>("[id$='UserIDHF']")?.value || "").trim();
            return { truckId: truckId.trim(), userId };
          }
          return { truckId: "", userId: "" };
        });
        if (!/^\d+$/.test(virtualLane.truckId) || !/^\d+$/.test(virtualLane.userId)) {
          throw new Error("The JunkWare Virtual Truck lane is unavailable.");
        }
        const moveResult = await page.evaluate(async ({ appointmentId: id, truckId, startTime, userId }) => {
          const response = await fetch("/franchise/daily-schedule.aspx/MoveAppointment", {
            method: "POST",
            cache: "no-store",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ appointmentId: id, truckId, startTime, userId }),
          });
          return { ok: response.ok, status: response.status };
        }, {
          appointmentId,
          truckId: virtualLane.truckId,
          startTime: clockValue(beforeAppointmentStartMinutes),
          userId: virtualLane.userId,
        });
        if (!moveResult.ok) throw new Error(`JunkWare rejected the Virtual Truck move (${moveResult.status}).`);
        savedByScheduleMove = true;
        await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      }

      if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
      truckSelect = page.locator("#ctl00_Content_TruckDD").first();
      updateButton = page.locator("#ctl00_Content_SaveAppointmentBtn").first();
      if (!(await truckSelect.count()) || !(await updateButton.count())) {
        throw new Error("The JunkWare truck assignment controls changed after selection.");
      }

      if (!savedByScheduleMove) {
        if (requestedTruck && await assignedTruck(page) !== requestedTruck) {
          const number = requestedTruck.match(/\d+/)?.[0] || "";
          const targetOption = truckSelect.locator("option", { hasText: new RegExp(`^Truck#\\s*${number}$`, "i") }).first();
          if (!(await targetOption.count())) throw new Error(`${requestedTruck} is not available after the JunkWare form refresh.`);
          const targetValue = await targetOption.getAttribute("value") || "";
          const selected = await truckSelect.evaluate((node, value) => {
            const select = node as HTMLSelectElement;
            select.value = String(value);
            return select.value;
          }, targetValue);
          if (!selected || selected !== targetValue) {
            throw new Error("The JunkWare truck selection could not be restored before the appointment update.");
          }
        }
        await clickWithWebFormsCompletion(page, "#ctl00_Content_SaveAppointmentBtn", "the truck assignment");
      }
      changed = true;
    }

    if (requestedStartMinutes != null && beforeAppointmentStartMinutes !== requestedStartMinutes) {
      let durationSelect = page.locator("#ctl00_Content_DurationDD").first();
      if (!(await durationSelect.count())) throw new Error("The JunkWare appointment duration control has changed.");
      if (await durationSelect.inputValue() !== String(durationHours)) {
        await selectWithWebFormsPostback(
          page,
          "#ctl00_Content_DurationDD",
          String(durationHours),
          "the appointment-duration selection",
        );
        if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
      }

      let availableTimes = page.locator("#ctl00_Content_AvailableTimesDD").first();
      const targetValue = clockValue(requestedStartMinutes);
      if (!(await availableTimes.count())) throw new Error("The JunkWare available-times control has changed.");
      if (!(await availableTimes.locator(`option[value="${targetValue}"]`).count())) {
        throw new Error(`${clockLabel(requestedStartMinutes)} is not available for this JunkWare appointment.`);
      }
      await selectWithWebFormsPostback(
        page,
        "#ctl00_Content_AvailableTimesDD",
        targetValue,
        "the appointment-time selection",
      );
      if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);

      const selectedStart = clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
      if (selectedStart !== requestedStartMinutes) {
        throw new Error("JunkWare did not retain the selected appointment time before the update.");
      }
      updateButton = page.locator("#ctl00_Content_SaveAppointmentBtn").first();
      if (!(await updateButton.count())) throw new Error("The JunkWare appointment update control has changed.");
      await clickWithWebFormsCompletion(page, "#ctl00_Content_SaveAppointmentBtn", "the appointment-time update");
      changed = true;
    }

    await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    if (page.url().toLowerCase().includes(LOGIN_FRAGMENT)) await logIn(page, targetUrl);
    const verifiedTruck = await assignedTruck(page);
    if (verifiedTruck !== requestedTruck) {
      throw new Error("JunkWare did not retain the requested truck assignment.");
    }
    const verifiedAppointmentStartMinutes = clockMinutes(await page.locator("#ctl00_Content_StartTimeTB").inputValue());
    if (requestedStartMinutes != null && verifiedAppointmentStartMinutes !== requestedStartMinutes) {
      throw new Error("JunkWare did not retain the requested appointment time.");
    }
    process.stdout.write(`${JSON.stringify({
      ok: true,
      mode: autoVirtualExternal ? "auto-virtual-external" : "assign",
      appointmentId,
      ...(automaticBooking ? { channel: automaticBooking.channel, bookedAt: automaticBooking.bookedAt } : {}),
      previousTruck: beforeTruck,
      truck: verifiedTruck,
      previousAppointmentStartMinutes: beforeAppointmentStartMinutes,
      appointmentStartMinutes: verifiedAppointmentStartMinutes,
      changed,
      verifiedAt: new Date().toISOString(),
    })}\n`);
    await context.close();
  } finally {
    if (browser) await browser.close();
    if (lock != null) {
      fs.closeSync(lock);
      if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
    }
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
