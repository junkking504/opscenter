const { chromium } = require("@playwright/test");

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ timezoneId: "America/Chicago" });
  await page.goto("http://127.0.0.1:3000/crew?date=2026-07-13", { waitUntil: "networkidle" });
  const row = page.locator("tbody tr", { hasText: "Lance Gerard" }).first();
  const before = await row.locator("td").allTextContents();
  await page.waitForTimeout(35000);
  const after = await row.locator("td").allTextContents();
  const result = {
    lance_row_found: before.length === 23,
    clock_out_matches: before[2]?.trim() === "05:20 PM",
    rate_matches: before[16]?.trim() === "$18.50",
    regular_pay_matches: before[17]?.trim() === "$185.62",
    bonus_matches: before[20]?.trim() === "$0.00",
    total_pay_matches: before[21]?.trim() === "$185.62",
    final_value_frozen_after_35_seconds: before[21]?.trim() === after[21]?.trim(),
  };
  await browser.close();
  if (!Object.values(result).every(Boolean)) {
    console.error(JSON.stringify(result));
    process.exit(1);
  }
  console.log(JSON.stringify(result));
})().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
