import { opsRoleCan, type InteractiveOpsRole } from "@/lib/ops-roles";

export function canViewCrewPayroll(role: InteractiveOpsRole | null | undefined): boolean {
  return Boolean(role && opsRoleCan(role, "finance.read"));
}

export function canShowCrewPayrollReview<T>(
  role: InteractiveOpsRole | null | undefined,
  payrollReview: T | null | undefined,
): payrollReview is T {
  return canViewCrewPayroll(role) && Boolean(payrollReview);
}
