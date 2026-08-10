import fs from "fs/promises";
import { normalizeSchedule, type RawJunkwareSchedulePayload } from "@/lib/parsers/junkware";

function todayKey() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function moneyByTruck(jobs: ReturnType<typeof normalizeSchedule>) {
  return jobs.reduce<Record<string, number>>((acc, job) => {
    if (job.cancelled) return acc;
    if (!job.truck) return acc;
    acc[String(job.truck)] = (acc[String(job.truck)] ?? 0) + job.revenue;
    return acc;
  }, {});
}

function jobsByTruck(jobs: ReturnType<typeof normalizeSchedule>) {
  return jobs.reduce<Record<string, number>>((acc, job) => {
    if (job.cancelled) return acc;
    if (!job.truck) return acc;
    acc[String(job.truck)] = (acc[String(job.truck)] ?? 0) + 1;
    return acc;
  }, {});
}

async function main() {
  const date = process.argv[2] ?? todayKey();

  const rawPath = `data/history/raw/junkware/schedule_${date}.json`;
  const raw = JSON.parse(await fs.readFile(rawPath, "utf8")) as RawJunkwareSchedulePayload;

  const jobs = normalizeSchedule(raw);
  const activeJobs = jobs.filter((job) => !job.cancelled);
  const cancelledJobs = jobs.filter((job) => job.cancelled);

  const totalRevenue = activeJobs.reduce((sum, job) => sum + job.revenue, 0);

  const metrics = {
    date,
    provisional: true,
    total_revenue: totalRevenue,
    total_payments_collected: totalRevenue,
    revenue_not_yet_collected: 0,
    jobs_by_truck: jobsByTruck(jobs),
    revenue_by_truck: moneyByTruck(jobs),
    jobs_by_market: {
      [raw.territory]: activeJobs.length,
    },
    revenue_by_market: {
      [raw.territory]: totalRevenue,
    },
    appointments: activeJobs.map((job) => ({
      job_id: job.jobId,
      customer_name: job.customer,
      market: job.territory,
      truck: job.truck ? String(job.truck) : "",
      address: job.address,
      revenue: job.revenue ? `$${job.revenue.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "",
      payment_type: job.paymentType,
      job_status: job.status,
      appointment_type: job.jobType,
    })),
    cancelled_jobs: cancelledJobs,
    inputs: {
      raw_junkware_schedule: rawPath,
    },
  };

  await fs.mkdir("data/history/daily_metrics", { recursive: true });

  const out = `data/history/daily_metrics/daily_metrics_${date}.json`;
  await fs.writeFile(out, JSON.stringify(metrics, null, 2));

  console.log(`Saved daily metrics to ${out}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
