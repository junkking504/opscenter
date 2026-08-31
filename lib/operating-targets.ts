function envNumber(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export const operatingTargets = {
  annualRevenue: envNumber("OPSCENTER_ANNUAL_REVENUE_TARGET", 2_000_000),
  operatingDaysPerYear: envNumber("OPSCENTER_OPERATING_DAYS_PER_YEAR", 365),
  maxPayrollPercent: envNumber("OPSCENTER_MAX_PAYROLL_PERCENT", 16),
  minOperatingMarginPercent: envNumber("OPSCENTER_MIN_OPERATING_MARGIN_PERCENT", 20),
  averageJobSize: envNumber("OPSCENTER_AVERAGE_JOB_SIZE_TARGET", 650),
  minDriverScore: envNumber("OPSCENTER_MIN_DRIVER_SCORE", 80),
} as const;

export function monthlyRevenueTarget(): number {
  return operatingTargets.annualRevenue / 12;
}

export function dailyRevenueTarget(): number {
  return operatingTargets.annualRevenue / operatingTargets.operatingDaysPerYear;
}
