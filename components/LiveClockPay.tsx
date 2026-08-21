"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateLivePay, durationLabel } from "@/lib/live-pay";
import { money } from "@/lib/money";

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
  const [now, setNow] = useState<Date | null>(null);
  const isOpenHourlyShift = Boolean(props.clockIn) && !props.clockOut && !props.isSalary;

  useEffect(() => {
    if (!isOpenHourlyShift) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, [isOpenHourlyShift]);

  return useMemo(
    () => isOpenHourlyShift && !now
      ? null
      : calculateLivePay({ ...props, now: now || new Date(`${props.date}T12:00:00Z`) }),
    [isOpenHourlyShift, props, now],
  );
}

export function LiveClockSummary(props: LiveClockProps) {
  const result = useLiveClock(props);
  if (!result) return <span className="ops-cell-secondary">Updating…</span>;
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
  if (!result) {
    return <div className={`ops-pay-stack${compact ? " ops-pay-stack-compact" : ""}`}>Updating…</div>;
  }
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
