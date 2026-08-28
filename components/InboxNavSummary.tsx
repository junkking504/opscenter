"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { chicagoDateKey } from "@/lib/chicago-date";
import styles from "./InboxNavSummary.module.css";

type InboxCounts = {
  active: number;
  actNow: number;
};

const REFRESH_INTERVAL_MS = 45_000;

export default function InboxNavSummary() {
  const [counts, setCounts] = useState<InboxCounts | null>(null);
  const date = chicagoDateKey();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/inbox?date=${encodeURIComponent(date)}`, { cache: "no-store" });
      const payload = await response.json().catch(() => null) as { counts?: InboxCounts } | null;
      if (response.ok && payload?.counts) setCounts(payload.counts);
    } catch {
      // Keep the last verified counts visible through a temporary fetch failure.
    }
  }, [date]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refresh]);

  const label = counts
    ? `${counts.actNow} act now · ${counts.active} open · Operating Inbox`
    : "Operating Inbox";

  return (
    <Link
      href={`/inbox?date=${encodeURIComponent(date)}`}
      className={styles.summary}
      aria-label={counts ? `${counts.actNow} items need immediate action, ${counts.active} open in Operating Inbox` : label}
    >
      <span className={styles.signal} aria-hidden="true" />
      <span className={styles.desktopLabel}>{label}</span>
      <span className={styles.mobileLabel}>{counts ? `${counts.actNow} act now` : "Inbox"}</span>
    </Link>
  );
}
