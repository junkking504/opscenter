"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FleetMaintenanceRecord } from "@/lib/fleet-maintenance";
import type { LinxupVehicleInventory } from "@/lib/linxup-vehicle-inventory";

type ServiceRule = { serviceType: string; label: string; days: number; miles: number | null };
const SERVICE_RULES: ServiceRule[] = [
  { serviceType: "Oil change", label: "Oil and filter", days: 180, miles: 5000 },
  { serviceType: "Tires", label: "Tire inspection", days: 30, miles: null },
  { serviceType: "Brakes", label: "Brake inspection", days: 90, miles: null },
  { serviceType: "Hydraulics", label: "Hydraulic / lift service", days: 90, miles: null },
  { serviceType: "Inspection", label: "Annual vehicle inspection", days: 365, miles: null },
];

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

export default function FleetServicePlanner({ initialRecords, truckOptions, inventory, today }: { initialRecords: FleetMaintenanceRecord[]; truckOptions: string[]; inventory: LinxupVehicleInventory; today: string }) {
  const router = useRouter();
  const [records, setRecords] = useState(initialRecords);
  const [truck, setTruck] = useState(truckOptions[0] || "");
  const [savingType, setSavingType] = useState("");
  const [message, setMessage] = useState("");
  const vehicle = inventory.vehicles.find((row) => row.truck === truck);

  useEffect(() => setRecords(initialRecords), [initialRecords]);

  useEffect(() => {
    if (!truckOptions.includes(truck)) setTruck(truckOptions[0] || "");
  }, [truck, truckOptions]);

  const rows = useMemo(() => SERVICE_RULES.map((rule) => {
    const completed = records.filter((record) => record.truck === truck && record.status === "completed" && record.serviceType === rule.serviceType).sort((a, b) => b.serviceDate.localeCompare(a.serviceDate))[0];
    const scheduled = records.filter((record) => record.truck === truck && record.status === "scheduled" && record.serviceType === rule.serviceType).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate))[0];
    const nextDate = completed ? (completed.nextServiceDate || addDays(completed.serviceDate, rule.days)) : "";
    const nextOdometer = rule.miles != null && completed?.odometer != null ? (completed.nextServiceOdometer ?? completed.odometer + rule.miles) : null;
    const dateDue = Boolean(nextDate && nextDate <= today);
    const mileageDue = Boolean(nextOdometer != null && vehicle?.odometer != null && vehicle.odometer >= nextOdometer);
    const dueSoonDate = Boolean(nextDate && nextDate > today && nextDate <= addDays(today, 30));
    const dueSoonMiles = Boolean(nextOdometer != null && vehicle?.odometer != null && nextOdometer - vehicle.odometer <= 1000 && nextOdometer > vehicle.odometer);
    const status = scheduled ? "scheduled" : !completed ? "baseline" : dateDue || mileageDue ? "overdue" : dueSoonDate || dueSoonMiles ? "soon" : "current";
    return { rule, completed, scheduled, nextDate, nextOdometer, status };
  }), [records, today, truck, vehicle]);

  async function schedule(row: (typeof rows)[number]) {
    setSavingType(row.rule.serviceType);
    setMessage("");
    try {
      const serviceDate = row.status === "current" || row.status === "soon" ? row.nextDate || today : today;
      const response = await fetch("/api/fleet-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truck,
          serviceDate,
          status: "scheduled",
          serviceType: row.rule.serviceType,
          description: `${row.rule.label} scheduled from the Fleet Preventive-Service Planner.`,
          odometer: vehicle?.odometer ?? null,
          nextServiceOdometer: row.nextOdometer,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to schedule this service."));
      setRecords(Array.isArray(payload?.store?.records) ? payload.store.records : records);
      setMessage(`${row.rule.label} scheduled for ${dateLabel(serviceDate)}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to schedule this service.");
    } finally {
      setSavingType("");
    }
  }

  function selectTruck(nextTruck: string) {
    setTruck(nextTruck);
    setMessage("");
  }

  function navigateTruckTabs(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex = index;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % truckOptions.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + truckOptions.length) % truckOptions.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = truckOptions.length - 1;
    else return;

    event.preventDefault();
    selectTruck(truckOptions[nextIndex]);
    document.getElementById(`service-truck-tab-${nextIndex}`)?.focus();
  }

  return (
    <section className="ops-card ops-service-planner-card">
      <div className="ops-card-header compact ops-maintenance-header">
        <div><div className="ops-section-title">Preventive-Service Planner</div><div className="ops-muted">Mileage and date-based recommendations using completed maintenance and current Linxup mileage.</div></div>
      </div>
      <div className="ops-service-truck-tabs-wrap">
        <span className="ops-service-truck-tabs-label">Choose a truck</span>
        <div className="ops-service-truck-tabs" role="tablist" aria-label="Truck service plans">
          {truckOptions.map((option, index) => (
            <button
              type="button"
              role="tab"
              id={`service-truck-tab-${index}`}
              aria-controls="service-truck-panel"
              aria-selected={truck === option}
              tabIndex={truck === option ? 0 : -1}
              className={truck === option ? "active" : ""}
              key={option}
              onClick={() => selectTruck(option)}
              onKeyDown={(event) => navigateTruckTabs(event, index)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div id="service-truck-panel" role="tabpanel" aria-labelledby={`service-truck-tab-${Math.max(0, truckOptions.indexOf(truck))}`}>
        <div className="ops-service-vehicle-summary"><strong>{truck}</strong><span>{vehicle?.odometer == null ? "Odometer unavailable" : `${Math.round(vehicle.odometer).toLocaleString("en-US")} current miles`}</span><span>{vehicle ? [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") : "Vehicle details unavailable"}</span></div>
        <div className="ops-wide-table-wrap"><table className="ops-table ops-service-table"><thead><tr><th>Service</th><th>Last completed</th><th>Next target</th><th>Status</th><th></th></tr></thead><tbody>
        {rows.map((row) => <tr key={row.rule.serviceType}>
          <td><strong>{row.rule.label}</strong><small>{row.rule.miles ? `Every ${row.rule.miles.toLocaleString("en-US")} miles or ${row.rule.days} days` : `Every ${row.rule.days} days`}</small></td>
          <td>{row.completed ? dateLabel(row.completed.serviceDate) : "No baseline"}<small>{row.completed?.odometer == null ? "" : `${Math.round(row.completed.odometer).toLocaleString("en-US")} mi`}</small></td>
          <td>{row.nextDate ? dateLabel(row.nextDate) : "Establish baseline"}<small>{row.nextOdometer == null ? "" : `${Math.round(row.nextOdometer).toLocaleString("en-US")} mi`}</small></td>
          <td><span className={`ops-service-status ${row.status}`}>{row.status === "baseline" ? "Baseline needed" : row.status === "overdue" ? "Due now" : row.status === "soon" ? "Due soon" : row.status === "scheduled" ? "Scheduled" : "Current"}</span></td>
          <td>{row.scheduled ? <small>{dateLabel(row.scheduled.serviceDate)}</small> : <button type="button" className="ops-checklist-load" disabled={Boolean(savingType)} onClick={() => schedule(row)}>{savingType === row.rule.serviceType ? "Scheduling…" : "Schedule"}</button>}</td>
        </tr>)}
        </tbody></table></div>
      </div>
      <div className="ops-maintenance-message" aria-live="polite">{message}</div>
      <p className="ops-service-disclaimer">Default intervals are planning guides. Manufacturer requirements and shop recommendations take priority.</p>
    </section>
  );
}
