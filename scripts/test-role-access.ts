import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import {
  createAuthSessionCookieValue,
  inspectAuthSessionCookie,
  opsAuthIdentity,
  opsAuthRole,
} from "../lib/auth";
import {
  OPS_ROLES,
  authorizeOpsRequest,
  opsRoleCan,
  requiredOpsPermission,
} from "../lib/ops-roles";
import { middleware } from "../middleware";

async function main() {
  process.env.OPS_AUTH_USERNAME = "mission-control";
  process.env.OPS_AUTH_SESSION_SECRET = "role-access-test-secret";
  delete process.env.OPS_ACCESS_TEAM_DOMAIN;
  delete process.env.OPS_ACCESS_AUD;
  delete process.env.OPS_CREW_ACCESS_TEAM_DOMAIN;
  delete process.env.OPS_CREW_ACCESS_AUD;
  delete process.env.OPS_AUTH_ROLE;
  delete process.env.OPS_AUTH_DEFAULT_ROLE;
  delete process.env.OPS_AUTH_ROLE_BINDINGS;

  assert.equal(opsAuthRole(opsAuthIdentity()), "admin", "The existing configured identity must remain an administrator by default.");
  assert.equal(opsAuthRole("new.dispatcher@junk-king.com"), "operator", "Unbound Access identities must default to operator.");

  process.env.OPS_AUTH_ROLE = "operator";
  assert.equal(opsAuthRole(opsAuthIdentity()), "operator");
  const operatorCookie = await createAuthSessionCookieValue(opsAuthIdentity());
  assert.equal((await inspectAuthSessionCookie(operatorCookie)).session?.role, "operator", "Existing signed sessions must resolve the current configured role.");

  process.env.OPS_AUTH_ROLE_BINDINGS = JSON.stringify({
    "manager@junk-king.com": "manager",
    "admin@junk-king.com": "admin",
  });
  assert.equal(opsAuthRole("manager@junk-king.com"), "manager");
  assert.equal(opsAuthRole("admin@junk-king.com"), "admin");

  assert.deepEqual(OPS_ROLES, ["admin", "operator", "manager", "crew", "service", "agent"]);
  assert.equal(opsRoleCan("operator", "operations.write"), true);
  assert.equal(opsRoleCan("operator", "finance.read"), false);
  assert.equal(opsRoleCan("manager", "finance.read"), true);
  assert.equal(opsRoleCan("manager", "platform.manage"), false);
  assert.equal(opsRoleCan("admin", "platform.manage"), true);

  assert.equal(authorizeOpsRequest("operator", "/jobs", "GET").allowed, true);
  assert.equal(authorizeOpsRequest("operator", "/api/job-route-assignments", "POST").allowed, true);
  assert.equal(authorizeOpsRequest("operator", "/api/job-closeout", "GET").allowed, true);
  assert.equal(authorizeOpsRequest("operator", "/finance", "GET").allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/crew", "GET", new URLSearchParams("section=pay-period")).allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/crew", "GET", new URLSearchParams("view=monthly")).allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/crew", "GET", new URLSearchParams("view=MONTHLY")).allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/crew", "GET", new URLSearchParams("section=crew")).allowed, true);
  assert.equal(authorizeOpsRequest("operator", "/api/payroll-corrections", "GET").allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/api/job-cancellation", "POST").allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/api/job-closeout", "POST").allowed, false);
  assert.equal(authorizeOpsRequest("operator", "/api/fleet-maintenance", "DELETE").allowed, false);
  assert.equal(authorizeOpsRequest("manager", "/finance", "GET").allowed, true);
  assert.equal(authorizeOpsRequest("manager", "/api/job-cancellation", "POST").allowed, true);
  assert.equal(authorizeOpsRequest("admin", "/api/integrations/qbo/disconnect", "POST").allowed, true);
  assert.deepEqual(requiredOpsPermission("/api/manual-bonuses", "GET"), { permission: "finance.read", requiredRole: "manager" });

  const cookieHeader = `opscenter_email_session=${operatorCookie}`;
  const financeResponse = await middleware(new NextRequest("http://127.0.0.1:3100/finance", { headers: { cookie: cookieHeader } }));
  const cancellationResponse = await middleware(new NextRequest("http://127.0.0.1:3100/api/job-cancellation", { method: "POST", headers: { cookie: cookieHeader } }));
  const scheduleResponse = await middleware(new NextRequest("http://127.0.0.1:3100/jobs", { headers: { cookie: cookieHeader } }));
  assert.equal(financeResponse.status, 307, "Operator Finance requests must redirect to the access page.");
  assert.match(financeResponse.headers.get("location") || "", /\/unauthorized\?required=manager/);
  assert.equal(cancellationResponse.status, 403, "Operator cancellation requests must be forbidden server-side.");
  assert.equal((await cancellationResponse.json()).code, "role_forbidden");
  assert.equal(scheduleResponse.status, 200, "Operator Schedule access must remain available.");

  const middlewareSource = readFileSync(new URL("../middleware.ts", import.meta.url), "utf8");
  const navSource = readFileSync(new URL("../components/OpsNav.tsx", import.meta.url), "utf8");
  const layoutSource = readFileSync(new URL("../app/(protected)/layout.tsx", import.meta.url), "utf8");
  const shellSource = readFileSync(new URL("../components/OpsShell.tsx", import.meta.url), "utf8");
  const crewPageSource = readFileSync(new URL("../app/(protected)/crew/page.tsx", import.meta.url), "utf8");
  assert.ok(middlewareSource.includes("authorizeOpsRequest"), "Middleware must enforce role decisions server-side.");
  assert.ok(middlewareSource.includes('code: "role_forbidden"'), "Denied APIs must expose a stable forbidden code.");
  assert.ok(navSource.includes('item.href !== "/finance" || opsRoleCan(role, "finance.read")'), "Finance navigation must follow the role matrix.");
  assert.ok(layoutSource.includes("sessionRole={session.role}"), "The authenticated role must reach the visible shell.");
  assert.ok(shellSource.includes("JKLA · {opsRoleLabel(sessionRole)}"), "The active role must remain visible in the compact sidebar.");
  assert.ok(crewPageSource.includes("canViewPayroll ? <th>Daily earnings</th> : null"), "Operator Krewe tables must omit daily earnings.");
  assert.ok(crewPageSource.includes("canViewPayroll && payrollReview"), "Payroll correction controls must follow the manager permission.");

  console.log("OpsCenter role access checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
