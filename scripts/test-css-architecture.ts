import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const layout = fs.readFileSync(path.join(root, "app/layout.tsx"), "utf8");
const entry = fs.readFileSync(path.join(root, "app/ops-styles.css"), "utf8");
const styleFiles = [
  "globals.css",
  "ops-redesign.css",
  "ops-design-system.css",
  "dashboard-v2.css",
  "ops-usability.css",
];

assert.match(layout, /import "\.\/ops-styles\.css";/, "The root layout must load the single OpsCenter style entry.");
for (const file of styleFiles) {
  assert.doesNotMatch(layout, new RegExp(`import ["']\\./${file.replace(".", "\\.")}["']`), `${file} must be loaded through the layered entry.`);
}

let previousIndex = -1;
for (const file of styleFiles) {
  const statement = `@import "./${file}";`;
  const statementIndex = entry.indexOf(statement);
  assert.ok(statementIndex > previousIndex, `${file} must remain in the intended cascade order.`);
  previousIndex = statementIndex;
}

const totalLines = styleFiles.reduce((sum, file) => {
  const content = fs.readFileSync(path.join(root, "app", file), "utf8");
  return sum + content.split(/\r?\n/).length;
}, 0);
assert.ok(totalLines <= 19_000, `Shared CSS exceeded the 19,000-line migration budget (${totalLines}).`);

console.log(`CSS architecture verification passed (${totalLines.toLocaleString()} ordered shared lines).`);
