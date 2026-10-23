export function isCompletedTvJob(status: string) {
  // JunkWare appends recorded duration to completed job statuses. Keep the
  // recognized suffix bounded so estimates, cancellations and unpaid jobs stay out.
  return /^(?:completed|job completed|closed|job closed|paid)(?:\s+duration:\s*\d+(?:\.\d+)?\s*min\(s\))?$/i.test(status.trim());
}
