import { chromium } from "playwright";

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

  await page.waitForURL("**/franchise/schedule.aspx", { timeout: 30000 }).catch(() => {});

  console.log("TITLE:", await page.title());
  console.log("URL:", page.url());

  await page.screenshot({
    path: "junkware-schedule.png",
    fullPage: true,
  });

  console.log("Saved screenshot: junkware-schedule.png");

  await context.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
