import { opsRoleLabel, type InteractiveOpsRole } from "@/lib/ops-roles";

export function opsRoleBadgeText(role: InteractiveOpsRole): string {
  return `JKLA · ${role.toUpperCase()}`;
}

export default function OpsRoleBadge({ role }: { role: InteractiveOpsRole }) {
  return (
    <span className="ops-sidebar-footer-code" aria-label={`${opsRoleLabel(role)} access`}>
      {opsRoleBadgeText(role)}
    </span>
  );
}
