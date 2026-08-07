export const WEEKLY_REGULAR_HOURS = 40;
export const OVERTIME_MULTIPLIER = 1.5;

export type OvertimeShiftInput = {
  hours: number;
  hourlyRate?: number | null;
  straightTimePay?: number | null;
  isSalary?: boolean;
};

export type OvertimeShiftResult = {
  hours: number;
  regularHours: number;
  overtimeHours: number;
  straightTimePay: number;
  regularPay: number;
  overtimeBasePay: number;
  overtimePremium: number;
  overtimePay: number;
  hourlyLaborCost: number;
};

function nonNegative(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

/**
 * Allocates shifts in chronological order against a 40-hour workweek.
 *
 * `straightTimePay` is the employee's existing hours × rate cost before the
 * overtime premium. Overtime pay is the full 1.5× cost of overtime hours;
 * overtimePremium is the additional 0.5× labor cost.
 */
export function calculateWeeklyOvertime(
  shifts: OvertimeShiftInput[],
): OvertimeShiftResult[] {
  let remainingRegularHours = WEEKLY_REGULAR_HOURS;

  return shifts.map((shift) => {
    const hours = nonNegative(shift.hours);
    const hourlyRate = nonNegative(shift.hourlyRate);
    const recordedStraightTimePay = nonNegative(shift.straightTimePay);
    const straightTimePay =
      recordedStraightTimePay > 0
        ? recordedStraightTimePay
        : !shift.isSalary && hourlyRate > 0
          ? hours * hourlyRate
          : 0;

    if (shift.isSalary) {
      return {
        hours,
        regularHours: hours,
        overtimeHours: 0,
        straightTimePay,
        regularPay: straightTimePay,
        overtimeBasePay: 0,
        overtimePremium: 0,
        overtimePay: 0,
        hourlyLaborCost: straightTimePay,
      };
    }

    const regularHours = Math.min(hours, remainingRegularHours);
    const overtimeHours = Math.max(0, hours - regularHours);
    remainingRegularHours = Math.max(0, remainingRegularHours - regularHours);

    const regularShare = hours > 0 ? regularHours / hours : 0;
    const regularPay = straightTimePay * regularShare;
    const overtimeBasePay = straightTimePay - regularPay;
    const overtimePremium = overtimeHours * hourlyRate * (OVERTIME_MULTIPLIER - 1);
    const overtimePay = overtimeBasePay + overtimePremium;

    return {
      hours,
      regularHours,
      overtimeHours,
      straightTimePay,
      regularPay,
      overtimeBasePay,
      overtimePremium,
      overtimePay,
      hourlyLaborCost: regularPay + overtimePay,
    };
  });
}
