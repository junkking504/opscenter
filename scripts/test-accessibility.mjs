import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseUrl = String(process.env.OPS_A11Y_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const username = String(process.env.OPS_A11Y_USERNAME || "");
const password = String(process.env.OPS_A11Y_PASSWORD || "");
const routes = [
  "/",
  "/jobs",
  "/crew",
  "/fleet?view=maintenance&section=service",
  "/finance",
  "/marketing",
  "/inbox",
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

assert.ok(username && password, "Set OPS_A11Y_USERNAME and OPS_A11Y_PASSWORD for the isolated test runtime.");

async function auditPage(page) {
  return page.evaluate(() => {
    const issues = [];
    function visible(element) {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const box = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
    }
    function labelText(element) {
      const ariaLabel = element.getAttribute("aria-label") || "";
      const labelledBy = (element.getAttribute("aria-labelledby") || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ");
      const explicitLabel = element.id
        ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent || ""
        : "";
      const wrappingLabel = element.closest("label")?.textContent || "";
      const imageAlt = element.querySelector("img")?.getAttribute("alt") || "";
      return [ariaLabel, labelledBy, explicitLabel, wrappingLabel, imageAlt, element.textContent || "", element.getAttribute("title") || ""]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    }

    const ids = new Map();
    document.querySelectorAll("[id]").forEach((element) => {
      ids.set(element.id, (ids.get(element.id) || 0) + 1);
    });
    for (const [id, count] of ids) {
      if (count > 1) issues.push({ rule: "duplicate-id", detail: `${id} appears ${count} times` });
    }

    document.querySelectorAll("img").forEach((image) => {
      if (!image.hasAttribute("alt")) issues.push({ rule: "image-alt", detail: image.src });
    });

    document.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [role='tab']").forEach((element) => {
      if (visible(element) && !labelText(element)) {
        issues.push({ rule: "accessible-name", detail: element.outerHTML.slice(0, 180) });
      }
    });

    const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).filter(visible);
    const h1Count = headings.filter((heading) => heading.tagName === "H1").length;
    if (h1Count !== 1) issues.push({ rule: "single-h1", detail: `found ${h1Count}` });
    for (let index = 1; index < headings.length; index += 1) {
      const prior = Number(headings[index - 1].tagName.slice(1));
      const current = Number(headings[index].tagName.slice(1));
      if (current - prior > 1) {
        issues.push({ rule: "heading-order", detail: `${headings[index - 1].tagName} to ${headings[index].tagName}` });
      }
    }

    if (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1) {
      const overflowers = Array.from(document.querySelectorAll("body *"))
        .filter((element) => {
          if (!visible(element)) return false;
          const box = element.getBoundingClientRect();
          return box.right > document.documentElement.clientWidth + 1 || box.left < -1;
        })
        .slice(0, 5)
        .map((element) => `${element.tagName.toLowerCase()}.${Array.from(element.classList).join(".")} (${Math.round(element.getBoundingClientRect().width)}px)`)
        .join(", ");
      const schedule = document.querySelector(".ops-jobs-map-schedule");
      const workspace = document.querySelector(".ops-jobs-map-workspace");
      const containers = [schedule, workspace]
        .filter(Boolean)
        .map((element) => {
          const style = getComputedStyle(element);
          return `${element.className}:client=${element.clientWidth},scroll=${element.scrollWidth},overflow=${style.overflowX}`;
        })
        .join("; ");
      issues.push({
        rule: "horizontal-overflow",
        detail: `${document.documentElement.scrollWidth}px content in ${document.documentElement.clientWidth}px viewport; ${overflowers}; ${containers}`,
      });
    }

    return issues;
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const runtimeErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") runtimeErrors.push(message.text());
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  try {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    assert.equal(await page.locator('input[type="email"]').count(), 0, "Login must not render an email field.");
    await Promise.all([
      page.waitForURL((url) => !url.pathname.endsWith("/login")),
      page.locator('button[type="submit"]').click(),
    ]);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const route of routes) {
        runtimeErrors.length = 0;
        await page.goto(`${baseUrl}${route}`, { waitUntil: "domcontentloaded" });
        await page.waitForTimeout(250);
        const routeLabel = `${route} (${viewport.name})`;
        assert.ok(!page.url().includes("/login"), `${routeLabel} unexpectedly redirected to login.`);
        const issues = await auditPage(page);
        assert.deepEqual(issues, [], `${routeLabel} accessibility issues:\n${issues.map((issue) => `- ${issue.rule}: ${issue.detail}`).join("\n")}`);
        assert.deepEqual(runtimeErrors, [], `${routeLabel} browser errors:\n${runtimeErrors.join("\n")}`);
        if (route === "/") {
          const commandPage = await page.evaluate(() => ({
            title: document.querySelector("h1")?.textContent?.trim() || "",
            heroCount: document.querySelectorAll("#command-overview > header").length,
            metricCount: document.querySelectorAll("#command-overview > div:first-child > a").length,
          }));
          assert.equal(commandPage.title, "Daily Command", `${routeLabel} must retain the Daily Command title.`);
          assert.equal(commandPage.heroCount, 0, `${routeLabel} must retain the compact Command layout without the retired hero.`);
          assert.equal(commandPage.metricCount, 4, `${routeLabel} must lead with four headline operating metrics.`);
        }
        if (route === "/jobs" || route === "/crew") {
          const elementCount = await page.locator("*").count();
          const elementBudget = route === "/jobs" ? 2_700 : 2_200;
          assert.ok(elementCount <= elementBudget, `${routeLabel} exceeded its ${elementBudget}-element rendering budget (${elementCount}).`);
          console.log(`${routeLabel}: ${elementCount} rendered elements`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`Accessibility verification passed for login and ${routes.length} protected routes at desktop and mobile widths.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
