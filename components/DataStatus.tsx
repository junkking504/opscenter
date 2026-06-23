"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type DataStatusProps = {
  status: "Provisional" | "Final";
  lastUpdated?: string;
};

function formatTimestamp(value?: string) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

export function DataStatus({ status, lastUpdated }: DataStatusProps) {
  const router = useRouter();
  // Use null as the initial state to avoid SSR/client hydration mismatch.
  // The timestamp is only set after mount.
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);

  useEffect(() => {
    // Set initial checked time after mount so server and client HTML match.
    setRefreshedAt(new Date());

    const timer = window.setInterval(() => {
      router.refresh();
      setRefreshedAt(new Date());
    }, 300000);

    return () => window.clearInterval(timer);
  }, [router]);

  return (
    <div className="flex flex-col gap-1 text-sm text-muted sm:items-end">
      <div className="flex items-center gap-2">
        <span className="font-medium text-ink">Data status:</span>
        <span className={status === "Final" ? "text-good" : "text-warn"}>{status}</span>
      </div>
      <div>Last updated: {formatTimestamp(lastUpdated)}</div>
      <div className="text-xs">
        Auto refresh: 5 min
        {refreshedAt ? <> · Checked {formatTimestamp(refreshedAt.toISOString())}</> : null}
      </div>
    </div>
  );
}
