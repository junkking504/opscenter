"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { FleetMapPayload, FleetMapStop, FleetTruckMapRecord } from "@/lib/fleet-map";

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

function statusTone(status: string): string {
  switch (status) {
    case "Driving":
      return "driving";
    case "At Job":
      return "job";
    case "At Dump/Recycling":
      return "dump";
    case "At Yard":
      return "yard";
    case "NOHQ":
    case "BRHQ":
      return "yard";
    case "GL":
    case "RBL":
    case "BRL":
    case "STS":
    case "GMTS":
    case "EMR":
      return "dump";
    case "Idle":
      return "idle";
    case "Offline":
      return "offline";
    case "GPS Stale":
      return "stale";
    default:
      return "unknown";
  }
}

function operationalLabel(record: FleetTruckMapRecord): string {
  if (record.freshnessLabel === "Offline") return "Offline";
  if (record.freshnessLabel === "GPS Stale") return "GPS Stale — last movement is not current";
  if (record.operationalStatus === "Driving") return "Driving";
  if (record.operationalStatus === "At Job") return "At Job";
  if (record.operationalStatus === "At Dump/Recycling") return "At Dump/Recycling";
  if (record.operationalStatus === "At Yard") return "At Yard";
  if (record.operationalStatus === "Idle") return "Idle";
  return record.operationalStatus || "Stopped";
}

function markerIcon(leaflet: LeafletModule, record: FleetTruckMapRecord, selected: boolean) {
  const status = statusTone(record.freshnessLabel === "Offline" ? "Offline" : record.operationalStatus);
  const html = `
    <div class="ops-fleet-marker ${selected ? "is-selected" : ""} ${status}">
      <span class="ops-fleet-marker-dot"></span>
      <span class="ops-fleet-marker-text">T${escapeHtml(truckNumber(record.truck))}</span>
    </div>
  `;
  return leaflet.divIcon({
    className: "",
    html,
    iconSize: [62, 28],
    iconAnchor: [31, 14],
    popupAnchor: [0, -12],
  });
}

type FleetMarkerCluster = {
  latitude: number;
  longitude: number;
  trucks: FleetTruckMapRecord[];
};

function clusterVisibleTrucks(map: any, trucks: FleetTruckMapRecord[], minimumPixelDistance = 42): FleetMarkerCluster[] {
  const clusters: FleetMarkerCluster[] = [];
  for (const truck of trucks) {
    const point = map.latLngToLayerPoint([truck.latitude as number, truck.longitude as number]);
    const match = clusters.find((cluster) => {
      const clusterPoint = map.latLngToLayerPoint([cluster.latitude, cluster.longitude]);
      return point.distanceTo(clusterPoint) < minimumPixelDistance;
    });
    if (match) {
      match.trucks.push(truck);
    } else {
      clusters.push({ latitude: truck.latitude as number, longitude: truck.longitude as number, trucks: [truck] });
    }
  }
  return clusters;
}

function fleetClusterIcon(leaflet: LeafletModule, count: number) {
  return leaflet.divIcon({
    className: "",
    html: `<span class="ops-map-cluster is-trucks"><b>${count}</b><small>trucks</small></span>`,
    iconSize: [46, 46],
    iconAnchor: [23, 23],
    popupAnchor: [0, -22],
  });
}

