import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AUTH_SESSION_COOKIE, verifyAuthSessionCookie } from "@/lib/auth";
import JunkKingLogo from "@/components/JunkKingLogo";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function firstParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] || "";
  return value || "";
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const cookieStore = await cookies();
  const session = await verifyAuthSessionCookie(cookieStore.get(AUTH_SESSION_COOKIE)?.value || "");
  if (session) {
    redirect("/");
  }

  const params = (await searchParams) || {};
  const error = firstParam(params.error);
  const next = firstParam(params.next);
  const invalidCredentials = error === "invalid-credentials";

  return (
    <main className="ops-login-shell">
      <div className="ops-login-grid" aria-hidden="true" />
      <section className="ops-login-brand-panel">
        <div className="ops-login-brand">
          <JunkKingLogo className="ops-login-junk-king-logo" />
          <div>
            <div className="ops-login-wordmark">OPSCENTER</div>
            <div className="ops-login-designation">JUNK KING LOUISIANA</div>
          </div>
        </div>
        <div className="ops-login-hero">
          <div className="ops-login-kicker"><span /> Louisiana operations</div>
          <h1>Run the day.<br />Know the numbers.<br /><em>Keep moving.</em></h1>
          <p>One clear workspace for jobs, crews, trucks, marketing, and financial performance.</p>
        </div>
        <div className="ops-login-system-line">
          <span><i /> System operational</span>
          <span>Central time</span>
          <span>Protected access</span>
        </div>
      </section>

      <section className="ops-login-access-panel">
        <div className="ops-login-access-card">
          <div className="ops-login-access-index">Secure sign in</div>
          <h2>Enter OpsCenter</h2>
          <p>Enter the shared OpsCenter credentials to continue.</p>

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

            {invalidCredentials ? (
              <div role="alert" className="ops-login-error">
                Invalid username or password.
              </div>
            ) : null}

            <button type="submit" className="ops-login-button">
              <span>Continue</span><span aria-hidden="true">→</span>
            </button>
          </form>

          <div className="ops-login-footnote">Authorized personnel only · This browser stays trusted for one year</div>
        </div>
      </section>
    </main>
  );
}
