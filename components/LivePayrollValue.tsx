"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateLivePay } from "@/lib/live-pay";

export type LivePayrollRecord = {
  clockIn: string;
  clockOut: string;
  hourlyRate: number | null;
  totalBonus: number;
  tips: number;
  supplementalPay?: number;
  isSalary: boolean;
  weeklyHoursBeforeShift?: number;
};

function money(value: number): string {
  return value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function LivePayrollValue({
  date,
  records,
  field,
  baseAmount = 0,
  revenue = 0,
  showIncompleteNote = true,
}: {
  date: string;
  records: LivePayrollRecord[];
  field: "regular" | "regular-pay" | "overtime-hours" | "overtime" | "overtime-pay" | "labor" | "bonus" | "total" | "tips" | "earnings" | "percentage";
  baseAmount?: number;
  revenue?: number;
  showIncompleteNote?: boolean;
}) {
  const [now, setNow] = useState<Date | null>(null);
  const hasOpenShift = records.some((row) => row.clockIn && !row.clockOut && !row.isSalary);

  useEffect(() => {
    if (!hasOpenShift) return;
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 30000);
    return () => window.clearInterval(timer);
  }, [hasOpenShift]);

  const result = useMemo(() => {
    if (hasOpenShift && !now) return null;
    const calculationTime = now || new Date(`${date}T12:00:00Z`);
    let regular = 0;
    let regularPay = 0;
    let overtimeHours = 0;
    let overtime = 0;
    let overtimePay = 0;
    let labor = 0;
    let bonus = 0;
    let tips = 0;
    let supplemental = 0;
    let incomplete = 0;
    for (const row of records) {
      bonus += Number(row.totalBonus || 0);
      tips += Number(row.tips || 0);
      supplemental += Number(row.supplementalPay || 0);
      const pay = calculateLivePay({
        date,
        clockIn: row.clockIn,
        clockOut: row.clockOut,
        hourlyRate: row.hourlyRate,
        totalBonus: row.totalBonus,
        isSalary: row.isSalary,
        weeklyHoursBeforeShift: row.weeklyHoursBeforeShift,
        now: calculationTime,
      });
      if (pay.hourlyLaborCost != null) {
        regular += pay.hourlyLaborCost - (pay.overtimePremium || 0);
        regularPay += pay.regularPay || 0;
        overtimeHours += pay.overtimeHours || 0;
        overtime += pay.overtimePremium || 0;
        overtimePay += pay.overtimePay || 0;
        labor += pay.hourlyLaborCost;
      }
      else if (!row.isSalary) incomplete += 1;
    }
    const values = {
      regular,
      "regular-pay": regularPay,
      "overtime-hours": overtimeHours,
      overtime,
      "overtime-pay": overtimePay,
      labor,
      bonus,
      tips,
      total: labor + bonus + supplemental,
      earnings: labor + bonus + supplemental + tips,
    };
    const payroll = baseAmount + values.total;
    const value = field === "percentage"
      ? revenue > 0 ? payroll / revenue * 100 : 0
      : baseAmount + values[field];
    return { value, incomplete };
  }, [baseAmount, date, field, hasOpenShift, now, records, revenue]);

  if (!result) {
    return <span className="ops-live-pay-pending">Updating…</span>;
  }

  return (
    <span>
      {field === "percentage"
        ? `${result.value.toFixed(2)}%`
        : field === "overtime-hours"
          ? `${result.value.toFixed(2)} hrs`
          : money(result.value)}
      {showIncompleteNote && result.incomplete > 0 && (
        <small className="ops-live-pay-note">{result.incomplete} shift{result.incomplete === 1 ? "" : "s"} unavailable</small>
      )}
    </span>
  );
}
