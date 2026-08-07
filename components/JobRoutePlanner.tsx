"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { jobRouteAssignmentKey } from "@/lib/job-route-key";
import type { JobRouteProximityPayload, JobTruckProximity } from "@/lib/job-route-proximity";

type RouteJob = {
  appointmentId: string;
  jkNumber: string;
  appointmentTime: string;
  appointmentStartMinutes: number | null;
  appointmentEndMinutes: number | null;
  hasScheduledTime: boolean;
  customerName: string;
  address: string;
  territory: string;
};

type RouteStop = {
  job: RouteJob;
  distanceFromPreviousMiles: number | null;
  bufferFromPreviousMinutes: number | null;
  warning: string | null;
};

type RouteLane = {
  truck: string;
  stops: RouteStop[];
  directionsUrl: string;
  warningCount: number;
};

type RoutePlan = {
  planningJobs: RouteJob[];
  assignedJobs: number;
  locatedJobs: number;
  unassignedJobs: RouteJob[];
  routes: RouteLane[];
};

function compareStops(a: RouteStop, b: RouteStop): number {
  const aStart = a.job.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
  const bStart = b.job.appointmentStartMinutes ?? Number.MAX_SAFE_INTEGER;
  if (aStart !== bStart) return aStart - bStart;
  return a.job.jkNumber.localeCompare(b.job.jkNumber, undefined, { numeric: true });
}

function directionsUrl(stops: RouteStop[]): string {
  const addresses = stops
    .map((stop) => String(stop.job.address || "").trim())
    .filter((address) => address && address !== "—");
  if (!addresses.length) return "";
  if (addresses.length === 1) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addresses[0])}`;
  }
  const params = new URLSearchParams({
    api: "1",
    origin: addresses[0],
    destination: addresses[addresses.length - 1],
    travelmode: "driving",
  });
  if (addresses.length > 2) params.set("waypoints", addresses.slice(1, -1).join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function jobAnchor(job: RouteJob): string {
  return `job-${job.jkNumber.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
}

function formatGpsTime(value: string | null | undefined): string {
  if (!value) return "time unavailable";
  const stamp = new Date(value);
  if (Number.isNaN(stamp.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  }).format(stamp);
}

