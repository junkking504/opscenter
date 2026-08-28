import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => readFileSync(path.join(root, file), "utf8");

function luminance(hex: string) {
  const channels = hex.match(/[0-9a-f]{2}/gi)?.map((channel) => Number.parseInt(channel, 16) / 255);
  assert.equal(channels?.length, 3);
  return channels!
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground: string, background: string) {
  const values = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const layout = read("app/(protected)/layout.tsx");
assert.match(layout, /resolveKernelDatabaseConfig\(\)\.status === "ready"/);
assert.match(layout, /inboxEnabled=\{inboxEnabled\}/);

const navItems = read("components/navItems.ts");
assert.match(navItems, /href: "\/inbox"/);
assert.match(navItems, /label: "Inbox"/);

const nav = read("components/OpsNav.tsx");
assert.match(nav, /mobileLabel: "Today"/);
assert.match(nav, /inboxNavItem/);
assert.match(navItems, /mobileLabel: "Schedule"/);
assert.match(nav, /<small>More<\/small>/);

const page = read("app/(protected)/inbox/page.tsx");
assert.match(page, /import "\.\/inbox\.css"/);
assert.doesNotMatch(page, /PageHeader/);

const summary = read("components/InboxNavSummary.tsx");
assert.match(summary, /fetch\(`\/api\/inbox\?date=/);
assert.match(summary, /counts\.actNow/);

const addOns = read("components/AddOnNotifications.tsx");
assert.match(addOns, />Add-ons</);
assert.doesNotMatch(addOns, />Alerts</);

const component = read("components/OperatingInbox.tsx");
assert.match(component, /Work requiring a decision/);
assert.match(component, /Work assigned to you/);
assert.match(component, /data-severity=\{selected\?\.severity\}/);

const theme = read("components/OperatingInbox.module.css");
for (const token of ["#eef2f7", "#f5f7fa", "#111722", "#fff3c4", "#8a5d00", "#b4232b"]) {
  assert.ok(theme.includes(token), `Missing approved Inbox theme token ${token}`);
}
for (const [foreground, background] of [
  ["#667085", "#ffffff"],
  ["#8a5d00", "#fff3c4"],
  ["#b4232b", "#ffffff"],
  ["#ffffff", "#111722"],
  ["#fff3c4", "#283344"],
]) {
  assert.ok(contrast(foreground, background) >= 4.5, `${foreground} on ${background} must meet WCAG AA contrast.`);
}
assert.match(theme, /\.standalone \.item\.selected/);
assert.match(theme, /\.standalone \.detail \{\s*order: 1;/);
assert.match(theme, /\.standalone \.item\.selected \{\s*display: none;/);

const routeTheme = read("app/(protected)/inbox/inbox.css");
assert.match(routeTheme, /\.ops-main:has\(\.ops-inbox-page\) \{\s*background: #eef2f7;/);
assert.match(routeTheme, /\.ops-main:has\(\.ops-inbox-page\) \.ops-topbar[\s\S]*background: #111722;/);

console.log("Operating Inbox preview theme contract passed.");
