// Mission Control requested permanent suppression of this warning for these
// two employees on 2026-09-12. Other employees and payroll rules still apply.
const IGNORED_SALARY_EMPLOYEES = new Set(["robert mclaughlin", "eugene dabezies"]);
const SALARY_RULE = "salaried_employee_incorrectly_treated_as_hourly";

function employeeKey(name: string): string {
  const parts = name.trim().split(",").map(part => part.trim());
  return (parts.length === 2 ? `${parts[1]} ${parts[0]}` : name)
    .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function isIgnoredOperationalException(exception: { rule: string; entityType: string; entityId: string }): boolean {
  return exception.rule === SALARY_RULE && exception.entityType === "employee"
    && IGNORED_SALARY_EMPLOYEES.has(employeeKey(exception.entityId));
}

export function isIgnoredIncidentFingerprint(fingerprint: string): boolean {
  const match = fingerprint.match(/^payroll_exception:crew-(.+)-salary-as-hourly$/);
  return Boolean(match && IGNORED_SALARY_EMPLOYEES.has(employeeKey(match[1])));
}

export function isIgnoredOperationalSlackText(text: string): boolean {
  // Match the generated title and its employee context, including old resolved
  // copies. Do not suppress other messages merely mentioning either employee.
  const lines = text.split("\n").map(line => line.replace(/:[a-z_]+:/g, "").replace(/\*/g, "").trim()).filter(Boolean);
  const title = lines.findIndex(line => line === "Salaried employee treated as hourly");
  if (title < 0) return false;
  const employee = lines[title + 1]?.match(/^([^:]+):/);
  return Boolean(employee && IGNORED_SALARY_EMPLOYEES.has(employeeKey(employee[1])));
}
