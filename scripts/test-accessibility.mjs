import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const baseUrl = String(process.env.OPS_A11Y_BASE_URL || "http://127.0.0.1:3100").replace(/\/$/, "");
const username = String(process.env.OPS_A11Y_USERNAME || "");
const password = String(process.env.OPS_A11Y_PASSWORD || "");
const sessionCookie = String(process.env.OPS_A11Y_SESSION_COOKIE || "");
const ignored503Paths = new Set(String(process.env.OPS_A11Y_IGNORE_HTTP_503_PATHS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean));
const routes = [
  "/",
  "/?section=crew",
  "/jobs",
  "/crew",
  "/crew?date=2026-08-10&section=pay-period",
  "/fleet?view=maintenance&section=service",
  "/finance",
  "/marketing",
  "/marketing?section=lost-leads",
  "/inbox",
];
const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "laptop", width: 1024, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
];

assert.ok(sessionCookie || (username && password), "Set an isolated session cookie or OPS_A11Y_USERNAME and OPS_A11Y_PASSWORD.");

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
      if (visible(image) && image.complete && image.naturalWidth === 0) issues.push({ rule: "image-load", detail: image.src });
    });

    document.querySelectorAll("button, a[href], input, select, textarea, [role='button'], [role='tab']").forEach((element) => {
      if (visible(element) && !labelText(element)) {
        issues.push({ rule: "accessible-name", detail: element.outerHTML.slice(0, 180) });
      }
    });

    document.querySelectorAll([
      ".ops-button",
      ".ops-refresh-button",
      ".ops-date-selector",
      ".ops-page-subnav a",
      ".ops-sidebar-toggle-button",
      ".ops-job-closeout-editor > summary",
      ".ops-appointment-note-details > summary",
      ".ops-notification-trigger",
      ".ops-fleet-truck-link",
      ".ops-jobs-search-button",
      ".ops-jobs-filter-menu > summary",
    ].join(",")).forEach((element) => {
      if (!visible(element)) return;
      const height = element.getBoundingClientRect().height;
      if (height < 43.5) issues.push({ rule: "control-height", detail: `${element.className}: ${height.toFixed(1)}px` });
    });

    document.querySelectorAll(".ops-bottom-nav-item small").forEach((element) => {
      if (!visible(element)) return;
      if (element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1) {
        issues.push({ rule: "bottom-nav-clipping", detail: `${element.textContent?.trim()}: ${element.clientWidth}x${element.clientHeight} / ${element.scrollWidth}x${element.scrollHeight}` });
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
    if (message.type() === "error") {
      const location = message.location();
      const locationPath = location.url ? new URL(location.url).pathname : "";
      if (message.text().includes("503") && ignored503Paths.has(locationPath)) return;
      runtimeErrors.push(`${message.text()}${location.url ? ` (${location.url})` : ""}`);
    }
  });
  page.on("pageerror", (error) => runtimeErrors.push(error.message));

  try {
    if (sessionCookie) {
      await context.addCookies([{ name: "opscenter_email_session", value: sessionCookie, url: baseUrl }]);
    } else {
      await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
      await page.locator('input[name="username"]').fill(username);
      await page.locator('input[name="password"]').fill(password);
      assert.equal(await page.locator('input[type="email"]').count(), 0, "Login must not render an email field.");
      await Promise.all([
        page.waitForURL((url) => !url.pathname.endsWith("/login")),
        page.locator('button[type="submit"]').click(),
      ]);
    }

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
        if (route === "/?section=crew") {
          const readability = await page.evaluate(() => {
            function rgb(value) {
              const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
              return match ? match.slice(1).map(Number) : null;
            }
            function luminance(color) {
              return color
                .map((channel) => channel / 255)
                .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
                .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
            }
            function background(element) {
              for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
                const value = getComputedStyle(current).backgroundColor;
                const alpha = value.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1];
                if (alpha === undefined || Number(alpha) >= 0.95) return rgb(value) || [255, 255, 255];
              }
              return [255, 255, 255];
            }
            return Array.from(document.querySelectorAll([
              ".ops-daily-leaderboard-person strong",
              ".ops-daily-leaderboard-person small",
              ".ops-daily-leaderboard-jobs",
              ".ops-daily-leaderboard-revenue",
              ".ops-daily-leaderboard-rank",
              ".ops-daily-leaderboard-state",
              ".ops-daily-leaderboard .ops-mini-link",
            ].join(","))).map((element) => {
              const foreground = rgb(getComputedStyle(element).color) || [255, 255, 255];
              const bg = background(element);
              const [bright, dark] = [luminance(foreground), luminance(bg)].sort((left, right) => right - left);
              return {
                className: element.className,
                text: element.textContent?.trim() || "",
                contrast: (bright + 0.05) / (dark + 0.05),
                fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
              };
            });
          });
          const failures = readability.filter((item) => item.contrast < 4.5 || item.fontSize < 12);
          assert.deepEqual(failures, [], `${routeLabel} leaderboard text must remain readable: ${JSON.stringify(failures)}.`);
        }
        if (route === "/jobs") {
          const dispatch = await page.evaluate(() => {
            const header = document.querySelector(".ops-page-header");
            const map = document.querySelector("#jobs-map");
            const board = document.querySelector(".ops-jobs-map-board");
            const schedule = document.querySelector(".ops-jobs-map-schedule");
            const kpis = document.querySelector(".ops-jobs-kpi-strip");
            const cell = document.querySelector(".ops-jobs-map-board-cell");
            if (!(header instanceof HTMLElement)
              || !(map instanceof HTMLElement)
              || !(board instanceof HTMLElement)
              || !(schedule instanceof HTMLElement)
              || !(kpis instanceof HTMLElement)) return null;
            return {
              headerNextIsMap: header.nextElementSibling === map,
              mapTop: map.getBoundingClientRect().top,
              kpiTop: kpis.getBoundingClientRect().top,
              boardClientWidth: board.clientWidth,
              boardGridColumns: getComputedStyle(board).gridTemplateColumns,
              boardGridWidth: getComputedStyle(board).gridTemplateColumns
                .split(" ")
                .reduce((sum, width) => sum + Number.parseFloat(width), 0),
              cellMinWidth: cell ? getComputedStyle(cell).minWidth : "",
              boardOverflowers: Array.from(board.querySelectorAll("*"))
                .filter((element) => element.getBoundingClientRect().right > board.getBoundingClientRect().right + 1)
                .slice(0, 5)
                .map((element) => ({
                  className: element.className,
                  text: element.textContent?.trim().slice(0, 40) || "",
                  right: element.getBoundingClientRect().right,
                  width: element.getBoundingClientRect().width,
                })),
              scheduleClientHeight: schedule.clientHeight,
              scheduleScrollHeight: schedule.scrollHeight,
              scheduleOverflow: getComputedStyle(schedule).overflow,
            };
          });
          assert.ok(dispatch, `${routeLabel} must render the Dispatch Board.`);
          assert.equal(dispatch.headerNextIsMap, true, `${routeLabel} must place the Dispatch Board directly after the page header.`);
          assert.ok(dispatch.mapTop < dispatch.kpiTop, `${routeLabel} must place the Dispatch Board before the KPI and filter controls.`);
          assert.ok(dispatch.boardGridWidth <= dispatch.boardClientWidth + 1, `${routeLabel} Dispatch Board grid must fit its container: ${JSON.stringify(dispatch)}.`);
          assert.deepEqual(dispatch.boardOverflowers, [], `${routeLabel} Dispatch Board content must not extend beyond the fitted grid.`);
          assert.ok(
            dispatch.scheduleScrollHeight <= dispatch.scheduleClientHeight + 1,
            `${routeLabel} Dispatch Board must expand without vertical scrolling (${dispatch.scheduleScrollHeight}px content in ${dispatch.scheduleClientHeight}px).`,
          );
          assert.equal(dispatch.scheduleOverflow, "visible", `${routeLabel} Dispatch Board must expose the complete schedule.`);

          const appointmentReadability = await page.evaluate(() => Array.from(document.querySelectorAll(".ops-appointment-context")).map((context) => {
            const noteSummary = context.querySelector(".ops-appointment-note-details > summary");
            const notePreview = noteSummary?.querySelector("strong");
            const closeoutSummary = context.closest(".ops-appointment-card")?.querySelector(".ops-job-closeout-editor > summary");
            const labels = Array.from(context.querySelectorAll(":scope .ops-appointment-junk-summary > span, :scope .ops-appointment-note-details > summary > span"));
            return {
              contextWidth: context.getBoundingClientRect().width,
              noteSummaryWidth: noteSummary?.getBoundingClientRect().width || 0,
              notePreviewWidth: notePreview?.getBoundingClientRect().width || 0,
              noteScrolls: noteSummary ? noteSummary.scrollWidth > noteSummary.clientWidth + 1 : false,
              labelSizes: labels.map((label) => Number.parseFloat(getComputedStyle(label).fontSize)),
              closeoutHeight: closeoutSummary?.getBoundingClientRect().height || 0,
              closeoutClips: closeoutSummary ? closeoutSummary.scrollWidth > closeoutSummary.clientWidth + 1 : false,
            };
          }));
          for (const card of appointmentReadability) {
            assert.ok(card.labelSizes.every((size) => size >= 13), `${routeLabel} appointment labels must be at least 13px: ${JSON.stringify(card)}.`);
            assert.equal(card.noteScrolls, false, `${routeLabel} appointment notes must not overflow their summary: ${JSON.stringify(card)}.`);
            assert.equal(card.closeoutClips, false, `${routeLabel} closeout action must not clip: ${JSON.stringify(card)}.`);
            if (card.closeoutHeight) assert.ok(card.closeoutHeight >= 43.5, `${routeLabel} closeout action must provide a 44px target: ${JSON.stringify(card)}.`);
            if (viewport.width <= 768 && card.noteSummaryWidth) {
              assert.ok(card.notePreviewWidth >= card.noteSummaryWidth * 0.8, `${routeLabel} note preview must use the card width: ${JSON.stringify(card)}.`);
            }
          }

          if (viewport.width <= 1050) {
            const drawerToggle = page.locator("#ops-sidebar-toggle");
            await drawerToggle.evaluate((element) => {
              element.checked = true;
              element.dispatchEvent(new Event("change", { bubbles: true }));
            });
            await page.waitForTimeout(200);
            const drawer = await page.evaluate(() => {
              const sidebar = document.querySelector(".ops-sidebar");
              const footer = document.querySelector(".ops-sidebar-footer");
              const bottomNav = document.querySelector(".ops-bottom-nav");
              const topbarActions = document.querySelector(".ops-topbar-right");
              if (!(sidebar instanceof HTMLElement) || !(footer instanceof HTMLElement) || !(bottomNav instanceof HTMLElement)) return null;
              const sidebarBox = sidebar.getBoundingClientRect();
              const footerBox = footer.getBoundingClientRect();
              const navStyle = getComputedStyle(bottomNav);
              return {
                sidebar: { left: sidebarBox.left, top: sidebarBox.top, right: sidebarBox.right, bottom: sidebarBox.bottom },
                footerBottom: footerBox.bottom,
                bottomNavVisibility: navStyle.visibility,
                bottomNavOpacity: Number(navStyle.opacity),
                topbarActionsVisibility: topbarActions ? getComputedStyle(topbarActions).visibility : "missing",
                navTargetHeights: Array.from(sidebar.querySelectorAll(".ops-nav-item")).map((item) => item.getBoundingClientRect().height),
                navFontSizes: Array.from(sidebar.querySelectorAll(".ops-nav-item")).map((item) => Number.parseFloat(getComputedStyle(item).fontSize)),
              };
            });
            assert.ok(drawer, `${routeLabel} must render the responsive navigation drawer.`);
            assert.ok(drawer.sidebar.left >= 0 && drawer.sidebar.top >= 0 && drawer.sidebar.right <= viewport.width && drawer.sidebar.bottom <= viewport.height, `${routeLabel} drawer must stay within the viewport: ${JSON.stringify(drawer)}.`);
            assert.ok(drawer.footerBottom <= drawer.sidebar.bottom + 1, `${routeLabel} drawer account controls must remain inside the drawer: ${JSON.stringify(drawer)}.`);
            assert.ok(drawer.bottomNavVisibility === "hidden" || drawer.bottomNavOpacity === 0, `${routeLabel} bottom navigation must hide behind the open drawer: ${JSON.stringify(drawer)}.`);
            assert.equal(drawer.topbarActionsVisibility, "hidden", `${routeLabel} header actions must not float above the open drawer: ${JSON.stringify(drawer)}.`);
            assert.ok(drawer.navTargetHeights.every((height) => height >= 43.5), `${routeLabel} drawer navigation must provide 44px targets: ${JSON.stringify(drawer)}.`);
            assert.ok(drawer.navFontSizes.every((size) => size >= 14), `${routeLabel} drawer navigation labels must be at least 14px: ${JSON.stringify(drawer)}.`);
            await drawerToggle.evaluate((element) => {
              element.checked = false;
              element.dispatchEvent(new Event("change", { bubbles: true }));
            });
          }
        }
        if (route === "/marketing?section=lost-leads") {
          const lostLeads = await page.evaluate(() => {
            function rgb(value) {
              const match = value.match(/rgba?\((\d+)[, ]+(\d+)[, ]+(\d+)/);
              return match ? match.slice(1).map(Number) : null;
            }
            function luminance(color) {
              return color
                .map((channel) => channel / 255)
                .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
                .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
            }
            function contrast(element) {
              const foreground = rgb(getComputedStyle(element).color) || [0, 0, 0];
              let background = [255, 255, 255];
              for (let current = element; current instanceof HTMLElement; current = current.parentElement) {
                const value = getComputedStyle(current).backgroundColor;
                const alpha = value.match(/rgba\([^)]*,\s*([\d.]+)\)/)?.[1];
                if (alpha === undefined || Number(alpha) >= 0.95) {
                  background = rgb(value) || background;
                  break;
                }
              }
              const [bright, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
              return (bright + 0.05) / (dark + 0.05);
            }
            const text = Array.from(document.querySelectorAll([
              ".ops-marketing-lead-value small",
              ".ops-marketing-lead-context span",
              ".ops-lead-status",
              ".ops-marketing-lead-actions .ops-mini-link",
            ].join(","))).map((element) => ({
              text: element.textContent?.trim() || "",
              fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
              contrast: contrast(element),
            }));
            return {
              cardCount: document.querySelectorAll(".ops-marketing-lead").length,
              reviewFormCount: document.querySelectorAll(".ops-marketing-lead-review").length,
              text,
            };
          });
          assert.ok(lostLeads.cardCount > 0 && lostLeads.cardCount <= 25, `${routeLabel} must initially render one bounded date group: ${JSON.stringify(lostLeads)}.`);
          assert.equal(lostLeads.reviewFormCount, 0, `${routeLabel} must keep lead editors collapsed until requested.`);
          const failures = lostLeads.text.filter((item) => item.fontSize < 13 || item.contrast < 4.5);
          assert.deepEqual(failures, [], `${routeLabel} lead scanner text must remain readable: ${JSON.stringify(failures)}.`);

          await page.getByRole("button", { name: "Review lead" }).first().click();
          const editor = page.locator(".ops-marketing-lead-review").first();
          await editor.waitFor({ state: "visible" });
          const editorContract = await editor.evaluate((element) => {
            const fields = Array.from(element.querySelectorAll("select, input[type='text'], button"));
            const checkbox = element.querySelector("input[type='checkbox']");
            const label = checkbox?.closest("label");
            return {
              fieldHeights: fields.map((field) => field.getBoundingClientRect().height),
              checkboxSize: checkbox ? Math.min(checkbox.getBoundingClientRect().width, checkbox.getBoundingClientRect().height) : 0,
              checkboxLabelHeight: label ? label.getBoundingClientRect().height : 0,
            };
          });
          assert.ok(editorContract.fieldHeights.every((height) => height >= 43.5), `${routeLabel} review controls must be 44px: ${JSON.stringify(editorContract)}.`);
          assert.ok(editorContract.checkboxSize >= 22, `${routeLabel} checkbox must be visibly sized: ${JSON.stringify(editorContract)}.`);
          assert.ok(editorContract.checkboxLabelHeight >= 44, `${routeLabel} checkbox label must provide a 44px target: ${JSON.stringify(editorContract)}.`);
        }
        if (route === "/crew?date=2026-08-10&section=pay-period") {
          const period = await page.evaluate(() => ({
            copy: document.body.textContent || "",
            weekLabels: Array.from(document.querySelectorAll(".ops-crew-period-week-title"))
              .map((element) => element.textContent?.trim() || ""),
          }));
          assert.match(period.copy, /2026-08-10 through 2026-08-23/, `${routeLabel} must show the correct 14-day pay period.`);
        }
        if (route === "/jobs" || route === "/crew") {
          const elementCount = await page.locator("*").count();
          const elementBudget = route === "/jobs" ? 2_900 : 2_200;
          assert.ok(elementCount <= elementBudget, `${routeLabel} exceeded its ${elementBudget}-element rendering budget (${elementCount}).`);
          console.log(`${routeLabel}: ${elementCount} rendered elements`);
        }
      }
    }
  } finally {
    await browser.close();
  }

  console.log(`Accessibility verification passed for login and ${routes.length} protected routes at desktop, laptop, tablet, and mobile widths.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
