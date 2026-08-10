import fs from "node:fs";
import path from "node:path";
import { buildMonthlySummary } from "../lib/monthly-summary";

function selectedMonth(): string {
  const flagIndex = process.argv.indexOf("--month");
  const explicit = flagIndex >= 0 ? process.argv[flagIndex + 1] : "";
  if (explicit && /^\d{4}-\d{2}$/.test(explicit)) return explicit;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  if (!year || !month) throw new Error("Could not determine the current Chicago month");
  return `${year}-${month}`;
}

function reportingContractErrors(): string[] {
  const consumers = [
    "app/(protected)/page.tsx",
    "app/(protected)/finance/page.tsx",
    "app/(protected)/crew/page.tsx",
  ];

  return consumers.flatMap((relativePath) => {
    const source = fs.readFileSync(path.join(process.cwd(), relativePath), "utf8");
    const missing = [
      source.includes("buildMonthlySummary(date)") ? null : "buildMonthlySummary(date)",
      source.includes("monthlySummary.grossRevenue") ? null : "monthlySummary.grossRevenue",
    ].filter((value): value is string => Boolean(value));

    return missing.map((value) => `${relativePath} does not consume ${value}`);
  });
}

const month = selectedMonth();
const summary = buildMonthlySummary(`${month}-01`);
const authority = summary.authority;
const errors = reportingContractErrors();

if (!authority) {
  errors.push(`${month} has no authoritative JunkWare monthly reconciliation`);
} else {
  if (summary.completedJobs !== authority.completedJobs) {
    errors.push(`headline jobs ${summary.completedJobs} != authority ${authority.completedJobs}`);
  }
  if (Math.abs(summary.grossRevenue - authority.grossRevenue) > 0.005) {
    errors.push(`headline revenue ${summary.grossRevenue} != authority ${authority.grossRevenue}`);
  }
  if (summary.itemizedCompletedJobs !== authority.completedJobs) {
    errors.push(`itemized jobs ${summary.itemizedCompletedJobs} != authority ${authority.completedJobs}`);
  }
  if (Math.abs(summary.itemizedGrossRevenue - authority.grossRevenue) > 0.005) {
    errors.push(`itemized revenue ${summary.itemizedGrossRevenue} != authority ${authority.grossRevenue}`);
  }
}

if (errors.length) {
  console.error(`Monthly reporting verification failed for ${month}:`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Monthly reporting verified for ${month}: ${summary.completedJobs} jobs, ` +
    `$${summary.grossRevenue.toFixed(2)}, zero itemization variance across Dashboard, Finance, and Crew.`,
);
