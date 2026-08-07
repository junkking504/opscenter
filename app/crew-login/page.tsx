import Link from "next/link";
import { crewRoster } from "@/lib/crew-auth";
import { crewAccessConfigured } from "@/lib/cloudflare-access";
import styles from "./crew-login.module.css";

export const dynamic = "force-dynamic";

type Props = {
  searchParams?: Promise<{ error?: string }>;
};

const errors: Record<string, string> = {
  "not-authenticated": "Email verification has not been completed. Crew access may still be awaiting setup.",
  "not-rostered": "Your verified email is not connected to an active crew record. Ask a manager to update the crew roster.",
};

export default async function CrewLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const error = params?.error ? errors[params.error] : "";
  const rosterReady = crewRoster().some((entry) => entry.active);
  const accessReady = crewAccessConfigured();

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}><span className={styles.brandMark} /> OpsCenter Crew</div>
        <h1>Your hours.<br />Your pay.</h1>
        <p className={styles.lead}>
          Sign in with the personal email approved for your crew account. Once verified, this browser can remember you for up to 30 days.
        </p>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {!accessReady || !rosterReady ? (
          <div className={styles.error} role="status">Crew email access is awaiting administrator setup.</div>
        ) : null}

        <div className={styles.form}>
          <Link className={styles.button} href="/my-pay">Continue to My Pay</Link>
          {params?.error === "not-rostered" ? (
            <a className={styles.secondaryLink} href="/cdn-cgi/access/logout">Sign out and use another email</a>
          ) : null}
        </div>

        <p className={styles.finePrint}>Email codes are single-use. On a new device or after the remembered session expires, Cloudflare will ask you to verify again.</p>
        <Link className={styles.secondaryLink} href="https://ops.junk-king.app/login">Management sign-in →</Link>
      </section>
    </main>
  );
}