function formatTravelTime(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "time unavailable";
  const rounded = Math.max(1, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

function proximityText(proximity: JobTruckProximity | undefined, loading: boolean): string {
  if (loading) return "checking distance…";
  if (!proximity || proximity.status === "truck_gps_unavailable") return "GPS unavailable";
  if (proximity.status === "job_location_unavailable") return "job location unavailable";
  const stale = /stale|offline|historical/i.test(proximity.gpsFreshness);
  const prefix = proximity.source === "google_live_traffic" ? "" : "~";
  const timing = proximity.source === "google_live_traffic" ? "with traffic" : "estimated";
  return `${prefix}${Number(proximity.miles || 0).toFixed(1)} mi · ${formatTravelTime(proximity.travelMinutes)} ${timing}${stale ? " · stale GPS" : ""}`;
}

export default function JobRoutePlanner({
  date,
  plan,
  trucks,
}: {
  date: string;
  plan: RoutePlan;
  trucks: string[];
}) {
  const router = useRouter();
  const [draggedJobKey, setDraggedJobKey] = useState("");
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [proximity, setProximity] = useState<JobRouteProximityPayload | null>(null);
  const [proximityLoading, setProximityLoading] = useState(true);
  const [proximityError, setProximityError] = useState("");

  const stopsByKey = useMemo(() => {
    const entries: Array<[string, RouteStop]> = [];
    for (const route of plan.routes) {
      for (const stop of route.stops) entries.push([jobRouteAssignmentKey(stop.job), stop]);
    }
    for (const job of plan.unassignedJobs) {
      entries.push([
        jobRouteAssignmentKey(job),
        {
          job,
          distanceFromPreviousMiles: null,
          bufferFromPreviousMinutes: null,
          warning: null,
        },
      ]);
    }
    return new Map(entries);
  }, [plan]);

  const serverAssignments = useMemo(() => {
    const assignments: Record<string, string> = {};
    for (const route of plan.routes) {
      for (const stop of route.stops) assignments[jobRouteAssignmentKey(stop.job)] = route.truck;
    }
    for (const job of plan.unassignedJobs) assignments[jobRouteAssignmentKey(job)] = "";
    return assignments;
  }, [plan]);

  const [assignments, setAssignments] = useState<Record<string, string>>(serverAssignments);

  useEffect(() => {
    setAssignments(serverAssignments);
  }, [serverAssignments]);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setInterval> | undefined;
    const jobs = Array.from(stopsByKey.entries()).map(([jobKey, stop]) => ({
      jobKey,
      address: stop.job.address,
    }));

    async function loadProximity(initial: boolean) {
      if (initial) setProximityLoading(true);
      try {
        const response = await fetch("/api/job-route-proximity", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ date, jobs }),
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.distances) throw new Error(payload?.error || "Truck distances are unavailable.");
        if (!active) return;
        setProximity(payload);
        setProximityError("");
      } catch (error) {
        if (!active) return;
        setProximityError(error instanceof Error ? error.message : "Truck distances are unavailable.");
      } finally {
        if (active && initial) setProximityLoading(false);
      }
    }

    void loadProximity(true);
    timer = setInterval(() => void loadProximity(false), 5 * 60_000);
    return () => {
      active = false;
      if (timer) clearInterval(timer);
    };
  }, [date, stopsByKey]);

  const lanes = useMemo(() => {
    const laneMap = new Map<string, RouteStop[]>();
    for (const truck of trucks) laneMap.set(truck, []);
    laneMap.set("", []);
    for (const [jobKey, stop] of stopsByKey) {
      const truck = assignments[jobKey] || "";
      if (!laneMap.has(truck)) laneMap.set(truck, []);
      laneMap.get(truck)!.push(stop);
    }
    for (const stops of laneMap.values()) stops.sort(compareStops);
    return laneMap;
  }, [assignments, stopsByKey, trucks]);

  async function assignJob(jobKey: string, truck: string) {
    const previousTruck = assignments[jobKey] || "";
    if (!jobKey || previousTruck === truck || pendingKeys.includes(jobKey)) return;

    setAssignments((current) => ({ ...current, [jobKey]: truck }));
    setPendingKeys((current) => [...current, jobKey]);
    setMessage("Updating JunkWare and verifying the assignment…");

    try {
      const response = await fetch("/api/job-route-assignments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date,
          jobKey,
          truck,
          appointmentId: stopsByKey.get(jobKey)?.job.appointmentId || "",
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "Could not save that assignment.");

      setMessage(payload.junkwareSynced === false
        ? (payload.warning || "Saved in OpsCenter; JunkWare verification is pending.")
        : truck
          ? `Verified in JunkWare and added to ${truck}'s route.`
          : "Verified in JunkWare and moved to Needs assignment.");
      router.refresh();
    } catch (error) {
      setAssignments((current) => ({ ...current, [jobKey]: previousTruck }));
      setMessage(error instanceof Error ? error.message : "Could not save that assignment.");
    } finally {
      setPendingKeys((current) => current.filter((key) => key !== jobKey));
    }
  }

  function handleDrop(event: React.DragEvent<HTMLElement>, truck: string) {
    event.preventDefault();
    const jobKey = event.dataTransfer.getData("text/plain") || draggedJobKey;
    setDraggedJobKey("");
    setDropTarget(null);
    void assignJob(jobKey, truck);
  }

  const assignedCount = Object.values(assignments).filter(Boolean).length;
  const unassignedCount = Object.values(assignments).filter((truck) => !truck).length;

  function truckProximity(jobKey: string, truck: string): JobTruckProximity | undefined {
    return proximity?.distances?.[jobKey]?.[truck];
  }

  function truckOptionLabel(jobKey: string, truck: string): string {
    return `${truck} — ${proximityText(truckProximity(jobKey, truck), proximityLoading)}`;
  }

  function nearestTruck(jobKey: string): { truck: string; proximity: JobTruckProximity | undefined } | undefined {
    return trucks
      .map((truck) => ({ truck, proximity: truckProximity(jobKey, truck) }))
      .filter((entry) => entry.proximity?.status === "available" && entry.proximity.miles != null)
      .sort((a, b) => Number(a.proximity?.miles) - Number(b.proximity?.miles))[0];
  }

  function nearestTruckLabel(jobKey: string): string {
    if (proximityLoading) return "Checking current truck distances…";
    const nearest = nearestTruck(jobKey);
    if (!nearest) return "Current truck distance unavailable";
    return `Nearest now: ${nearest.truck} · ${proximityText(nearest.proximity, false)}`;
  }

  return (
    <section className={`ops-card ops-route-planner${draggedJobKey ? " is-dragging" : ""}`} id="jobs-dispatch" aria-labelledby="route-planner-title">
      <div className="ops-card-header compact ops-route-planner-header">
        <div>
          <div className="ops-section-title" id="route-planner-title">Dispatch Routes</div>
          <div className="ops-muted">Assign appointments that need a truck, then review active routes.</div>
        </div>
        <div className="ops-route-planner-stats" aria-label="Route planning coverage">
          <span><strong>{assignedCount}</strong> assigned</span>
          <span className={unassignedCount ? "needs-attention" : ""}><strong>{unassignedCount}</strong> need a truck</span>
          <span><strong>{plan.locatedJobs}</strong> of {plan.planningJobs.length} pre-matched for distance checks</span>
        </div>
      </div>

      <div className={`ops-route-proximity-summary${proximityError ? " has-error" : ""}`}>
        {proximityLoading
          ? "Checking each truck’s latest position before assignments are enabled…"
          : proximityError
            ? `${proximityError} Assignment is still available, but distance could not be verified.`
            : proximity?.routingProvider === "google_live_traffic"
              ? `Road mileage and ETA use Google live traffic from each truck’s latest Linxup GPS position · GPS updated ${formatGpsTime(proximity?.fleetUpdatedAt)}`
              : `Approximate proximity uses each truck’s latest Linxup GPS position; road miles and live traffic will appear once Google Routes is configured · GPS updated ${formatGpsTime(proximity?.fleetUpdatedAt)}`}
        {proximity?.routingProvider === "google_live_traffic" ? (
          <small className="ops-route-google-attribution">Powered by Google, ©{new Date().getFullYear()} Google</small>
        ) : null}
      </div>

      <div className="ops-route-planner-hint">
        Empty truck lanes appear while dragging. You can also use each appointment’s truck selector.
      </div>

      <div className="ops-route-plan-grid">
        {trucks.map((truck) => {
          const stops = lanes.get(truck) || [];
          const persistedRoute = plan.routes.find((route) => route.truck === truck);
          const isTarget = dropTarget === truck;
          return (
            <article
              className={`ops-route-plan ops-route-drop-zone${stops.length ? "" : " is-empty"}${persistedRoute?.warningCount ? " has-warning" : ""}${isTarget ? " is-drag-over" : ""}`}
              key={truck}
              onDragEnter={() => setDropTarget(truck)}
              onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={(event) => handleDrop(event, truck)}
            >
              <div className="ops-route-plan-heading">
                <div>
                  <strong>{truck}</strong>
                  <span>{stops.length} scheduled stop{stops.length === 1 ? "" : "s"}</span>
                  {draggedJobKey ? <small>{proximityText(truckProximity(draggedJobKey, truck), proximityLoading)}</small> : null}
                </div>
                {directionsUrl(stops) ? (
                  <a href={directionsUrl(stops)} target="_blank" rel="noopener noreferrer">
                    {stops.length > 1 ? "Open route" : "Open stop"}
                  </a>
                ) : null}
              </div>
              {stops.length ? (
                <ol className="ops-route-stop-list">
                  {stops.map((stop, index) => {
                    const jobKey = jobRouteAssignmentKey(stop.job);
                    const pending = pendingKeys.includes(jobKey);
                    return (
                      <li
                        className={`ops-route-draggable${pending ? " is-saving" : ""}`}
                        draggable={!pending && !proximityLoading}
                        key={jobKey}
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", jobKey);
                          event.dataTransfer.effectAllowed = "move";
                          setDraggedJobKey(jobKey);
                        }}
                        onDragEnd={() => { setDraggedJobKey(""); setDropTarget(null); }}
                      >
                        <div className="ops-route-stop-marker" aria-hidden="true">{index + 1}</div>
                        <div className="ops-route-stop-body">
                          <div className="ops-route-stop-topline">
                            <strong>{stop.job.appointmentTime || "—"}</strong>
                            <a href={`#${jobAnchor(stop.job)}`}>{stop.job.jkNumber || "—"}</a>
                          </div>
                          <span>{stop.job.address && stop.job.address !== "—" ? stop.job.address : "Address unavailable"}</span>
                          <small>{index === 0 ? `First stop · ${stop.job.territory}` : stop.distanceFromPreviousMiles != null ? `Approx. ${stop.distanceFromPreviousMiles.toFixed(1)} mi from prior stop` : `Travel check updates after assignment · ${stop.job.territory}`}</small>
                          {stop.warning && serverAssignments[jobKey] === truck ? <em>{stop.warning}</em> : null}
                          <small className="ops-route-nearest-truck">{nearestTruckLabel(jobKey)}</small>
                          <details className="ops-route-reassign">
                            <summary>Change truck</summary>
                            <label className="ops-route-assignment-control">
                              <span className="ops-visually-hidden">Assign {stop.job.jkNumber} to truck</span>
                              <select value={assignments[jobKey] || ""} disabled={pending || proximityLoading} onChange={(event) => void assignJob(jobKey, event.target.value)}>
                                <option value="">Needs assignment</option>
                                {trucks.map((option) => <option value={option} key={option}>{truckOptionLabel(jobKey, option)}</option>)}
                              </select>
                            </label>
                          </details>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : <div className="ops-route-empty-drop">Drop a job here</div>}
            </article>
          );
        })}

        <article
          className={`ops-route-plan ops-route-unassigned ops-route-drop-zone${dropTarget === "" ? " is-drag-over" : ""}`}
          onDragEnter={() => setDropTarget("")}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; }}
          onDrop={(event) => handleDrop(event, "")}
        >
          <div className="ops-route-plan-heading"><div><strong>Needs assignment</strong><span>{unassignedCount} scheduled stop{unassignedCount === 1 ? "" : "s"}</span></div></div>
          {(lanes.get("") || []).length ? (
            <ol className="ops-route-stop-list">
              {(lanes.get("") || []).map((stop, index) => {
                const jobKey = jobRouteAssignmentKey(stop.job);
                const pending = pendingKeys.includes(jobKey);
                const suggestedTruck = nearestTruck(jobKey)?.truck;
                return (
                  <li
                    className={`ops-route-draggable${pending ? " is-saving" : ""}`}
                    draggable={!pending && !proximityLoading}
                    key={jobKey}
                    onDragStart={(event) => { event.dataTransfer.setData("text/plain", jobKey); setDraggedJobKey(jobKey); }}
                    onDragEnd={() => { setDraggedJobKey(""); setDropTarget(null); }}
                  >
                    <div className="ops-route-stop-marker" aria-hidden="true">{index + 1}</div>
                    <div className="ops-route-stop-body">
                      <div className="ops-route-stop-topline"><strong>{stop.job.appointmentTime || "—"}</strong><a href={`#${jobAnchor(stop.job)}`}>{stop.job.jkNumber || "—"}</a></div>
                      <span>{stop.job.territory} · {stop.job.address && stop.job.address !== "—" ? stop.job.address : "Address unavailable"}</span>
                      <em>{pending ? "Saving assignment…" : "Drag onto a truck or choose one below"}</em>
                      <small className="ops-route-nearest-truck">{nearestTruckLabel(jobKey)}</small>
                      <div className="ops-route-assignment-actions">
                        {suggestedTruck ? (
                          <button type="button" disabled={pending} onClick={() => void assignJob(jobKey, suggestedTruck)}>
                            Assign {suggestedTruck}
                          </button>
                        ) : null}
                        <label className="ops-route-assignment-control">
                          <span className="ops-visually-hidden">Assign {stop.job.jkNumber} to truck</span>
                          <select value="" disabled={pending || proximityLoading} onChange={(event) => void assignJob(jobKey, event.target.value)}>
                            <option value="">{proximityLoading ? "Checking truck distances…" : "Choose another truck…"}</option>
                            {trucks.map((option) => <option value={option} key={option}>{truckOptionLabel(jobKey, option)}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : <div className="ops-route-empty-drop">All scheduled jobs have a truck. Drop one here to unassign it.</div>}
        </article>
      </div>

      <div className="ops-route-planner-note">
        Every assignment is saved and verified in JunkWare before the OpsCenter route is updated. Traffic refreshes every five minutes.
      </div>
      <div className="ops-route-save-status" aria-live="polite">{message}</div>
    </section>
  );
}
