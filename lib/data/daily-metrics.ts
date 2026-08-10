import fs from "fs/promises";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export async function getDailyMetrics(date = todayKey()) {
  const file = `data/history/daily_metrics/daily_metrics_${date}.json`;
  const json = await fs.readFile(file, "utf8");
  return JSON.parse(json);
}
