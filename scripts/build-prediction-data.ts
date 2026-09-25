import path from "node:path";
import { writePredictionDataset } from "../lib/prediction-data";

const dataRoot = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), "data");
const outputFile = process.argv[2] || path.join(dataRoot, "prediction", "daily-operating-features.json");
const dataset = writePredictionDataset(dataRoot, outputFile);

console.log(JSON.stringify({
  status: "built",
  outputFile,
  generatedAt: dataset.generatedAt,
  dataThrough: dataset.dataThrough,
  dailyRows: dataset.daily.length,
  truckDailyRows: dataset.truckDaily.length,
  forecastTargets: dataset.forecasts.map((forecast) => forecast.target),
  sourceCoverage: Object.fromEntries(Object.entries(dataset.sourceCoverage).map(([source, coverage]) => [source, coverage.status])),
}, null, 2));
