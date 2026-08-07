"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CrewDataRefresh({ enabled }: { enabled: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => router.refresh(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, [enabled, router]);

  return null;
}
