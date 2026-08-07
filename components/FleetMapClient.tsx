"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import type { FleetMapPayload } from "@/lib/fleet-map";

const FleetMap = dynamic(() => import("@/components/FleetMap"), {
  ssr: false,
  loading: () => <div className="ops-fleet-map-empty">Loading fleet map…</div>,
});

export default function FleetMapClient({ payload }: { payload: FleetMapPayload }) {
  const [livePayload, setLivePayload] = useState(payload);

  useEffect(() => {
    setLivePayload(payload);
  }, [payload]);

  const refreshFleetMap = useCallback(async () => {
    if (!payload.isToday) return;

    const params = new URLSearchParams({ date: payload.date });
    if (payload.selectedTruck) params.set("truck", payload.selectedTruck);

    try {
      const response = await fetch(`/api/fleet-map?${params.toString()}`, {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) return;

      const nextPayload = (await response.json()) as FleetMapPayload;
      setLivePayload(nextPayload);
    } catch {
      // Keep the last verified map visible during a temporary refresh failure.
    }
  }, [payload.date, payload.isToday, payload.selectedTruck]);

  useEffect(() => {
    if (!payload.isToday) return;

    const timer = window.setInterval(refreshFleetMap, 60_000);
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refreshFleetMap();
    };

    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [payload.isToday, refreshFleetMap]);

  return <FleetMap payload={livePayload} />;
}