function fleetClusterPopup(trucks: FleetTruckMapRecord[]) {
  return `<div class="ops-map-cluster-popup"><strong>${trucks.length} trucks here</strong><span>Select a truck to review its route and details.</span><div>${trucks.map((truck) => `<button type="button" data-fleet-truck="${escapeHtml(truck.truck)}">${escapeHtml(truck.truck)} · ${escapeHtml(operationalLabel(truck))}</button>`).join("")}</div></div>`;
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

function truckPopup(record: FleetTruckMapRecord): string {
  const driverState = record.driver && record.driver !== "—" ? escapeHtml(record.driver) : "Unassigned";
  const navigatorState = record.navigator && record.navigator !== "—" ? escapeHtml(record.navigator) : "Unassigned";
  return `
    <div class="ops-fleet-popup">
      <div class="ops-fleet-popup-title">${escapeHtml(record.truck)}</div>
      <div class="ops-fleet-popup-line"><span>Status</span><strong>${escapeHtml(operationalLabel(record))}</strong></div>
      <div class="ops-fleet-popup-line"><span>Last GPS</span><strong>${escapeHtml(formatTimestamp(record.lastGpsUpdate))}</strong></div>
      <div class="ops-fleet-popup-line"><span>${record.freshnessLabel === "Live GPS" ? "Speed" : "Last reported speed"}</span><strong>${record.speed == null ? "—" : `${formatNumber(record.speed)} mph`}</strong></div>
      <div class="ops-fleet-popup-line"><span>${record.freshnessLabel === "Live GPS" ? "Ignition" : "Last reported ignition"}</span><strong>${escapeHtml(record.ignition || "—")}</strong></div>
      <div class="ops-fleet-popup-line"><span>Driver</span><strong>${driverState}</strong></div>
      <div class="ops-fleet-popup-line"><span>Navigator</span><strong>${navigatorState}</strong></div>
      <div class="ops-fleet-popup-line"><span>Miles</span><strong>${record.milesDriven == null ? "—" : `${formatNumber(record.milesDriven)} mi`}</strong></div>
      <div class="ops-fleet-popup-line"><span>Driver score</span><strong>${formatScore(record)}</strong></div>
      <div class="ops-fleet-popup-line"><span>Service status</span><strong>${escapeHtml(record.serviceStatus || "Unavailable")}</strong></div>
    </div>
  `;
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
  const lastAutoFitDateRef = useRef("");
  const lastFocusedTruckRef = useRef("");
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
    // Clustering converts coordinates to screen points, which requires an initial view.
    map.setView([30.45, -91.15], 7, { animate: false });

    leaflet.tileLayer(STREET_TILES, {
      attribution: STREET_ATTRIBUTION,
      maxZoom: 20,
    }).addTo(map);

    const markers = leaflet.layerGroup().addTo(map);
    const routes = leaflet.layerGroup().addTo(map);

    mapRef.current = map;
    markersRef.current = markers;
    routeRef.current = routes;

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

    const visibleTrucks = payload.trucks.filter(
      (truck) => truck.hasCoordinates && Number.isFinite(truck.latitude) && Number.isFinite(truck.longitude),
    );

    const openTruck = (truck: FleetTruckMapRecord) => {
      const params = new URLSearchParams(searchParams.toString());
      params.set("date", payload.date);
      params.set("truck", truckNumber(truck.truck));
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    };

    const drawMapItems = () => {
      markers.clearLayers();
      routes.clearLayers();

      const selectedTruckItem = visibleTrucks.find((truck) => truck.truck === selectedTruck);
      const clusters = clusterVisibleTrucks(
        map,
        visibleTrucks.filter((truck) => truck.truck !== selectedTruck),
      );
      for (const cluster of clusters) {
        if (cluster.trucks.length === 1) {
          const truck = cluster.trucks[0];
          const marker = leaflet.marker([truck.latitude as number, truck.longitude as number], {
            icon: markerIcon(leaflet, truck, false), keyboard: true, title: truck.truck,
          });
          marker.bindPopup(truckPopup(truck), { className: "ops-fleet-popup-frame", maxWidth: 340 });
          marker.on("click", () => openTruck(truck));
          marker.addTo(markers);
          continue;
        }
        const marker = leaflet.marker([cluster.latitude, cluster.longitude], {
          icon: fleetClusterIcon(leaflet, cluster.trucks.length), keyboard: true,
          title: `${cluster.trucks.length} trucks in this area`, zIndexOffset: 900,
        });
        marker.bindPopup(fleetClusterPopup(cluster.trucks), { className: "ops-fleet-popup-frame", maxWidth: 300 });
        marker.on("popupopen", () => {
          const popup = marker.getPopup()?.getElement();
          popup?.querySelectorAll<HTMLButtonElement>("[data-fleet-truck]").forEach((button) => {
            const truck = cluster.trucks.find((item) => item.truck === button.dataset.fleetTruck);
            button.onclick = () => { if (truck) openTruck(truck); };
          });
        });
        marker.addTo(markers);
      }
      if (selectedTruckItem) {
        const marker = leaflet.marker([selectedTruckItem.latitude as number, selectedTruckItem.longitude as number], {
          icon: markerIcon(leaflet, selectedTruckItem, true), keyboard: true, title: selectedTruckItem.truck, zIndexOffset: 1200,
        });
        marker.bindPopup(truckPopup(selectedTruckItem), { className: "ops-fleet-popup-frame", maxWidth: 340 });
        marker.on("click", () => openTruck(selectedTruckItem));
        marker.addTo(markers);
      }

      if (!fleetMode && selectedRouteBounds) {
        const routePoints = selectedTruckRecord?.routePoints || [];
        const linePoints = routePoints
          .filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))
          .map((point) => [point.latitude, point.longitude] as [number, number]);

        if (linePoints.length > 1) {
          leaflet.polyline(linePoints, {
            color: "#60a5fa", weight: 4, opacity: 0.95, lineJoin: "round", lineCap: "round",
          }).addTo(routes);
        }

        selectedTruckRecord?.routeStops.forEach((stop) => {
          if (!Number.isFinite(stop.latitude) || !Number.isFinite(stop.longitude)) return;
          leaflet.circleMarker([stop.latitude, stop.longitude], {
            radius: 7, color: stopColor(stop.kind), weight: 3, fillColor: "#ffffff", fillOpacity: 0.9,
          })
            .bindPopup(
              `<div class="ops-fleet-popup"><div class="ops-fleet-popup-title">${escapeHtml(stop.label)}</div><div class="ops-fleet-popup-line"><span>Type</span><strong>${escapeHtml(stop.kind)}</strong></div><div class="ops-fleet-popup-line"><span>Begin</span><strong>${escapeHtml(formatTimestamp(stop.begin))}</strong></div><div class="ops-fleet-popup-line"><span>End</span><strong>${escapeHtml(formatTimestamp(stop.end))}</strong></div></div>`,
              { className: "ops-fleet-popup-frame", maxWidth: 300 },
            )
            .addTo(routes);
        });
      }
    };

    drawMapItems();
    map.on("zoomend", drawMapItems);
    return () => map.off("zoomend", drawMapItems);
  }, [allTruckBounds, fleetMode, leaflet, payload.date, payload.trucks, router, searchParams, pathname, selectedRouteBounds, selectedTruck, selectedTruckRecord]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!fleetMode && selectedTruckRecord) {
      const focusKey = `${payload.date}:${selectedTruckRecord.truck}`;
      if (lastFocusedTruckRef.current === focusKey) return;
      lastFocusedTruckRef.current = focusKey;
      if (selectedRouteBounds?.isValid()) {
        if (selectedRouteBounds.getNorthEast().equals(selectedRouteBounds.getSouthWest())) {
          map.setView(selectedRouteBounds.getCenter(), 12, { animate: true });
        } else {
          map.fitBounds(selectedRouteBounds.pad(0.15), { padding: [24, 24], maxZoom: 15, animate: true });
        }
      } else if (selectedTruckRecord.hasCoordinates) {
        map.setView([selectedTruckRecord.latitude as number, selectedTruckRecord.longitude as number], 12, { animate: true });
      }
      return;
    }

    lastFocusedTruckRef.current = "";
    if (lastAutoFitDateRef.current === payload.date || !allTruckBounds?.isValid()) return;
    lastAutoFitDateRef.current = payload.date;
    if (allTruckBounds.getNorthEast().equals(allTruckBounds.getSouthWest())) {
      map.setView(allTruckBounds.getCenter(), payload.trucksWithCoordinates === 1 ? 12 : 10);
    } else {
      map.fitBounds(allTruckBounds.pad(0.15), { padding: [24, 24], maxZoom: payload.trucksWithCoordinates === 1 ? 13 : 15 });
    }
  }, [allTruckBounds, fleetMode, payload.date, payload.trucksWithCoordinates, selectedRouteBounds, selectedTruckRecord]);

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
