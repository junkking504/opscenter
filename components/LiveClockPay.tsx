"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateLivePay, durationLabel } from "@/lib/live-pay";

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

type LiveClockProps = {
  date: string;
  clockIn: string;
  clockOut?: string;
  hourlyRate: number | null;
  totalBonus: number;
  tips?: number;
  isSalary: boolean;
};

function useLiveClock(props: LiveClockProps) {
  const [now, setNow] = useState(() => new Date());
  const isOpenHourlyShift = Boolean(props.clockIn) && !props.clockOut && !props.isSalary;

  useEffect(() => {
    if (!isOpenHourlyShift) return;
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, [isOpenHourlyShift]);

  return useMemo(
    () => calculateLivePay({ ...props, now }),
    [props, now],
  );
}

export function LiveClockSummary(props: LiveClockProps) {
  const result = useLiveClock(props);
  if (!result.valid || result.state === "salary") {
    return <span className="ops-cell-secondary">{result.message || result.throughLabel}</span>;
  }
  return (
    <span className="ops-cell-secondary">
      {durationLabel(result.workedSeconds)} · {result.throughLabel}
    </span>
  );
}

export default function LiveClockPay({
  date,
  clockIn,
  clockOut,
  hourlyRate,
  revenueBonus,
  otherBonus,
  totalBonus,
  tips,
  isSalary,
  compact = false,
}: LiveClockProps & {
  revenueBonus: number;
  otherBonus: number;
  tips: number;
  compact?: boolean;
}) {
  const result = useLiveClock({ date, clockIn, clockOut, hourlyRate, totalBonus, tips, isSalary });
  const unavailable = !result.valid || result.state === "salary";
  const detail = result.message || result.throughLabel;

  if (compact) {
    return (
      <div className="ops-pay-stack ops-pay-stack-compact">
        <strong>{result.totalPay == null ? detail : `${money(result.totalPay)} Total Earnings`}</strong>
        {!unavailable && <small>{result.throughLabel}</small>}
      </div>
    );
  }

  return (
    <div className="ops-pay-stack">
      <span>{isSalary ? "Salary" : hourlyRate && hourlyRate > 0 ? `${money(hourlyRate)}/hr` : "Rate unavailable"}</span>
      <span>{result.regularPay == null ? detail : `${money(result.regularPay)} regular`}</span>
      <span title={`Revenue ${money(revenueBonus)} + other ${money(otherBonus)}`}>
        {money(totalBonus)} bonus
      </span>
      <span>{money(tips)} tips</span>
      <strong>{result.totalPay == null ? detail : `${money(result.totalPay)} Total Earnings`}</strong>
      {!unavailable && <small>{result.throughLabel}</small>}
    </div>
  );
}
