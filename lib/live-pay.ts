import { calculateWeeklyOvertime } from "@/lib/overtime";

export const CHICAGO_TIME_ZONE = "America/Chicago";
export const MAX_SHIFT_SECONDS = 18 * 60 * 60;

export type LivePayInput = {
  date: string;
  clockIn?: string;
  clockOut?: string;
  hourlyRate?: number | null;
  totalBonus?: number;
  tips?: number;
  isSalary?: boolean;
  weeklyHoursBeforeShift?: number;
  now?: Date;
};

export type LivePayResult = {
  valid: boolean;
  state: "open" | "final" | "salary" | "missing_clock" | "missing_rate" | "invalid_shift";
  message: string;
  workedSeconds: number | null;
  workedHours: number | null;
  regularHours: number | null;
  overtimeHours: number | null;
  regularPay: number | null;
  overtimePay: number | null;
  overtimePremium: number | null;
  hourlyLaborCost: number | null;
  totalPay: number | null;
  throughLabel: string;
};

function clockParts(value: string): { hour: number; minute: number } | null {
  const match = String(value || "").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
  const ampm = match[3].toUpperCase();
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return { hour, minute };
}

export function chicagoClockToDate(date: string, value: string): Date | null {
  const dateMatch = String(date || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const time = clockParts(value);
  if (!dateMatch || !time) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const desiredUtc = Date.UTC(year, month - 1, day, time.hour, time.minute, 0);
  let candidate = new Date(desiredUtc);

  // Resolve the America/Chicago UTC offset without relying on the browser's
  // local timezone. Two passes also handle daylight-saving boundaries.
  for (let pass = 0; pass < 2; pass += 1) {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: CHICAGO_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const representedUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    );
    candidate = new Date(candidate.getTime() + (desiredUtc - representedUtc));
  }
  return candidate;
}

export function chicagoTimeLabel(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: CHICAGO_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(value);
}

export function calculateLivePay(input: LivePayInput): LivePayResult {
  const bonus = Number(input.totalBonus || 0);
  const tips = Number(input.tips || 0);
  if (input.isSalary) {
    return {
      valid: true,
      state: "salary",
      message: "Salary — live hourly calculation not applied",
      workedSeconds: null,
      workedHours: null,
      regularHours: null,
      overtimeHours: null,
      regularPay: null,
      overtimePay: null,
      overtimePremium: null,
      hourlyLaborCost: null,
      totalPay: bonus + tips,
      throughLabel: "Salary",
    };
  }

  const start = chicagoClockToDate(input.date, input.clockIn || "");
  if (!start) {
    return {
      valid: false,
      state: "missing_clock",
      message: "Clock-in unavailable",
      workedSeconds: null,
      workedHours: null,
      regularHours: null,
      overtimeHours: null,
      regularPay: null,
      overtimePay: null,
      overtimePremium: null,
      hourlyLaborCost: null,
      totalPay: null,
      throughLabel: "Clock-in unavailable",
    };
  }

  const rate = Number(input.hourlyRate);
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      valid: false,
      state: "missing_rate",
      message: "Rate unavailable",
      workedSeconds: null,
      workedHours: null,
      regularHours: null,
      overtimeHours: null,
      regularPay: null,
      overtimePay: null,
      overtimePremium: null,
      hourlyLaborCost: null,
      totalPay: null,
      throughLabel: "Rate unavailable",
    };
  }

  const finalEnd = input.clockOut
    ? chicagoClockToDate(input.date, input.clockOut)
    : null;
  if (input.clockOut && !finalEnd) {
    return {
      valid: false,
      state: "invalid_shift",
      message: "Invalid clock-out",
      workedSeconds: null,
      workedHours: null,
      regularHours: null,
      overtimeHours: null,
      regularPay: null,
      overtimePay: null,
      overtimePremium: null,
      hourlyLaborCost: null,
      totalPay: null,
      throughLabel: "Invalid shift",
    };
  }

  const end = finalEnd || input.now || new Date();
  const workedSeconds = (end.getTime() - start.getTime()) / 1000;
  if (workedSeconds < 0 || workedSeconds > MAX_SHIFT_SECONDS) {
    return {
      valid: false,
      state: "invalid_shift",
      message: workedSeconds < 0 ? "Clock-out precedes clock-in" : "Implausible shift duration",
      workedSeconds,
      workedHours: null,
      regularHours: null,
      overtimeHours: null,
      regularPay: null,
      overtimePay: null,
      overtimePremium: null,
      hourlyLaborCost: null,
      totalPay: null,
      throughLabel: "Shift requires review",
    };
  }

  const workedHours = workedSeconds / 3600;
  const priorHours = Math.max(0, Number(input.weeklyHoursBeforeShift || 0));
  const [, overtime] = calculateWeeklyOvertime([
    { hours: priorHours, hourlyRate: rate, straightTimePay: priorHours * rate },
    { hours: workedHours, hourlyRate: rate, straightTimePay: workedHours * rate },
  ]);
  const state = finalEnd ? "final" : "open";
  return {
    valid: true,
    state,
    message: "",
    workedSeconds,
    workedHours,
    regularHours: overtime.regularHours,
    overtimeHours: overtime.overtimeHours,
    regularPay: overtime.regularPay,
    overtimePay: overtime.overtimePay,
    overtimePremium: overtime.overtimePremium,
    hourlyLaborCost: overtime.hourlyLaborCost,
    totalPay: overtime.hourlyLaborCost + bonus + tips,
    throughLabel: `${state === "final" ? "Final" : "Estimated"} through ${chicagoTimeLabel(end)}`,
  };
}

export function durationLabel(seconds: number | null): string {
  if (seconds == null || seconds < 0) return "—";
  const totalMinutes = Math.floor(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
