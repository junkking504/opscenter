import Link from "next/link";
import type { Viewport } from "next";
import { crewAuthConfigured } from "@/lib/crew-auth";
import styles from "./crew-login.module.css";

export const dynamic = "force-dynamic";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#eceeeb",
  colorScheme: "light",
};

type Props = {
  searchParams?: Promise<{ error?: string }>;
};

const errors: Record<string, string> = {
  "invalid-credentials": "Invalid username or password.",
  "session-expired": "Sign in again with the password you created.",
  "not-authenticated": "Sign in to view your Crew portal.",
};

export default async function CrewLoginPage({ searchParams }: Props) {
  const params = await searchParams;
  const error = params?.error ? errors[params.error] : "";
  const configured = crewAuthConfigured();

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.brand}><span className={styles.brandMark} /> OpsCenter Crew</div>
        <h1>Your hours.<br />Your pay.</h1>
        <p className={styles.lead}>
          Use your JunkWare username. The first time you sign in, use the temporary crew password and then create your own password.
        </p>

        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        {!configured ? <div className={styles.error} role="status">Crew sign-in is awaiting administrator setup.</div> : null}

        <form className={styles.form} action="/api/crew/auth/login" method="post">
          <label className={styles.label}>
            <span>JunkWare username</span>
            <input className={styles.input} name="username" autoComplete="username" required autoFocus />
          </label>
          <label className={styles.label}>
            <span>Password</span>
            <input className={styles.input} name="password" type="password" autoComplete="current-password" required />
          </label>
          <button className={styles.button} type="submit" disabled={!configured}>Sign in</button>
        </form>

        <p className={styles.finePrint}>Your personal password is stored as a secure one-way hash. Managers cannot view it.</p>
        <Link className={styles.secondaryLink} href="https://ops.junk-king.app/login">Management sign-in →</Link>
      </section>
    </main>
  );
}
