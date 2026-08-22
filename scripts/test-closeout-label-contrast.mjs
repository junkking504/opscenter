import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const closeoutCss = fs.readFileSync(path.join(root, "app/globals.css"), "utf8");
const jobsCss = fs.readFileSync(path.join(root, "app/(protected)/jobs/jobs.css"), "utf8");
const editor = fs.readFileSync(path.join(root, "components/JobCloseoutEditor.tsx"), "utf8");

function rgb(hex) {
  return [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16));
}

function luminance(hex) {
  return rgb(hex)
    .map((channel) => channel / 255)
    .map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(foreground, background) {
  const [bright, dark] = [luminance(foreground), luminance(background)].sort((left, right) => right - left);
  return (bright + 0.05) / (dark + 0.05);
}

const activeLabelContrast = contrast("#cbd5e1", "#0f172a");
const headingContrast = contrast("#f8fafc", "#0f172a");
const disabledLabelContrast = contrast("#94a3b8", "#1e293b");

assert.ok(activeLabelContrast >= 4.5, `Active closeout labels need AA contrast; got ${activeLabelContrast.toFixed(2)}:1.`);
assert.ok(headingContrast >= 3, `Closeout section headings need large-text AA contrast; got ${headingContrast.toFixed(2)}:1.`);
assert.ok(disabledLabelContrast >= 4.5, `Disabled closeout labels must remain readable; got ${disabledLabelContrast.toFixed(2)}:1.`);
assert.match(jobsCss, /\.ops-jobs-page \.ops-job-closeout-editor\s*\{[^}]*background:\s*#0f172a;/s);
assert.match(closeoutCss, /\.ops-closeout-editor-section label\.is-disabled > span\s*\{[^}]*text-decoration:\s*none;/s);
assert.match(closeoutCss, /:is\(input:not\(\[type="checkbox"\]\), select\):disabled\s*\{[^}]*border-style:\s*dashed;/s);
assert.match(editor, /className=\{otherChargePriceIsAutomatic \? "is-disabled" : ""\}/);

console.log(`Closeout contrast verification passed: active ${activeLabelContrast.toFixed(2)}:1, heading ${headingContrast.toFixed(2)}:1, disabled ${disabledLabelContrast.toFixed(2)}:1.`);
