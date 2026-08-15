import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import manifest from "../app/manifest";
import { publicAuthRoute } from "../lib/auth";

const appManifest = manifest();
assert.equal(appManifest.id, "/");
assert.equal(appManifest.start_url, "/");
assert.equal(appManifest.scope, "/");
assert.equal(appManifest.display, "standalone");
assert.equal(appManifest.theme_color, "#07090d");
assert.equal(appManifest.background_color, "#07090d");

const icons = [
  ["../public/icons/opscenter-180.png", 180],
  ["../public/icons/opscenter-192.png", 192],
  ["../public/icons/opscenter-512.png", 512],
  ["../public/icons/opscenter-maskable-512.png", 512],
] as const;

for (const [relativePath, expectedSize] of icons) {
  const iconUrl = new URL(relativePath, import.meta.url);
  assert.ok(existsSync(iconUrl), `Missing PWA icon ${relativePath}`);
  const png = readFileSync(iconUrl);
  assert.equal(png.toString("ascii", 1, 4), "PNG", `${relativePath} must be a PNG`);
  assert.equal(png.readUInt32BE(16), expectedSize, `${relativePath} has the wrong width`);
  assert.equal(png.readUInt32BE(20), expectedSize, `${relativePath} has the wrong height`);
}

for (const publicAsset of [
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
  "/icons/opscenter-180.png",
  "/icons/opscenter-192.png",
  "/icons/opscenter-512.png",
  "/icons/opscenter-maskable-512.png",
]) {
  assert.equal(publicAuthRoute(publicAsset), true, `${publicAsset} must remain reachable at the login boundary`);
}

const serviceWorker = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");
assert.ok(serviceWorker.includes('event.request.mode !== "navigate"'), "Service worker must limit interception to navigations.");
assert.ok(serviceWorker.includes('cache.match("/offline.html")'), "Service worker must provide the honest offline screen.");
assert.ok(!serviceWorker.includes("/api/"), "Service worker must not cache or intercept OpsCenter APIs.");
assert.ok(!serviceWorker.includes("cache.put(event.request"), "Service worker must not cache live page responses.");

const offlinePage = readFileSync(new URL("../public/offline.html", import.meta.url), "utf8");
for (const phrase of ["needs a live connection", "No schedule, GPS, payroll, or financial data is stored for offline use"]) {
  assert.ok(offlinePage.includes(phrase), `Offline screen is missing: ${phrase}`);
}

const auth = readFileSync(new URL("../lib/auth.ts", import.meta.url), "utf8");
for (const publicShellPath of ["/manifest.webmanifest", "/offline.html", "/sw.js", "/icons/"]) {
  assert.ok(auth.includes(publicShellPath), `Authentication middleware blocks ${publicShellPath}`);
}

const networkStatus = readFileSync(new URL("../components/NetworkStatus.tsx", import.meta.url), "utf8");
assert.ok(networkStatus.includes('window.addEventListener("offline"'), "Installed app must react when the device goes offline.");
assert.ok(networkStatus.includes("Live operational data is unavailable"), "Offline state must not imply that stale data is current.");

const nextConfig = readFileSync(new URL("../next.config.mjs", import.meta.url), "utf8");
assert.ok(nextConfig.includes('{ key: "Cloudflare-CDN-Cache-Control", value: "no-store" }'), "Cloudflare must not retain an old service worker.");

console.log("OpsCenter installable-app checks passed.");
