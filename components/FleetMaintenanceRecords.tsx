"use client";
/* eslint-disable @next/next/no-img-element -- authenticated local photo endpoints are not compatible with the Next image optimizer */

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { FleetMaintenancePhoto, FleetMaintenanceRecord, MaintenanceStatus } from "@/lib/fleet-maintenance";
import type { LinxupVehicleInventory, LinxupVehicleProfile } from "@/lib/linxup-vehicle-inventory";

const SERVICE_TYPES = [
  "Oil change",
  "Tires",
  "Brakes",
  "Inspection",
  "Engine",
  "Transmission",
  "Electrical",
  "Hydraulics",
  "Body / lift",
  "Other",
];

type MaintenanceDraft = {
  recordId: string;
  truck: string;
  serviceDate: string;
  status: MaintenanceStatus;
  serviceType: string;
  description: string;
  odometer: string;
  cost: string;
  vendor: string;
  nextServiceDate: string;
  nextServiceOdometer: string;
  notes: string;
};

function odometerForTruck(vehicles: LinxupVehicleProfile[], truck: string): string {
  const value = vehicles.find((vehicle) => vehicle.truck === truck)?.odometer;
  return value == null ? "" : String(Math.round(value));
}

function blankDraft(today: string, truckOptions: string[], vehicles: LinxupVehicleProfile[]): MaintenanceDraft {
  const truck = truckOptions[0] || "";
  return {
    recordId: "",
    truck,
    serviceDate: today,
    status: "completed",
    serviceType: "Oil change",
    description: "",
    odometer: odometerForTruck(vehicles, truck),
    cost: "",
    vendor: "",
    nextServiceDate: "",
    nextServiceOdometer: "",
    notes: "",
  };
}

function draftFromRecord(record: FleetMaintenanceRecord): MaintenanceDraft {
  return {
    recordId: record.recordId,
    truck: record.truck,
    serviceDate: record.serviceDate,
    status: record.status,
    serviceType: record.serviceType,
    description: record.description,
    odometer: record.odometer == null ? "" : String(record.odometer),
    cost: record.cost == null ? "" : record.cost.toFixed(2),
    vendor: record.vendor,
    nextServiceDate: record.nextServiceDate,
    nextServiceOdometer: record.nextServiceOdometer == null ? "" : String(record.nextServiceOdometer),
    notes: record.notes,
  };
}

function money(value: number | null): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function mileage(value: number | null): string {
  if (value == null) return "—";
  return `${Math.round(value).toLocaleString("en-US")} mi`;
}

