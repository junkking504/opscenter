"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

function chicagoDateKey(reference = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(reference);
}

export default function CurrentDataSync({
  selectedDate,
  initialUpdatedAt,
}: {
  selectedDate: string;
  initialUpdatedAt?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const navigatingRef = useRef(false);
  const parsedInitialUpdatedAt = Date.parse(String(initialUpdatedAt || ""));
  const observedUpdatedAtRef = useRef(
    Number.isFinite(parsedInitialUpdatedAt) ? parsedInitialUpdatedAt : 0,
  );

  useEffect(() => {
    navigatingRef.current = false;
    if (Number.isFinite(parsedInitialUpdatedAt)) {
      observedUpdatedAtRef.current = Math.max(
        observedUpdatedAtRef.current,
        parsedInitialUpdatedAt,
      );
    }
  }, [parsedInitialUpdatedAt, selectedDate]);

  const syncCurrentData = useCallback(async () => {
    if (
      navigatingRef.current ||
      searchParams.get("mode") === "historical" ||
      document.visibilityState === "hidden"
    ) return;

    try {
      const response = await fetch(`/api/health?date=${encodeURIComponent(selectedDate)}`, { cache: "no-store" });
      const health = await response.json();
      const metricsDate = String(health?.metricsDate || "");
      const latestDate = String(health?.latestMetricsDate || metricsDate);
      const today = chicagoDateKey();

      if (!/^\d{4}-\d{2}-\d{2}$/.test(latestDate) || latestDate > today) return;

      if (latestDate > selectedDate) {
        navigatingRef.current = true;
        const params = new URLSearchParams(searchParams.toString());
        params.set("date", latestDate);
        params.delete("mode");
        router.replace(`${pathname}?${params.toString()}`);
        return;
      }

      if (metricsDate !== selectedDate) return;
      const remoteUpdatedAt = Date.parse(String(health?.updatedAt || ""));
      if (!Number.isFinite(remoteUpdatedAt)) return;

      // With no timestamp on the current view, establish a baseline first to
      // avoid a refresh loop. Normal daily pages provide generated_at.
      if (observedUpdatedAtRef.current === 0) {
        observedUpdatedAtRef.current = remoteUpdatedAt;
        return;
      }

      if (remoteUpdatedAt > observedUpdatedAtRef.current + 1_000) {
        observedUpdatedAtRef.current = remoteUpdatedAt;
        router.refresh();
      }
    } catch {
      // The next poll or browser online event will retry without disrupting the page.
    }
  }, [pathname, router, searchParams, selectedDate]);

  useEffect(() => {
    if (searchParams.get("mode") === "historical") return;

    void syncCurrentData();
    const interval = window.setInterval(() => void syncCurrentData(), 15_000);
    const handleOnline = () => void syncCurrentData();
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void syncCurrentData();
    };

    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [searchParams, syncCurrentData]);

  return null;
}
