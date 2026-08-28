import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../app/my-pay/page.tsx", import.meta.url), "utf8");
assert.ok(page.includes("<JunkKingLogo className={styles.crewTopLogo}"), "Crew top bar must render the Junk King logo.");
assert.ok(!page.includes("OpsCenter Crew Portal</div>"), "Crew top bar must not retain the text brand alongside the logo.");

const styles = readFileSync(new URL("../app/my-pay/my-pay.module.css", import.meta.url), "utf8");
const topbarStart = styles.indexOf(".topbarInner {");
const topbarEnd = styles.indexOf("}", topbarStart);
const topbar = styles.slice(topbarStart, topbarEnd);
assert.ok(topbar.includes("grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr)"), "Crew top bar must reserve equal side columns around its centered logo.");
assert.ok(styles.includes(".crewTopLogo { grid-column: 2"), "Junk King logo must occupy the centered top-bar column.");

console.log("Crew top-bar logo checks passed.");
