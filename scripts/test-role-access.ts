import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { financeUnauthorizedState } from "../components/FinanceAccessGuard";
import { opsNavigationItems } from "../components/navItems";
import OpsRoleBadge from "../components/OpsRoleBadge";
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
import { canShowCrewPayrollReview, canViewCrewPayroll } from "../lib/crew-payroll-access";
import { opsShellSessionProps } from "../lib/ops-shell-session";
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
  const operatorInspection = await inspectAuthSessionCookie(operatorCookie);
  assert.equal(operatorInspection.session?.role, "operator", "Existing signed sessions must resolve the current configured role.");

  process.env.OPS_AUTH_ROLE_BINDINGS = "admin=admin";
  assert.equal(
    opsAuthRole("admin@different-domain.example"),
    "operator",
    "A local-part-shaped binding must not grant a role to a full address at another domain.",
  );

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

  assert.equal(opsNavigationItems("operator").some((item) => item.href === "/finance"), false, "Operator navigation must omit Finance.");
  assert.equal(opsNavigationItems("manager").some((item) => item.href === "/finance"), true, "Manager navigation must include Finance.");
  assert.equal(opsNavigationItems("operator", true).some((item) => item.href === "/finance"), false, "Kernel-enabled navigation must retain the Finance role filter.");

  assert.ok(operatorInspection.session);
  const shellProps = opsShellSessionProps(operatorInspection.session);
  assert.equal(shellProps.sessionRole, "operator", "The authenticated role must reach the visible shell props.");
  const roleBadgeMarkup = renderToStaticMarkup(OpsRoleBadge({ role: shellProps.sessionRole }));
  assert.match(roleBadgeMarkup, /JKLA · OPERATOR/, "The compact shell badge must render the active role.");

  assert.equal(canViewCrewPayroll("operator"), false, "Operator Krewe views must omit payroll fields.");
  assert.equal(canViewCrewPayroll("manager"), true, "Manager Krewe views must include payroll fields.");
  assert.equal(canShowCrewPayrollReview("operator", { status: "review" }), false, "Operator Krewe views must omit payroll controls.");
  assert.equal(canShowCrewPayrollReview("manager", { status: "review" }), true, "Manager Krewe views must include an available payroll control.");

  const unauthorizedFinanceMarkup = renderToStaticMarkup(financeUnauthorizedState("operator"));
  assert.match(unauthorizedFinanceMarkup, /Access restricted/, "An in-page Finance guard must render the unauthorized state.");
  assert.doesNotMatch(
    unauthorizedFinanceMarkup,
    /revenue|margin|payroll|reconciliation|payments & recon|\$\d/i,
    "The unauthorized Finance state must not render financial values or labels.",
  );

  process.env.OPS_ACCESS_TEAM_DOMAIN = "https://test-team.cloudflareaccess.com";
  process.env.OPS_ACCESS_AUD = "test-access-audience";
  const unauthenticatedPage = await middleware(new NextRequest("https://ops.example.test/fleet?view=maintenance"));
  const unauthenticatedHead = await middleware(new NextRequest("https://ops.example.test/fleet", { method: "HEAD" }));
  const unauthenticatedApi = await middleware(new NextRequest("https://ops.example.test/api/job-cancellation"));

  for (const response of [unauthenticatedPage, unauthenticatedHead]) {
    assert.equal(response.status, 307, "Unauthenticated page navigation must redirect to Cloudflare Access.");
    const location = new URL(response.headers.get("location") || "");
    assert.equal(location.origin, "https://test-team.cloudflareaccess.com");
    assert.equal(location.pathname, "/cdn-cgi/access/login/ops.example.test");
    assert.equal(location.searchParams.get("kid"), "test-access-audience");
  }
  assert.equal(unauthenticatedPage.headers.get("cache-control"), "no-store, max-age=0");
  assert.equal(new URL(unauthenticatedPage.headers.get("location") || "").searchParams.get("redirect_url"), "/fleet?view=maintenance");
  assert.equal(unauthenticatedApi.status, 401, "Unauthenticated API requests must retain a JSON 401 response.");
  assert.deepEqual(await unauthenticatedApi.json(), { error: "Cloudflare Access authentication required." });

  console.log("OpsCenter role access checks passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
