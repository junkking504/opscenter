import { headers, cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie, sanitizeAuthRedirectTarget } from "@/lib/auth";
import { waypointEntryTarget } from "@/lib/waypoint-entry";
import { isWaypointAccount } from "@/lib/waypoint-account";
import OpsCenterLogo from "@/components/OpsCenterLogo";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const requestHeaders = await headers();
  const host = (requestHeaders.get('x-forwarded-host') || requestHeaders.get('host') || '').split(':')[0];
  const waypoint = ['waypoint.junk-king.app','kingpin.junk-king.app','jobs.junk-king.app'].includes(host);
  const params = (await searchParams) || {};
  const destination = waypoint ? waypointEntryTarget(firstParam(params.next)) : sanitizeAuthRedirectTarget(firstParam(params.next));
  const cookieStore = await cookies();
  const session = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (session && (!waypoint || isWaypointAccount(session))) {
    redirect(destination);
  }

  const error = firstParam(params.error);
  const next = destination;
  const invalidCredentials = error === "invalid-credentials";
  const rateLimited = error === "rate-limited";

  return (
    <main className="ops-login-shell">
      <div className="ops-login-grid" aria-hidden="true" />
      <section className="ops-login-brand-panel">
        <div className="ops-login-brand" style={{ display: "block", width: 360, maxWidth: "100%" }}>
          <OpsCenterLogo />
          <div className="ops-login-designation" style={{ marginTop: 12 }}>JUNK KING LOUISIANA</div>
        </div>
        <div className="ops-login-system-line">
          <span><i /> System Operational</span>
          <span>Central Time</span>
          <span>Protected Access</span>
        </div>
      </section>

      <section className="ops-login-access-panel">
        <div className="ops-login-access-card">
          <div className="ops-login-access-index">Secure Sign In</div>
          <h1>{waypoint ? "Waypoint manager sign-in" : "Enter OpsCenter"}</h1>
          <p>Enter your OpsCenter username and password to continue.</p>

          <form action="/api/auth/login" method="post" className="ops-login-form">
            <input type="hidden" name="next" value={next} />
            <label>
              <span>Username</span>
              <input
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck="false"
                placeholder="Username"
                className="ops-field"
                required
              />
            </label>

            <label>
              <span>Password</span>
              <input
                name="password"
                type="password"
                autoComplete="current-password"
                placeholder="Password"
                className="ops-field"
                required
              />
            </label>

            {rateLimited ? (
              <div role="alert" className="ops-login-error">
                Too many failed sign-in attempts. Try again in 15 minutes.
              </div>
            ) : invalidCredentials ? (
              <div role="alert" className="ops-login-error">
                Invalid username or password.
              </div>
            ) : null}

            <button type="submit" className="ops-login-button">
              <span>Continue</span><span aria-hidden="true">→</span>
            </button>
          </form>

          <div className="ops-login-footnote">Authorized personnel only · This browser stays trusted for 30 days</div>
        </div>
      </section>
    </main>
  );
}
