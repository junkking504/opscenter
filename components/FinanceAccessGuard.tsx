import Link from "next/link";
import { opsRoleCan, type InteractiveOpsRole } from "@/lib/ops-roles";

export function financeUnauthorizedState(role: InteractiveOpsRole | null): React.ReactNode | null {
  if (role && opsRoleCan(role, "finance.read")) return null;

  return (
    <section className="ops-card" aria-labelledby="finance-access-restricted-title">
      <div className="ops-card-header compact">
        <div>
          <div className="ops-eyebrow">Role-protected area</div>
          <h1 id="finance-access-restricted-title">Access restricted</h1>
          <p className="ops-muted">
            Finance requires Manager access. Your signed-in role has not been given this permission.
          </p>
        </div>
      </div>
      <Link className="ops-refresh-button" href="/">Return to Command</Link>
    </section>
  );
}
