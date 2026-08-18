import fs from "node:fs";
import path from "node:path";

function expect(condition: unknown, message: string) {
  if (!condition) throw new Error(message);
}

const jobsPage = fs.readFileSync(path.join(process.cwd(), "app/(protected)/jobs/page.tsx"), "utf8");

expect(
  jobsPage.includes("if (match?.latitude == null || match?.longitude == null) return null;"),
  "Schedule map pins must reject missing geocoder coordinates instead of coercing null to 0,0.",
);
expect(
  jobsPage.includes("latitude === 0 || longitude === 0"),
  "Schedule map pins must reject zero-coordinate geocoder records.",
);

console.log("Schedule map geocode validation checks passed.");
