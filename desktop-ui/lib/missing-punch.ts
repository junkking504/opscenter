import type { HoursDay } from './krewe-hours-contract';
import type { DesktopCrewMember } from './people-fleet-contract';
import { payrollDayActivity, recordedPayrollClock } from './payroll-review';

/** Display only: use the same clock precedence and work evidence as payroll review. */
export function missingPunch(day: HoursDay, evidence?: DesktopCrewMember['days'][number]) {
  const clockIn = recordedPayrollClock(day.clockIn) || recordedPayrollClock(evidence?.clockIn);
  const clockOut = recordedPayrollClock(day.clockOut) || recordedPayrollClock(evidence?.clockOut);
  // A source gap cannot establish an employee's missed punch. A live open
  // shift is explicitly classified by the source, not inferred from a blank.
  const eligible = !day.isSalary && !['Upcoming', 'Source Unavailable'].includes(day.status) && payrollDayActivity(day, evidence);
  const missingIn = eligible && !clockIn;
  const missingOut = eligible && !clockOut && day.status !== 'On Shift';
  const label = missingIn && missingOut ? 'Missing clock-in and clock-out' : missingIn ? 'Missing clock-in' : missingOut ? 'Missing clock-out' : '';
  return { clockIn, clockOut, missingIn, missingOut, label };
}
