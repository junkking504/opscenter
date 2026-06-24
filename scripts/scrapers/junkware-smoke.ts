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

  const rows = await page.locator("table tr").all();

  const activeJobs = [];
  const cancelledJobs = [];

  for (const row of rows) {
    const text = await row.innerText().catch(() => "");
    if (!text.includes("JK")) continue;
    if (text.includes("Time\tJK #") || text.includes("From\tTo\tJK #")) continue;

    const jobMatch = text.match(/JK\d+/);
    const truckMatch = text.match(/Truck#\s*(\d+)/i);
    const amountMatch = text.match(/\$([\d,]+\.\d{2})/);
    const durationMatch = text.match(/Duration:\s*(\d+)\s*min/i);

    const record = {
      jobId: jobMatch?.[0] ?? "",
      truck: truckMatch?.[1] ?? "",
      amount: amountMatch?.[0] ?? "",
      durationMinutes: durationMatch ? Number(durationMatch[1]) : null,
      rawText: text,
    };

    if (truckMatch) activeJobs.push(record);
    else cancelledJobs.push(record);
  }

  const payload = {
    scrapedAt: new Date().toISOString(),
    source: "junkware_schedule",
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