function vehicleDescription(vehicle: LinxupVehicleProfile): string {
  return [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(" ") || "—";
}

function odometerSourceLabel(vehicle: LinxupVehicleProfile): string {
  if (vehicle.odometerSource === "true") return "ECM odometer";
  if (vehicle.odometerSource === "virtual") return "Linxup virtual odometer";
  if (vehicle.odometerSource === "estimated") return "Linxup estimated odometer";
  return "Odometer unavailable";
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function sortRecords(records: FleetMaintenanceRecord[]): FleetMaintenanceRecord[] {
  return records.slice().sort((a, b) => b.serviceDate.localeCompare(a.serviceDate) || a.truck.localeCompare(b.truck, undefined, { numeric: true }));
}

export default function FleetMaintenanceRecords({
  initialRecords,
  truckOptions,
  today,
  linxupInventory,
}: {
  initialRecords: FleetMaintenanceRecord[];
  truckOptions: string[];
  today: string;
  linxupInventory: LinxupVehicleInventory;
}) {
  const router = useRouter();
  const [records, setRecords] = useState(() => sortRecords(initialRecords));
  const [draft, setDraft] = useState<MaintenanceDraft>(() => blankDraft(today, truckOptions, linxupInventory.vehicles));
  const [formOpen, setFormOpen] = useState(initialRecords.length === 0);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [truckFilter, setTruckFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const vehiclesByTruck = useMemo(() => new Map(linxupInventory.vehicles.map((vehicle) => [vehicle.truck, vehicle])), [linxupInventory.vehicles]);
  const selectedVehicle = vehiclesByTruck.get(draft.truck);
  const platesOnFile = linxupInventory.vehicles.filter((vehicle) => vehicle.licensePlate).length;

  const allTruckOptions = useMemo(() => Array.from(new Set([
    ...truckOptions,
    ...records.map((record) => record.truck),
  ])).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [records, truckOptions]);

  const summary = useMemo(() => {
    const scheduled = records.filter((record) => record.status === "scheduled");
    const limit = new Date(`${today}T12:00:00`);
    limit.setDate(limit.getDate() + 30);
    const limitKey = limit.toISOString().slice(0, 10);
    return {
      overdue: scheduled.filter((record) => record.serviceDate < today).length,
      dueSoon: scheduled.filter((record) => record.serviceDate >= today && record.serviceDate <= limitKey).length,
      completed: records.filter((record) => record.status === "completed").length,
      cost: records.filter((record) => record.status === "completed").reduce((sum, record) => sum + (record.cost || 0), 0),
    };
  }, [records, today]);

  const visibleRecords = useMemo(() => records.filter((record) =>
    (truckFilter === "all" || record.truck === truckFilter) &&
    (statusFilter === "all" || record.status === statusFilter)
  ), [records, statusFilter, truckFilter]);

  function setField<K extends keyof MaintenanceDraft>(field: K, value: MaintenanceDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function startNew() {
    setDraft(blankDraft(today, allTruckOptions, linxupInventory.vehicles));
    setFormOpen(true);
    setMessage("");
    setPendingPhotos([]);
  }

  function startEdit(record: FleetMaintenanceRecord) {
    setDraft(draftFromRecord(record));
    setFormOpen(true);
    setMessage("");
    setPendingPhotos([]);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const available = Math.max(0, 6 - (draft.recordId ? records.find((record) => record.recordId === draft.recordId)?.photos.length || 0 : 0) - pendingPhotos.length);
    const accepted = Array.from(files).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 5 * 1024 * 1024).slice(0, available);
    setPendingPhotos((current) => [...current, ...accepted]);
    if (accepted.length !== files.length) setMessage("Use up to six JPEG, PNG, or WebP photos smaller than 5 MB.");
  }

  async function uploadPhotos(recordId: string): Promise<number> {
    let uploaded = 0;
    for (const file of pendingPhotos) {
      const form = new FormData();
      form.set("recordId", recordId);
      form.set("photo", file);
      const response = await fetch("/api/fleet-maintenance-photos", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || `Unable to upload ${file.name}.`));
      uploaded += 1;
    }
    return uploaded;
  }

  async function removePhoto(photo: FleetMaintenancePhoto) {
    if (!window.confirm(`Remove ${photo.fileName}?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/fleet-maintenance-photos?photoId=${encodeURIComponent(photo.photoId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to remove this photo."));
      const refresh = await fetch("/api/fleet-maintenance", { cache: "no-store" });
      const refreshed = await refresh.json().catch(() => ({}));
      if (Array.isArray(refreshed?.store?.records)) setRecords(sortRecords(refreshed.store.records));
      setMessage("Maintenance photo removed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this photo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveRecord(event: FormEvent) {
    event.preventDefault();
    if (!draft.truck || !draft.serviceDate || !draft.serviceType) {
      setMessage("Truck, date, and service type are required.");
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/fleet-maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          odometer: draft.odometer === "" ? null : Number(draft.odometer),
          cost: draft.cost === "" ? null : Number(draft.cost),
          nextServiceOdometer: draft.nextServiceOdometer === "" ? null : Number(draft.nextServiceOdometer),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to save this record."));
      let nextRecords = Array.isArray(payload?.store?.records) ? payload.store.records : records;
      const uploaded = await uploadPhotos(String(payload?.record?.recordId || ""));
      if (uploaded) {
        const refresh = await fetch("/api/fleet-maintenance", { cache: "no-store" });
        const refreshed = await refresh.json().catch(() => ({}));
        if (Array.isArray(refreshed?.store?.records)) nextRecords = refreshed.store.records;
      }
      setRecords(sortRecords(nextRecords));
      setDraft(blankDraft(today, allTruckOptions, linxupInventory.vehicles));
      setFormOpen(false);
      setPendingPhotos([]);
      setMessage(`${draft.recordId ? "Maintenance record updated" : "Maintenance record added"}${uploaded ? ` · ${uploaded} photo${uploaded === 1 ? "" : "s"} added` : ""}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this record.");
    } finally {
      setSaving(false);
    }
  }

  async function removeRecord(record: FleetMaintenanceRecord) {
    if (!window.confirm(`Remove the ${record.serviceType.toLowerCase()} record for ${record.truck}?`)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/fleet-maintenance?recordId=${encodeURIComponent(record.recordId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to remove this record."));
      setRecords(sortRecords(Array.isArray(payload?.store?.records) ? payload.store.records : records.filter((row) => row.recordId !== record.recordId)));
      if (draft.recordId === record.recordId) {
        setDraft(blankDraft(today, allTruckOptions, linxupInventory.vehicles));
        setFormOpen(false);
      }
      setMessage("Maintenance record removed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this record.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="ops-maintenance-layout">
      <div className="ops-card ops-linxup-vehicle-card">
        <div className="ops-card-header compact ops-maintenance-header">
          <div>
            <div className="ops-section-title">Linxup Vehicle Details</div>
            <div className="ops-muted">VIN, license plate, and latest odometer from the {linxupInventory.sourceDate || "current"} Linxup vehicle feed.</div>
          </div>
          <div className={`ops-linxup-coverage ${platesOnFile < linxupInventory.vehicles.length ? "has-gaps" : ""}`}>
            {platesOnFile}/{linxupInventory.vehicles.length} plates on file
          </div>
        </div>
        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-linxup-vehicle-table">
            <thead><tr><th>Truck</th><th>Vehicle</th><th>VIN</th><th>License plate</th><th>Linxup odometer</th><th>GPS status</th></tr></thead>
            <tbody>
              {linxupInventory.vehicles.map((vehicle) => <tr key={vehicle.truck}>
                <td><strong>{vehicle.truck}</strong></td>
                <td>{vehicleDescription(vehicle)}</td>
                <td className="ops-linxup-vin">{vehicle.vin || <span className="ops-linxup-missing">Not set in Linxup</span>}</td>
                <td>{vehicle.licensePlate || <span className="ops-linxup-missing">Not set in Linxup</span>}</td>
                <td>{mileage(vehicle.odometer)}<small>{odometerSourceLabel(vehicle)}</small></td>
                <td>{vehicle.status || "—"}</td>
              </tr>)}
              {linxupInventory.vehicles.length === 0 && <tr><td colSpan={6} className="ops-maintenance-empty">No Linxup vehicle inventory is available.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="ops-maintenance-kpis">
        <div className={`ops-card ops-maintenance-kpi ${summary.overdue ? "is-overdue" : ""}`}><span>Overdue</span><strong>{summary.overdue}</strong><small>scheduled services</small></div>
        <div className="ops-card ops-maintenance-kpi"><span>Next 30 days</span><strong>{summary.dueSoon}</strong><small>scheduled services</small></div>
        <div className="ops-card ops-maintenance-kpi"><span>Completed</span><strong>{summary.completed}</strong><small>records on file</small></div>
        <div className="ops-card ops-maintenance-kpi"><span>Recorded cost</span><strong>{money(summary.cost)}</strong><small>completed maintenance</small></div>
      </div>

      <div className="ops-card ops-maintenance-card">
        <div className="ops-card-header compact ops-maintenance-header">
          <div>
            <div className="ops-section-title">Maintenance Records</div>
            <div className="ops-muted">Log completed work and schedule upcoming service for every truck.</div>
          </div>
          <button type="button" className="ops-refresh-button" onClick={startNew}>Add maintenance</button>
        </div>

        {formOpen && (
          <form className="ops-maintenance-form" onSubmit={saveRecord}>
            <div className="ops-maintenance-form-title">{draft.recordId ? "Edit maintenance record" : "New maintenance record"}</div>
            <div className="ops-maintenance-form-grid">
              <label><span>Truck *</span><select value={draft.truck} onChange={(event) => {
                const truck = event.target.value;
                setDraft((current) => ({ ...current, truck, odometer: odometerForTruck(linxupInventory.vehicles, truck) }));
              }} required>{allTruckOptions.map((truck) => <option key={truck}>{truck}</option>)}</select></label>
              <label><span>Status *</span><select value={draft.status} onChange={(event) => setField("status", event.target.value as MaintenanceStatus)}><option value="completed">Completed</option><option value="scheduled">Scheduled</option></select></label>
              <label><span>{draft.status === "scheduled" ? "Scheduled date *" : "Service date *"}</span><input type="date" value={draft.serviceDate} onChange={(event) => setField("serviceDate", event.target.value)} required /></label>
              <label><span>Service type *</span><select value={draft.serviceType} onChange={(event) => setField("serviceType", event.target.value)}>{SERVICE_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
              <label className="wide"><span>Work performed / issue</span><input value={draft.description} onChange={(event) => setField("description", event.target.value)} placeholder="What was repaired, replaced, or inspected?" /></label>
              <label><span>Service odometer</span><input type="number" inputMode="numeric" min="0" step="1" value={draft.odometer} onChange={(event) => setField("odometer", event.target.value)} placeholder="Miles" />{selectedVehicle?.odometer != null ? <small className="ops-maintenance-source-hint">Prefilled from Linxup · {mileage(selectedVehicle.odometer)}</small> : null}</label>
              <label><span>Cost</span><input type="number" inputMode="decimal" min="0" step="0.01" value={draft.cost} onChange={(event) => setField("cost", event.target.value)} placeholder="$0.00" /></label>
              <label><span>Vendor / shop</span><input value={draft.vendor} onChange={(event) => setField("vendor", event.target.value)} placeholder="Shop or technician" /></label>
              <label><span>Next service date</span><input type="date" value={draft.nextServiceDate} onChange={(event) => setField("nextServiceDate", event.target.value)} /></label>
              <label><span>Next service odometer</span><input type="number" inputMode="numeric" min="0" step="1" value={draft.nextServiceOdometer} onChange={(event) => setField("nextServiceOdometer", event.target.value)} placeholder="Miles" /></label>
              <label className="wide"><span>Notes</span><textarea value={draft.notes} onChange={(event) => setField("notes", event.target.value)} placeholder="Parts, invoice number, warranty details, or follow-up notes" rows={3} /></label>
            </div>
            <div className="ops-maintenance-form-actions">
              <button type="submit" className="ops-refresh-button" disabled={saving}>{saving ? "Saving…" : draft.recordId ? "Save changes" : "Add record"}</button>
              <button type="button" className="ops-button" onClick={() => { setFormOpen(false); setDraft(blankDraft(today, allTruckOptions, linxupInventory.vehicles)); setPendingPhotos([]); }} disabled={saving}>Cancel</button>
            </div>
            <div className="ops-repair-photos">
              <label className="ops-photo-add"><span>Add repair, damage, or invoice photos</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></label>
              {(records.find((record) => record.recordId === draft.recordId)?.photos || []).map((photo) => <div className="ops-photo-thumb" key={photo.photoId}><img src={`/api/fleet-maintenance-photos?photoId=${encodeURIComponent(photo.photoId)}`} alt={photo.fileName} /><button type="button" onClick={() => removePhoto(photo)} disabled={saving}>Remove</button></div>)}
              {pendingPhotos.map((file, index) => <div className="ops-photo-queued" key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><button type="button" onClick={() => setPendingPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))} disabled={saving}>Remove</button></div>)}
            </div>
          </form>
        )}

        <div className="ops-maintenance-toolbar">
          <label><span>Truck</span><select value={truckFilter} onChange={(event) => setTruckFilter(event.target.value)}><option value="all">All trucks</option>{allTruckOptions.map((truck) => <option key={truck}>{truck}</option>)}</select></label>
          <label><span>Status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All records</option><option value="completed">Completed</option><option value="scheduled">Scheduled</option></select></label>
          <div className="ops-maintenance-message" aria-live="polite">{message}</div>
        </div>

        <div className="ops-wide-table-wrap">
          <table className="ops-table ops-maintenance-table">
            <thead><tr><th>Date</th><th>Truck</th><th>Status</th><th>Service</th><th>Odometer</th><th>Cost</th><th>Vendor</th><th>Next service</th><th>Actions</th></tr></thead>
            <tbody>
              {visibleRecords.map((record) => {
                const overdue = record.status === "scheduled" && record.serviceDate < today;
                return <tr key={record.recordId}>
                  <td><strong>{dateLabel(record.serviceDate)}</strong></td>
                  <td><strong>{record.truck}</strong>{vehiclesByTruck.get(record.truck)?.licensePlate ? <small>{vehiclesByTruck.get(record.truck)?.licensePlate}</small> : null}</td>
                  <td><span className={`ops-maintenance-status ${record.status} ${overdue ? "overdue" : ""}`}>{overdue ? "Overdue" : record.status === "completed" ? "Completed" : "Scheduled"}</span></td>
                  <td><strong>{record.serviceType}</strong>{record.description ? <small>{record.description}</small> : null}{record.notes ? <small>{record.notes}</small> : null}{record.photos.length ? <small>{record.photos.length} photo{record.photos.length === 1 ? "" : "s"} attached</small> : null}</td>
                  <td>{mileage(record.odometer)}</td>
                  <td>{money(record.cost)}</td>
                  <td>{record.vendor || "—"}</td>
                  <td>{record.nextServiceDate ? dateLabel(record.nextServiceDate) : record.nextServiceOdometer != null ? mileage(record.nextServiceOdometer) : "—"}{record.nextServiceDate && record.nextServiceOdometer != null ? <small>{mileage(record.nextServiceOdometer)}</small> : null}</td>
                  <td><div className="ops-maintenance-row-actions"><button type="button" onClick={() => startEdit(record)}>Edit</button><button type="button" className="danger" onClick={() => removeRecord(record)} disabled={saving}>Remove</button></div></td>
                </tr>;
              })}
              {visibleRecords.length === 0 && <tr><td colSpan={9} className="ops-maintenance-empty">{records.length === 0 ? "No maintenance records yet. Add the first service to start the fleet history." : "No records match these filters."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
