export const OPS_ROLES = ["admin", "operator", "manager", "crew", "service", "agent"] as const;
export type OpsRole = (typeof OPS_ROLES)[number];

export const INTERACTIVE_OPS_ROLES = ["admin", "operator", "manager"] as const;
export type InteractiveOpsRole = (typeof INTERACTIVE_OPS_ROLES)[number];

export type OpsPermission =
  | "operations.read"
  | "operations.write"
  | "finance.read"
  | "sensitive.write"
  | "platform.manage";

const ROLE_PERMISSIONS: Record<InteractiveOpsRole, ReadonlySet<OpsPermission>> = {
  admin: new Set(["operations.read", "operations.write", "finance.read", "sensitive.write", "platform.manage"]),
  manager: new Set(["operations.read", "operations.write", "finance.read", "sensitive.write"]),
  operator: new Set(["operations.read", "operations.write"]),
};

export function normalizeInteractiveOpsRole(value: unknown, fallback: InteractiveOpsRole = "operator"): InteractiveOpsRole {
  const role = String(value || "").trim().toLowerCase();
  return INTERACTIVE_OPS_ROLES.includes(role as InteractiveOpsRole) ? role as InteractiveOpsRole : fallback;
}

export function opsRoleLabel(role: InteractiveOpsRole): string {
  if (role === "admin") return "Administrator";
  if (role === "manager") return "Manager";
  return "Operator";
}

export function opsRoleCan(role: InteractiveOpsRole, permission: OpsPermission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export type OpsAccessDecision = {
  allowed: boolean;
  permission: OpsPermission;
  requiredRole: "operator" | "manager" | "admin";
};

const FINANCE_RESOURCE_PREFIXES = [
  "/api/manual-bonuses",
  "/api/payroll-corrections",
  "/api/resale-items",
  "/api/integrations/qbo/status",
  "/api/integrations/qbo/disconnect",
] as const;

const SENSITIVE_WRITE_ROUTES = [
  "/api/job-cancellation",
  "/api/job-closeout",
  "/api/fleet-checklist-templates",
  "/api/integrations/podium/reviews/attribution",
  "/api/integrations/qbo/disconnect",
] as const;

const PLATFORM_MANAGE_RESOURCE_PREFIXES = [
  "/api/integrations/podium/connect",
  "/api/integrations/podium/callback",
] as const;

export function requiredOpsPermission(
  pathname: string,
  method: string,
  searchParams?: Pick<URLSearchParams, "get"> | null,
): Omit<OpsAccessDecision, "allowed"> {
  const normalizedMethod = String(method || "GET").trim().toUpperCase();

  const crewView = String(searchParams?.get("view") || "").trim().toLowerCase();
  const crewSection = String(searchParams?.get("section") || "").trim().toLowerCase();
  if (pathname === "/crew" && (crewView === "monthly" || crewSection === "pay-period")) {
    return { permission: "finance.read", requiredRole: "manager" };
  }

  if (pathname === "/finance" || pathname.startsWith("/finance/")) {
    return { permission: "finance.read", requiredRole: "manager" };
  }

  if (PLATFORM_MANAGE_RESOURCE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
    return { permission: "platform.manage", requiredRole: "admin" };
  }

  const financeResource = FINANCE_RESOURCE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
  if (financeResource) {
    const permission = normalizedMethod === "GET" || normalizedMethod === "HEAD" ? "finance.read" : "sensitive.write";
    return { permission, requiredRole: "manager" };
  }

  if (normalizedMethod === "DELETE" || (["POST", "PUT", "PATCH"].includes(normalizedMethod) && SENSITIVE_WRITE_ROUTES.some((route) => pathname === route))) {
    return { permission: "sensitive.write", requiredRole: "manager" };
  }

  if (["POST", "PUT", "PATCH"].includes(normalizedMethod)) {
    return { permission: "operations.write", requiredRole: "operator" };
  }

  return { permission: "operations.read", requiredRole: "operator" };
}

export function authorizeOpsRequest(
  role: InteractiveOpsRole,
  pathname: string,
  method: string,
  searchParams?: Pick<URLSearchParams, "get"> | null,
): OpsAccessDecision {
  const requirement = requiredOpsPermission(pathname, method, searchParams);
  return {
    ...requirement,
    allowed: opsRoleCan(role, requirement.permission),
  };
}
