"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FleetMapPayload, FleetMapStop, FleetTruckMapRecord } from "@/lib/fleet-map";
import { truckMapMarkerIcon, truckMapMarkerOffsets, truckMapMarkerScale } from "@/components/TruckMapMarker";

type LeafletModule = typeof import("leaflet");

const STREET_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const STREET_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function normalizeTruckLabel(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const match = raw.match(/(\d+)/);
  return match ? `Truck# ${match[1]}` : raw.replace(/\s+/g, " ");
}

function truckNumber(value: string | null | undefined): string {
  const raw = String(value || "").trim();
  const match = raw.match(/(\d+)/);
  return match ? match[1] : raw;
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function formatMinutes(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  const total = Math.round(value);
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours <= 0) return `${minutes} min`;
  return `${hours}h ${minutes}m`;
}

function formatScore(record: FleetTruckMapRecord): string {
  const display = String(record.driverScoreDisplay || "").trim();
  if (display) return display;
  if (record.driverScore == null || Number.isNaN(record.driverScore)) return "Unavailable";
  return record.driverScore.toFixed(1);
}

function formatNumber(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "—";
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function escapeHtml(value: string): string {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stopColor(kind: FleetMapStop["kind"]): string {
  switch (kind) {
    case "At Job":
      return "#60a5fa";
    case "At Yard":
      return "#22c55e";
    case "At Dump/Recycling":
      return "#ef4444";
    case "At Fuel":
      return "#f59e0b";
    default:
      return "#94a3b8";
  }
}

export default function FleetMap({ payload }: { payload: FleetMapPayload }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const mapNodeRef = useRef<HTMLDivElement | null>(null);
  const [leaflet, setLeaflet] = useState<LeafletModule | null>(null);
  const mapRef = useRef<any>(null);
  const markersRef = useRef<any>(null);
  const routeRef = useRef<any>(null);
  const fittedViewportRef = useRef("");
  const [mapZoom, setMapZoom] = useState(12);
  const selectedTruckParam = searchParams.get("truck");
  const selectedTruck = selectedTruckParam ? normalizeTruckLabel(selectedTruckParam) : "";
  const fleetMode = !selectedTruckParam;

  useEffect(() => {
    let active = true;
    import("leaflet").then((module) => {
      if (!active) return;
      const resolved = ((module as unknown as { default?: LeafletModule }).default || module) as LeafletModule;
      setLeaflet(resolved);
    });
    return () => {
      active = false;
    };
  }, []);

  const selectedTruckRecord = useMemo(
    () => (selectedTruck ? payload.trucks.find((record) => record.truck === selectedTruck) || null : null),
    [payload.trucks, selectedTruck],
  );

  const allTruckBounds = useMemo(() => {
    if (!leaflet) return null;
    const points = payload.trucks
      .filter((truck) => truck.hasCoordinates && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude))
      .map((truck) => [truck.latitude as number, truck.longitude as number] as [number, number]);
    return points.length ? leaflet.latLngBounds(points) : null;
  }, [leaflet, payload.trucks]);

  const selectedRouteBounds = useMemo(() => {
    if (!leaflet || !selectedTruckRecord) return null;
    const routePoints = selectedTruckRecord.routePoints
      .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
      .map((point) => [point.latitude, point.longitude] as [number, number]);
    const routeStops = selectedTruckRecord.routeStops
      .filter((stop) => Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude))
      .map((stop) => [stop.latitude, stop.longitude] as [number, number]);
    const points = [...routePoints, ...routeStops];
    return points.length ? leaflet.latLngBounds(points) : null;
  }, [leaflet, selectedTruckRecord]);

  useEffect(() => {
    if (!leaflet || !mapNodeRef.current || mapRef.current) return;
    const mapNode = mapNodeRef.current;
    const map = leaflet.map(mapNode, {
      zoomControl: true,
      scrollWheelZoom: true,
      preferCanvas: false,
      attributionControl: true,
    });

    leaflet.tileLayer(STREET_TILES, {
      attribution: STREET_ATTRIBUTION,
      maxZoom: 20,
    }).addTo(map);

    const markers = leaflet.layerGroup().addTo(map);
    const routes = leaflet.layerGroup().addTo(map);

    mapRef.current = map;
    markersRef.current = markers;
    routeRef.current = routes;
    const handleZoomEnd = () => setMapZoom(map.getZoom());
    map.on("zoomend", handleZoomEnd);

    let resizeFrame: number | null = null;
    const invalidateMapSize = () => {
      if (resizeFrame != null) window.cancelAnimationFrame(resizeFrame);
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        map.invalidateSize({ pan: false, debounceMoveend: true });
      });
    };

    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(invalidateMapSize);
    resizeObserver?.observe(mapNode);
    window.addEventListener("resize", invalidateMapSize);
    invalidateMapSize();

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", invalidateMapSize);
      map.off("zoomend", handleZoomEnd);
      if (resizeFrame != null) window.cancelAnimationFrame(resizeFrame);
      map.remove();
      mapRef.current = null;
      markersRef.current = null;
      routeRef.current = null;
    };
  }, [leaflet]);

  useEffect(() => {
    const map = mapRef.current;
    const markers = markersRef.current;
    const routes = routeRef.current;
    if (!map || !markers || !routes || !leaflet) return;

    markers.clearLayers();
    routes.clearLayers();

    const visibleTrucks = payload.trucks.filter(
      (truck) =>
        truck.hasCoordinates
        && Number.isFinite(truck.latitude)
        && Number.isFinite(truck.longitude)
        && (fleetMode || truck.truck === selectedTruck),
    );
    const selectedTruckBounds = selectedTruckRecord?.hasCoordinates
      && Number.isFinite(selectedTruckRecord.latitude)
      && Number.isFinite(selectedTruckRecord.longitude)
      ? leaflet.latLngBounds([[selectedTruckRecord.latitude as number, selectedTruckRecord.longitude as number]])
      : null;
    const targetBounds = fleetMode ? allTruckBounds : selectedRouteBounds || selectedTruckBounds;
    const viewportSignature = visibleTrucks
      .map((truck) => `${truck.truck}:${truck.latitude}:${truck.longitude}`)
      .sort()
      .join("|");
    const targetSignature = `${fleetMode ? "fleet" : selectedTruck}:${viewportSignature}`;
    if (targetBounds && targetBounds.isValid() && fittedViewportRef.current !== targetSignature) {
      if (targetBounds.getNorthEast().equals(targetBounds.getSouthWest())) {
        map.setView(targetBounds.getCenter(), visibleTrucks.length === 1 ? 12 : 10);
      } else {
        map.fitBounds(targetBounds.pad(0.15), {
          padding: [24, 24],
          maxZoom: visibleTrucks.length === 1 ? 13 : 15,
        });
      }
      fittedViewportRef.current = targetSignature;
    } else if (!targetBounds?.isValid()) {
      fittedViewportRef.current = "";
    }
    const labelOffsets = truckMapMarkerOffsets(visibleTrucks, (truck) => truck.truck, (truck) =>
      map.latLngToLayerPoint([truck.latitude as number, truck.longitude as number])
    );

    for (const truck of visibleTrucks) {
      const isSelected = selectedTruck === truck.truck;
      const marker = leaflet.marker([truck.latitude as number, truck.longitude as number], {
        icon: truckMapMarkerIcon(leaflet, truck.truck, {
          atJob: truck.operationalStatus === "At Job",
          labelOffset: labelOffsets.get(truck.truck) || 0,
          scale: truckMapMarkerScale(mapZoom),
          selected: isSelected,
        }),
        alt: truck.truck,
        keyboard: false,
        zIndexOffset: isSelected ? 1000 : 0,
      });

      const selectTruck = () => {
        if (isSelected) return;
        const params = new URLSearchParams(searchParams.toString());
        params.set("date", payload.date);
        params.set("truck", truckNumber(truck.truck));
        router.push(`${pathname}?${params.toString()}`, { scroll: false });
      };
      marker.on("click", selectTruck);
      const bindTruckMarker = () => {
        const markerButton = marker.getElement()?.querySelector<HTMLElement>(".ops-truck-map-marker");
        if (!markerButton || markerButton.dataset.clickBound === "true") return;
        markerButton.dataset.clickBound = "true";
        markerButton.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          selectTruck();
        });
        markerButton.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          event.stopPropagation();
          selectTruck();
        });
      };
      marker.once("add", () => window.requestAnimationFrame(bindTruckMarker));
      marker.addTo(markers);
      bindTruckMarker();
    }

    if (!fleetMode && selectedRouteBounds) {
      const routePoints = selectedTruckRecord?.routePoints || [];
      const linePoints = routePoints
        .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
        .map((point) => [point.latitude, point.longitude] as [number, number]);

      if (linePoints.length > 1) {
        leaflet.polyline(linePoints, {
          color: "#60a5fa",
          weight: 4,
          opacity: 0.95,
          lineJoin: "round",
          lineCap: "round",
        }).addTo(routes);
      }

      selectedTruckRecord?.routeStops.forEach((stop) => {
        if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return;
        leaflet.circleMarker([stop.latitude, stop.longitude], {
          radius: 7,
          color: stopColor(stop.kind),
          weight: 3,
          fillColor: "#ffffff",
          fillOpacity: 0.9,
        })
          .bindPopup(
            `<div class="ops-fleet-popup">
              <div class="ops-fleet-popup-title">${escapeHtml(stop.label)}</div>
              <div class="ops-fleet-popup-line"><span>Type</span><strong>${escapeHtml(stop.kind)}</strong></div>
              <div class="ops-fleet-popup-line"><span>Begin</span><strong>${escapeHtml(formatTimestamp(stop.begin))}</strong></div>
              <div class="ops-fleet-popup-line"><span>End</span><strong>${escapeHtml(formatTimestamp(stop.end))}</strong></div>
            </div>`,
            { className: "ops-fleet-popup-frame", maxWidth: 300 },
          )
          .addTo(routes);
      });
    }

  }, [allTruckBounds, fleetMode, leaflet, mapZoom, payload.date, payload.trucks, router, searchParams, pathname, selectedRouteBounds, selectedTruck, selectedTruckRecord]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const timer = window.setInterval(() => {
      map.invalidateSize();
    }, 60000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => mapRef.current?.invalidateSize(), 50);
    return () => window.clearTimeout(timer);
  }, [payload.date]);

  const mapMessage = !payload.routeHistoryAvailable ? "GPS history unavailable" : payload.gpsDataStatus;

  const showEntireFleet = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", payload.date);
    params.delete("truck");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  const resetSelectedTruck = () => {
    if (!selectedTruckRecord) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("date", payload.date);
    params.set("truck", truckNumber(selectedTruckRecord.truck));
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <div className="ops-card ops-fleet-map-card">
      <div className="ops-card-header compact ops-fleet-map-header">
        <div>
          <div className="ops-section-title">Fleet GPS Map</div>
          <div className="ops-muted">
            {payload.isToday ? "Live day view" : "Historical snapshot"} · {mapMessage}
          </div>
        </div>
        <div className="ops-fleet-map-meta">
          <div>
            <span>Last updated</span>
            <strong>{formatTimestamp(payload.lastUpdatedAt)}</strong>
          </div>
          <div>
            <span>GPS coverage</span>
            <strong>
              {payload.trucksWithCoordinates} of {payload.trucks.length} trucks
            </strong>
          </div>
          <div>
            <span>Stale threshold</span>
            <strong>{payload.staleThresholdMinutes} min</strong>
          </div>
        </div>
      </div>

      <div className="ops-fleet-map-toolbar">
        <button type="button" className="ops-map-control-button" onClick={showEntireFleet}>
          Show Entire Fleet
        </button>
        {selectedTruckRecord && !fleetMode && (
          <button type="button" className="ops-map-control-button secondary" onClick={resetSelectedTruck}>
            Reset Selected Truck
          </button>
        )}
      </div>

      <div className="ops-fleet-map-shell">
        {payload.trucksWithCoordinates > 0 || payload.routeHistoryAvailable ? (
          <div ref={mapNodeRef} className="ops-fleet-leaflet-map" aria-label="Fleet truck map" />
        ) : (
          <div className="ops-fleet-map-empty">GPS history unavailable</div>
        )}
      </div>

      <div className="ops-fleet-map-foot">
        <div className="ops-fleet-map-status">
          <span className="ops-fleet-map-badge">{payload.gpsDataStatus}</span>
          {payload.trucksWithoutCoordinates.length > 0 && (
            <span className="ops-fleet-map-note">
              Trucks without verified coordinates: {payload.trucksWithoutCoordinates.join(", ")}. GPS totals can still appear
              in the tables while the tracker-to-truck mapping awaits verification.
            </span>
          )}
        </div>
      </div>

      {selectedTruckRecord && !fleetMode && (
        <div className="ops-fleet-selected-panel">
          <div className="ops-driver-panel-title">
            Selected Truck: <strong>{selectedTruckRecord.truck}</strong>
          </div>
          <div className="ops-fleet-detail-grid">
            <div>
              <span>Year / Make / Model</span>
              <strong>{selectedTruckRecord.yearMakeModel}</strong>
            </div>
            <div>
              <span>Location</span>
              <strong>
                {selectedTruckRecord.latitude != null && selectedTruckRecord.longitude != null
                  ? `${selectedTruckRecord.latitude.toFixed(4)}, ${selectedTruckRecord.longitude.toFixed(4)}`
                  : "Location unavailable"}
              </strong>
            </div>
            <div>
              <span>{selectedTruckRecord.freshnessLabel === "Live GPS" ? "Speed" : "Last Reported Speed"}</span>
              <strong>{selectedTruckRecord.speed == null ? "—" : `${selectedTruckRecord.speed} mph`}</strong>
            </div>
            <div>
              <span>{selectedTruckRecord.freshnessLabel === "Live GPS" ? "Ignition" : "Last Reported Ignition"}</span>
              <strong>{selectedTruckRecord.ignition}</strong>
            </div>
            <div>
              <span>Last GPS Update</span>
              <strong>{formatTimestamp(selectedTruckRecord.lastGpsUpdate)}</strong>
            </div>
            <div>
              <span>Freshness</span>
              <strong>{selectedTruckRecord.freshnessLabel}</strong>
            </div>
            <div>
              <span>Driver</span>
              <strong>{selectedTruckRecord.driver}</strong>
            </div>
            <div>
              <span>Navigator</span>
              <strong>{selectedTruckRecord.navigator}</strong>
            </div>
            <div>
              <span>Driver Score</span>
              <strong>{formatScore(selectedTruckRecord)}</strong>
            </div>
            <div>
              <span>Score Source</span>
              <strong>{selectedTruckRecord.scoreSource}</strong>
            </div>
            <div>
              <span>Confidence</span>
              <strong>{selectedTruckRecord.confidence}</strong>
            </div>
            <div>
              <span>Current / Historical Appointment</span>
              <strong>{selectedTruckRecord.currentOrHistoricalAppointment}</strong>
            </div>
            <div>
              <span>Miles Driven</span>
              <strong>{selectedTruckRecord.milesDriven == null ? "—" : `${formatNumber(selectedTruckRecord.milesDriven)} mi`}</strong>
            </div>
            <div>
              <span>Odometer</span>
              <strong>{selectedTruckRecord.odometer}</strong>
            </div>
            <div>
              <span>Drive Time</span>
              <strong>{selectedTruckRecord.driveTime}</strong>
            </div>
            <div>
              <span>Idle Time</span>
              <strong>{selectedTruckRecord.idleTime}</strong>
            </div>
            <div>
              <span>Jobs Completed</span>
              <strong>{selectedTruckRecord.jobsCompleted == null ? "—" : selectedTruckRecord.jobsCompleted}</strong>
            </div>
            <div>
              <span>Estimates</span>
              <strong>{selectedTruckRecord.estimates == null ? "—" : selectedTruckRecord.estimates}</strong>
            </div>
            <div>
              <span>Total Site Time</span>
              <strong>{selectedTruckRecord.totalSiteTimeMinutes == null ? "—" : formatMinutes(selectedTruckRecord.totalSiteTimeMinutes)}</strong>
            </div>
            <div>
              <span>Overall Revenue</span>
              <strong>{selectedTruckRecord.revenue == null ? "—" : `$${formatNumber(selectedTruckRecord.revenue)}`}</strong>
            </div>
            <div>
              <span>Service Status</span>
              <strong>{selectedTruckRecord.serviceStatus}</strong>
            </div>
            <div>
              <span>Mileage Until Next Service</span>
              <strong>{selectedTruckRecord.mileageUntilNextService}</strong>
            </div>
            <div>
              <span>Days Until Next Service</span>
              <strong>{selectedTruckRecord.daysUntilNextService}</strong>
            </div>
          </div>

          <div className="ops-driver-alerts">
            <div className="ops-driver-panel-title">Safety Alerts</div>
            <div className="ops-driver-alert-grid">
              {selectedTruckRecord.safetyAlerts.map((alert) => (
                <div key={alert.label} className="ops-driver-alert-pill">
                  {alert.available ? `${alert.label}: ${alert.value == null ? "—" : formatNumber(alert.value)}` : `${alert.label}: unavailable`}
                </div>
              ))}
            </div>
            <details className="ops-alert-details">
              <summary>View alerts {selectedTruckRecord.alertEventCount > 0 ? `(${selectedTruckRecord.alertEventCount})` : ''}</summary>
              <div className="ops-alert-detail-list">
                {selectedTruckRecord.alertEvents.length > 0 ? selectedTruckRecord.alertEvents.map((alert) => (
                  <div key={alert.alert_id || `${alert.alert_type}-${alert.occurred_at}-${alert.truck_number}`} className="ops-alert-detail-row">
                    <div><span>Time</span><strong>{formatTimestamp(alert.occurred_at)}</strong></div>
                    <div><span>Type</span><strong>{alert.alert_type_normalized || alert.alert_type || "unknown"}</strong></div>
                    <div><span>Truck</span><strong>{alert.truck_number || "—"}</strong></div>
                    <div><span>Driver</span><strong>{alert.driver_name || "—"}</strong></div>
                    <div><span>Location</span><strong>{alert.address || alert.geofence_name || "—"}</strong></div>
                    <div><span>Severity</span><strong>{alert.severity || "—"}</strong></div>
                    <div><span>Video</span><strong>{alert.video_available ? "Available" : "Unavailable"}</strong></div>
                  </div>
                )) : <div className="ops-muted">No alert detail available.</div>}
              </div>
            </details>
          </div>

          {selectedTruckRecord.routeStops.length > 0 && (
            <div className="ops-route-stop-list">
              <div className="ops-driver-panel-title">Route stops</div>
              {selectedTruckRecord.routeStops.map((stop) => (
                <div key={`${stop.kind}-${stop.label}-${stop.begin}-${stop.end}`} className="ops-route-stop-row">
                  <strong>{stop.kind}</strong>
                  <span>{stop.label}</span>
                  <span>
                    {formatTimestamp(stop.begin)} → {formatTimestamp(stop.end)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
