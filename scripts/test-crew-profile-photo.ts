import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { crewProfileImageError } from "../lib/crew-profile-image";

assert.equal(crewProfileImageError("data:image/jpeg;base64,AA=="), null);
assert.equal(crewProfileImageError("data:image/svg+xml;base64,AA=="), "Choose a JPG, PNG, or WebP image.");
assert.equal(crewProfileImageError("not-an-image"), "Choose a JPG, PNG, or WebP image.");

const page = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
assert.ok(page.includes("CrewProfileHeader"), "Crew Portal must render the centered profile header.");
const component = readFileSync(new URL("../components/CrewProfileHeader.tsx", import.meta.url), "utf8");
assert.ok(component.includes('accept="image/jpeg,image/png,image/webp"'), "Profile photo uploads must restrict image types.");
assert.ok(component.includes('fetch("/my-pay/profile-photo"'), "Profile photos must use the authenticated Crew Portal route.");
const styles = readFileSync(new URL("../app/my-pay/my-pay.module.css", import.meta.url), "utf8");
assert.ok(styles.includes(".profileHero"), "Crew Portal needs a centered profile header style.");
assert.ok(styles.includes("justify-items: center"), "Profile header contents must be centered.");
const route = readFileSync(new URL("../app/my-pay/profile-photo/route.ts", import.meta.url), "utf8");
assert.ok(route.includes("sameOrigin(request)"), "Profile photo writes must reject cross-origin requests.");

console.log("Crew profile photo checks passed.");
