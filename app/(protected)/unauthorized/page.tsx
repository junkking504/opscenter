import Link from "next/link";
import { opsRoleLabel, normalizeInteractiveOpsRole } from "@/lib/ops-roles";

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const requiredRole = normalizeInteractiveOpsRole(params?.required, "manager");

  return (
    <section className="ops-card" aria-labelledby="access-restricted-title">
      <div className="ops-card-header compact">
        <div>
          <div className="ops-eyebrow">Role-protected area</div>
          <h1 id="access-restricted-title">Access restricted</h1>
          <p className="ops-muted">
            This area requires {opsRoleLabel(requiredRole)} access. Your signed-in role has not been given this permission.
          </p>
        </div>
      </div>
      <Link className="ops-refresh-button" href="/">Return to Command</Link>
    </section>
  );
}
