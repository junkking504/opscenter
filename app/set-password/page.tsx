import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { CREW_IDENTITY_HEADER } from "@/lib/crew-auth";
import styles from "../crew-login/crew-login.module.css";

export const dynamic = "force-dynamic";

type Props = { searchParams?: Promise<{ error?: string }> };

const errors: Record<string, string> = {
  "password-mismatch": "The passwords do not match.",
  "password-policy": "Use 10–128 characters with at least one letter and one number.",
  "temporary-password": "Choose a password different from the temporary crew password.",
};

export default async function SetPasswordPage({ searchParams }: Props) {
  const requestHeaders = await headers();
  const employee = String(requestHeaders.get(CREW_IDENTITY_HEADER) || "").trim();
  if (!employee) redirect("/crew-login?error=not-authenticated");
  const params = await searchParams;
  const error = params?.error ? errors[params.error] : "";

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}><span className={styles.brandMark} /> OpsCenter Crew</div>
        <h1>Create your<br />password.</h1>
        <p className={styles.lead}>Welcome, {employee}. The temporary password works only until you complete this step.</p>
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        <form className={styles.form} action="/api/crew/auth/set-password" method="post">
          <label className={styles.label}>
            <span>New password</span>
            <input className={styles.input} name="password" type="password" autoComplete="new-password" minLength={10} maxLength={128} required autoFocus />
          </label>
          <label className={styles.label}>
            <span>Confirm new password</span>
            <input className={styles.input} name="confirmPassword" type="password" autoComplete="new-password" minLength={10} maxLength={128} required />
          </label>
          <button className={styles.button} type="submit">Save password and continue</button>
        </form>
        <p className={styles.finePrint}>Use at least 10 characters, including a letter and a number. Do not reuse the temporary password.</p>
      </section>
    </main>
  );
}
