import { chromium } from "playwright";
import fs from "fs/promises";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function moneyToNumber(value: string) {
  const n = Number(value.replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseActiveJob(text: string) {
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const first = lines[0] ?? "";

  const timeMatch = first.match(/^(.+?)\s*-\s*(.+?)\t/);
  const jobMatch = text.match(/JK\d+/);
  const truckMatch = text.match(/Truck#\s*(\d+)/i);
  const amountMatch = text.match(/\$[\d,]+\.\d{2}/);
  const durationMatch = text.match(/Duration:\s*(\d+)\s*min/i);

  const jobType = lines[1] ?? "";
  const detailsLine = lines.find((line) => line.includes(", (")) ?? "";
  const customerMatch = detailsLine.match(/^(.+?),\s*\(([^)]+)\)/);

  const detailIndex = lines.findIndex((line) => line.includes(", ("));
  const addressLines =
    detailIndex >= 0
      ? lines.slice(detailIndex + 1, detailIndex + 3).filter((line) => line !== "Notes:")
      : [];

  const status =
    lines.findLast((line) =>
      ["Confirmed", "Completed", "On Route", "En Route", "Cancelled"].includes(line)
    ) ?? "";

  const paymentType =
    ["Credit Card", "Cash", "Check", "Billed"].find((p) => text.includes(`\t\t${p}\t`)) ?? "";

  return {
    jobId: jobMatch?.[0] ?? "",
    jobType,
    truck: truckMatch ? Number(truckMatch[1]) : null,
    customer: customerMatch?.[1] ?? "",
    phone: customerMatch?.[2]?.replace(/\D/g, "") ?? "",
    address: addressLines.join(", "),
    scheduledStart: timeMatch?.[1] ?? "",
    scheduledEnd: timeMatch?.[2] ?? "",
    paymentType,
    amount: amountMatch ? moneyToNumber(amountMatch[0]) : 0,
    status,
    durationMinutes: durationMatch ? Number(durationMatch[1]) : null,
    rawText: text,
  };
}

function parseCancelledJob(text: string) {
  const parts = text.split(/\t|\n/).map((part) => part.trim()).filter(Boolean);

  return {
    scheduledStart: parts[0] ?? "",
    scheduledEnd: parts[1] ?? "",
    jobId: parts.find((p) => /^JK\d+$/.test(p)) ?? "",
    jobType: parts[3] ?? "",
    cancelledBy: parts[4] ?? "",
    customer: parts[5] ?? "",
    phone: (parts[6] ?? "").replace(/\D/g, ""),
    address: parts[7] ?? "",
    reason: parts.slice(8).filter((p) => p !== "Followup").join(" "),
    rawText: text,
  };
}

async function main() {
  const context = await chromium.launchPersistentContext(".auth/junkware", {
    headless: false,
  });

  const page = await context.newPage();

  await page.goto("https://junkware.junk-king.com/franchise/schedule.aspx", {
    waitUntil: "domcontentloaded",
  });

  console.log("If you see login, log in manually.");
  console.log("After you reach Schedule, come back here and press Enter.");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  console.log("Set the territory dropdown to ALL manually, confirm/load the schedule, then press Enter.");

  await new Promise<void>((resolve) => {
    process.stdin.once("data", () => resolve());
  });

  await page.waitForTimeout(3000);

  const rows = await page.locator("table tr").all();

  const activeJobs = [];
  const cancelledJobs = [];

  for (const row of rows) {
    const text = await row.innerText().catch(() => "");
    if (!text.includes("JK")) continue;
    if (text.includes("Time\tJK #") || text.includes("From\tTo\tJK #")) continue;

    if (text.includes("Truck#")) activeJobs.push(parseActiveJob(text));
    else cancelledJobs.push(parseCancelledJob(text));
  }

  const payload = {
    scrapedAt: new Date().toISOString(),
    source: "junkware_schedule",
    territory: "ALL",
    activeJobs,
    cancelledJobs,
  };

  await fs.mkdir("data/history/raw/junkware", { recursive: true });

  const out = `data/history/raw/junkware/schedule_${todayKey()}.json`;
  await fs.writeFile(out, JSON.stringify(payload, null, 2));

  console.log(`Saved ${activeJobs.length} active jobs and ${cancelledJobs.length} cancelled jobs to ${out}`);

  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
