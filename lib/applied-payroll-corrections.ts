import { payrollCorrectionsForDate, normalizePayrollEmployeeKey, type PayrollCorrection } from './payroll-corrections';
import { payrollSyncForCorrection } from './junkware-payroll-sync';

/** A rejected edit that never reached JunkWare is audit history, not a
 * timesheet override. Keep pending/uncertain submissions visible until verified.
 * Legacy local corrections without a synchronization receipt retain their scope.
 */
export function appliedPayrollCorrectionsForDate(date: string): Record<string, PayrollCorrection> {
  return Object.fromEntries(Object.entries(payrollCorrectionsForDate(date)).filter(([, correction]) => {
    const sync = payrollSyncForCorrection(correction);
    return !(sync?.status === 'failed' && !sync.submittedAt && ['queued', 'reading'].includes(sync.phase));
  }));
}

export function appliedPayrollCorrectionForEmployee(date: string, employeeName: string): PayrollCorrection | null {
  return appliedPayrollCorrectionsForDate(date)[normalizePayrollEmployeeKey(employeeName)] || null;
}
