"use client";
/* eslint-disable @next/next/no-img-element -- authenticated local photo endpoints are not compatible with the Next image optimizer */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  FLEET_CHECKLIST_CADENCES,
  FLEET_CHECKLIST_DEFINITIONS,
  effectiveFleetChecklistDefinitions,
  fleetChecklistCadenceLabel,
  fleetChecklistPeriodKey,
  type FleetChecklistCadence,
  type FleetChecklistCustomization,
  type FleetChecklistDefinition,
  type FleetChecklistItemStatus,
} from "@/lib/fleet-checklist-definitions";
import type { FleetChecklistEntry, FleetChecklistPhoto } from "@/lib/fleet-checklists";
import type { LinxupVehicleInventory } from "@/lib/linxup-vehicle-inventory";

type DraftAnswer = {
  status: FleetChecklistItemStatus | "";
  notes: string;
};

type DraftAnswers = Record<string, DraftAnswer>;

function mileage(value: number | null): string {
  return value == null ? "—" : `${Math.round(value).toLocaleString("en-US")} mi`;
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day));
}

function draftFor(entry: FleetChecklistEntry | undefined, definitions: FleetChecklistDefinition[]): DraftAnswers {
  const saved = new Map((entry?.answers || []).map((answer) => [answer.itemId, answer]));
  return Object.fromEntries(definitions.map((item) => {
    const answer = saved.get(item.itemId);
    return [item.itemId, { status: answer?.status || "", notes: answer?.notes || "" }];
  }));
}

function entryProgress(entry: FleetChecklistEntry | undefined, definitions: FleetChecklistDefinition[]) {
  const total = definitions.length;
  const answered = entry?.answers.length || 0;
  const attention = entry?.answers.filter((answer) => answer.status === "attention").length || 0;
  return { total, answered, attention, complete: Boolean(entry?.completedAt) && answered === total };
}

export default function FleetMaintenanceChecklists({
  initialEntries,
  truckOptions,
  today,
  linxupInventory,
  initialCustomizations,
  initialSelectedTruck = "",
}: {
  initialEntries: FleetChecklistEntry[];
  truckOptions: string[];
  today: string;
  linxupInventory: LinxupVehicleInventory;
  initialCustomizations: FleetChecklistCustomization[];
  initialSelectedTruck?: string;
}) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialEntries);
  const [customizations, setCustomizations] = useState(initialCustomizations);
  const [cadence, setCadence] = useState<FleetChecklistCadence>("daily");
  const [inspectionDate, setInspectionDate] = useState(today);
  const [selectedTruck, setSelectedTruck] = useState(() =>
    initialSelectedTruck && truckOptions.includes(initialSelectedTruck) ? initialSelectedTruck : truckOptions[0] || "",
  );
  const [answers, setAnswers] = useState<DraftAnswers>(() => draftFor(undefined, FLEET_CHECKLIST_DEFINITIONS.daily));
  const [inspector, setInspector] = useState("");
  const [odometer, setOdometer] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [driverMode, setDriverMode] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<Record<string, File[]>>({});
  const [templateOpen, setTemplateOpen] = useState(false);
  const [templateHidden, setTemplateHidden] = useState<string[]>([]);
  const [templateCustom, setTemplateCustom] = useState<FleetChecklistDefinition[]>([]);
  const [customItemDraft, setCustomItemDraft] = useState({ category: "Truck specific", label: "", guidance: "" });
  const [templateSaving, setTemplateSaving] = useState(false);

  const periodKey = fleetChecklistPeriodKey(inspectionDate, cadence);
  const definitions = useMemo(() => effectiveFleetChecklistDefinitions(selectedTruck, cadence, customizations), [cadence, customizations, selectedTruck]);
  const vehicleByTruck = useMemo(() => new Map(linxupInventory.vehicles.map((vehicle) => [vehicle.truck, vehicle])), [linxupInventory.vehicles]);
  const currentEntry = entries.find((entry) => entry.truck === selectedTruck && entry.cadence === cadence && entry.periodKey === periodKey);

  useEffect(() => setEntries(initialEntries), [initialEntries]);
  useEffect(() => setCustomizations(initialCustomizations), [initialCustomizations]);
  useEffect(() => {
    if (initialSelectedTruck && truckOptions.includes(initialSelectedTruck)) setSelectedTruck(initialSelectedTruck);
  }, [initialSelectedTruck, truckOptions]);

  useEffect(() => {
    const entry = entries.find((row) => row.truck === selectedTruck && row.cadence === cadence && row.periodKey === periodKey);
    setAnswers(draftFor(entry, definitions));
    setInspector(entry?.inspector || "");
    const vehicleOdometer = vehicleByTruck.get(selectedTruck)?.odometer;
    setOdometer(entry?.odometer != null ? String(Math.round(entry.odometer)) : vehicleOdometer == null ? "" : String(Math.round(vehicleOdometer)));
    setPendingPhotos({});
  }, [cadence, definitions, entries, periodKey, selectedTruck, vehicleByTruck]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedTruck = params.get("truck") || "";
    const matchedTruck = truckOptions.find((truck) => truck.match(/\d+/)?.[0] === requestedTruck.match(/\d+/)?.[0]);
    if (matchedTruck) setSelectedTruck(matchedTruck);
    if (params.get("mode") === "driver") setDriverMode(true);
  }, [truckOptions]);

  useEffect(() => {
    document.body.classList.toggle("ops-fleet-driver-mode", driverMode);
    return () => document.body.classList.remove("ops-fleet-driver-mode");
  }, [driverMode]);

  const answeredCount = definitions.filter((item) => Boolean(answers[item.itemId]?.status)).length;
  const attentionCount = definitions.filter((item) => answers[item.itemId]?.status === "attention").length;
  const currentPeriodEntries = truckOptions.map((truck) => entries.find((entry) =>
    entry.truck === truck && entry.cadence === cadence && entry.periodKey === periodKey
  ));
  const completedTruckCount = currentPeriodEntries.filter((entry, index) => entryProgress(entry, effectiveFleetChecklistDefinitions(truckOptions[index], cadence, customizations)).complete).length;

  function updateAnswer(itemId: string, update: Partial<DraftAnswer>) {
    setAnswers((current) => ({
      ...current,
      [itemId]: { status: current[itemId]?.status || "", notes: current[itemId]?.notes || "", ...update },
    }));
  }

  function markAllPass() {
    setAnswers((current) => Object.fromEntries(definitions.map((item) => [item.itemId, {
      status: current[item.itemId]?.status || "pass",
      notes: current[item.itemId]?.notes || "",
    }])));
    setMessage("");
  }

  function addPendingPhotos(itemId: string, files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 5 * 1024 * 1024);
    const currentCount = Object.values(pendingPhotos).reduce((sum, rows) => sum + rows.length, 0);
    const available = Math.max(0, 6 - currentCount);
    setPendingPhotos((current) => ({ ...current, [itemId]: [...(current[itemId] || []), ...accepted.slice(0, available)] }));
    if (accepted.length !== files.length) setMessage("Use JPEG, PNG, or WebP photos smaller than 5 MB.");
    else if (accepted.length > available) setMessage("Up to 6 new photos can be added per save.");
    else setMessage("");
  }

  async function uploadPendingPhotos(entryId: string): Promise<number> {
    let uploaded = 0;
    for (const [itemId, files] of Object.entries(pendingPhotos)) {
      for (const file of files) {
        const form = new FormData();
        form.set("entryId", entryId);
        form.set("itemId", itemId);
        form.set("photo", file);
        const response = await fetch("/api/fleet-checklist-photos", { method: "POST", body: form });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(String(payload?.error || `Unable to upload ${file.name}.`));
        uploaded += 1;
      }
    }
    return uploaded;
  }

  async function removePhoto(photo: FleetChecklistPhoto) {
    if (!window.confirm(`Remove ${photo.fileName}?`)) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch(`/api/fleet-checklist-photos?photoId=${encodeURIComponent(photo.photoId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to remove this photo."));
      const refresh = await fetch("/api/fleet-checklists", { cache: "no-store" });
      const refreshed = await refresh.json().catch(() => ({}));
      if (Array.isArray(refreshed?.store?.entries)) setEntries(refreshed.store.entries);
      setMessage("Photo removed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this photo.");
    } finally {
      setSaving(false);
    }
  }

  function openTemplateEditor() {
    const customization = customizations.find((row) => row.truck === selectedTruck && row.cadence === cadence);
    setTemplateHidden(customization?.hiddenItemIds || []);
    setTemplateCustom(customization?.customItems || []);
    setCustomItemDraft({ category: "Truck specific", label: "", guidance: "" });
    setTemplateOpen(true);
    setMessage("");
  }

  function addCustomTemplateItem() {
    if (!customItemDraft.label.trim()) {
      setMessage("Enter a name for the truck-specific checklist item.");
      return;
    }
    setTemplateCustom((current) => [...current, {
      itemId: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      category: customItemDraft.category.trim() || "Truck specific",
      label: customItemDraft.label.trim(),
      guidance: customItemDraft.guidance.trim(),
    }]);
    setCustomItemDraft({ category: "Truck specific", label: "", guidance: "" });
    setMessage("");
  }

  async function saveTemplate() {
    setTemplateSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/fleet-checklist-templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ truck: selectedTruck, cadence, hiddenItemIds: templateHidden, customItems: templateCustom }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to save this checklist template."));
      setCustomizations(Array.isArray(payload?.store?.customizations) ? payload.store.customizations : customizations);
      setTemplateOpen(false);
      setMessage(`${selectedTruck} ${cadence} template updated.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this checklist template.");
    } finally {
      setTemplateSaving(false);
    }
  }

  async function copyDriverLink() {
    const truckNumber = selectedTruck.match(/\d+/)?.[0] || selectedTruck;
    const url = `${window.location.origin}/fleet?view=maintenance&mode=driver&truck=${encodeURIComponent(truckNumber)}`;
    try {
      await navigator.clipboard.writeText(url);
      setMessage(`Driver link copied for ${selectedTruck}.`);
    } catch {
      setMessage(url);
    }
  }

  async function saveChecklist() {
    if (!selectedTruck) {
      setMessage("Select a truck before saving.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(inspectionDate)) {
      setMessage("Choose a checklist date before saving.");
      return;
    }
    if (!inspector.trim()) {
      setMessage("Enter the inspector's name before saving.");
      return;
    }
    const undocumentedIssue = definitions.find((item) => answers[item.itemId]?.status === "attention" && !answers[item.itemId]?.notes.trim());
    if (undocumentedIssue) {
      setMessage(`Describe the problem for “${undocumentedIssue.label}” before saving.`);
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const payloadAnswers = definitions.flatMap((item) => {
        const answer = answers[item.itemId];
        return answer?.status ? [{ itemId: item.itemId, status: answer.status, notes: answer.notes }] : [];
      });
      const response = await fetch("/api/fleet-checklists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          truck: selectedTruck,
          cadence,
          inspectionDate,
          inspector: inspector.trim(),
          odometer: odometer === "" ? null : Number(odometer),
          answers: payloadAnswers,
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to save this checklist."));
      let nextEntries = Array.isArray(payload?.store?.entries) ? payload.store.entries : entries;
      const uploaded = await uploadPendingPhotos(String(payload?.entry?.entryId || ""));
      if (uploaded) {
        const refresh = await fetch("/api/fleet-checklists", { cache: "no-store" });
        const refreshed = await refresh.json().catch(() => ({}));
        if (Array.isArray(refreshed?.store?.entries)) nextEntries = refreshed.store.entries;
      }
      setEntries(nextEntries);
      setPendingPhotos({});
      const complete = payloadAnswers.length === definitions.length;
      setMessage(complete ? `Checklist complete${attentionCount ? ` · ${attentionCount} item${attentionCount === 1 ? "" : "s"} sent to the repair queue` : ""}${uploaded ? ` · ${uploaded} photo${uploaded === 1 ? "" : "s"} added` : ""}.` : `Progress saved · ${payloadAnswers.length}/${definitions.length} items checked${uploaded ? ` · ${uploaded} photo${uploaded === 1 ? "" : "s"} added` : ""}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this checklist.");
    } finally {
      setSaving(false);
    }
  }

  function loadEntry(entry: FleetChecklistEntry) {
    setMessage("");
    setSelectedTruck(entry.truck);
    setCadence(entry.cadence);
    setInspectionDate(entry.inspectionDate);
    document.querySelector(".ops-checklist-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className={`ops-card ops-checklist-card ${driverMode ? "driver-mode" : ""}`}>
      <div className="ops-card-header compact ops-maintenance-header">
        <div>
          <div className="ops-section-title">Truck Maintenance Checklists</div>
          <div className="ops-muted">Complete routine safety and condition checks for each truck. Progress saves by truck and checklist period.</div>
        </div>
        <div className="ops-checklist-header-actions">
          <button type="button" className="ops-button" onClick={openTemplateEditor}>Customize {selectedTruck}</button>
          <button type="button" className={driverMode ? "ops-refresh-button" : "ops-button"} onClick={() => setDriverMode(!driverMode)}>{driverMode ? "Exit driver mode" : "Driver mode"}</button>
          <div className="ops-checklist-fleet-progress">
            <strong>{completedTruckCount}/{truckOptions.length}</strong>
            <span>trucks complete</span>
          </div>
        </div>
      </div>

      {driverMode ? <div className="ops-driver-mode-banner"><div><strong>Driver mode · {selectedTruck}</strong><span>Complete this truck’s inspection, document exceptions, and save before leaving.</span></div><button type="button" className="ops-button" onClick={copyDriverLink}>Copy assigned-truck link</button></div> : null}

      <div className="ops-checklist-period-controls">
        <div className="ops-checklist-cadence" aria-label="Checklist frequency">
          {FLEET_CHECKLIST_CADENCES.map((option) => (
            <button key={option} type="button" className={cadence === option ? "active" : ""} onClick={() => { setCadence(option); setMessage(""); }}>
              {fleetChecklistCadenceLabel(option)}
            </button>
          ))}
        </div>
        <label><span>Checklist date</span><input type="date" value={inspectionDate} onChange={(event) => { setInspectionDate(event.target.value); setMessage(""); }} required /></label>
      </div>

      {templateOpen ? (
        <div className="ops-template-editor">
          <div className="ops-card-header compact"><div><div className="ops-maintenance-form-title">Customize {selectedTruck} · {fleetChecklistCadenceLabel(cadence)}</div><div className="ops-muted">Turn standard items on or off and add equipment-specific checks for this truck.</div></div><button type="button" className="ops-button" onClick={() => setTemplateOpen(false)}>Close</button></div>
          <div className="ops-template-standard-items">
            {FLEET_CHECKLIST_DEFINITIONS[cadence].map((item) => {
              const enabled = !templateHidden.includes(item.itemId);
              return <label key={item.itemId}><input type="checkbox" checked={enabled} onChange={() => setTemplateHidden((current) => enabled ? [...current, item.itemId] : current.filter((id) => id !== item.itemId))} /><span><strong>{item.label}</strong><small>{item.category}</small></span></label>;
            })}
          </div>
          {templateCustom.length ? <div className="ops-template-custom-items">{templateCustom.map((item) => <div key={item.itemId}><span><strong>{item.label}</strong><small>{item.category}{item.guidance ? ` · ${item.guidance}` : ""}</small></span><button type="button" onClick={() => setTemplateCustom((current) => current.filter((row) => row.itemId !== item.itemId))}>Remove</button></div>)}</div> : null}
          <div className="ops-template-add-grid">
            <label><span>Category</span><input value={customItemDraft.category} onChange={(event) => setCustomItemDraft({ ...customItemDraft, category: event.target.value })} /></label>
            <label><span>Checklist item</span><input value={customItemDraft.label} onChange={(event) => setCustomItemDraft({ ...customItemDraft, label: event.target.value })} placeholder="Example: Generator fuel level" /></label>
            <label><span>Instructions</span><input value={customItemDraft.guidance} onChange={(event) => setCustomItemDraft({ ...customItemDraft, guidance: event.target.value })} placeholder="What should the driver verify?" /></label>
            <button type="button" className="ops-button" onClick={addCustomTemplateItem}>Add item</button>
          </div>
          <div className="ops-maintenance-form-actions"><button type="button" className="ops-refresh-button" onClick={saveTemplate} disabled={templateSaving}>{templateSaving ? "Saving…" : "Save truck template"}</button><button type="button" className="ops-button" onClick={() => { setTemplateHidden([]); setTemplateCustom([]); }}>Reset to standard</button></div>
        </div>
      ) : null}

      <div className="ops-checklist-truck-grid">
        {truckOptions.map((truck) => {
          const entry = entries.find((row) => row.truck === truck && row.cadence === cadence && row.periodKey === periodKey);
          const progress = entryProgress(entry, effectiveFleetChecklistDefinitions(truck, cadence, customizations));
          const vehicle = vehicleByTruck.get(truck);
          return (
            <button type="button" key={truck} className={`ops-checklist-truck ${selectedTruck === truck ? "active" : ""} ${progress.complete ? "complete" : progress.answered ? "started" : ""}`} onClick={() => { setSelectedTruck(truck); setMessage(""); }}>
              <span className="ops-checklist-truck-top"><strong>{truck}</strong><em>{progress.complete ? "Complete" : progress.answered ? "In progress" : "Not started"}</em></span>
              <span>{vehicle?.licensePlate || mileage(vehicle?.odometer ?? null)}</span>
              <span className="ops-checklist-truck-bottom"><small>{progress.answered}/{progress.total} checked</small>{progress.attention ? <b>{progress.attention} attention</b> : null}</span>
            </button>
          );
        })}
      </div>

      {selectedTruck ? (
        <div className="ops-checklist-workspace">
          <div className="ops-checklist-workspace-header">
            <div>
              <h2>{selectedTruck} · {fleetChecklistCadenceLabel(cadence)} Checklist</h2>
              <p>{dateLabel(inspectionDate)}{currentEntry?.updatedAt ? ` · Last saved ${new Date(currentEntry.updatedAt).toLocaleString("en-US")}` : " · Not yet saved"}</p>
            </div>
            <div className={`ops-checklist-count ${answeredCount === definitions.length ? "complete" : ""}`}><strong>{answeredCount}/{definitions.length}</strong><span>items checked</span></div>
          </div>

          <div className="ops-checklist-meta">
            <label><span>Inspector *</span><input value={inspector} onChange={(event) => setInspector(event.target.value)} placeholder="Name of person completing checklist" /></label>
            <label><span>Odometer</span><input type="number" inputMode="numeric" min="0" step="1" value={odometer} onChange={(event) => setOdometer(event.target.value)} placeholder="Miles" /></label>
            <div className="ops-checklist-issues"><span>Needs attention</span><strong>{attentionCount}</strong></div>
          </div>

          <div className="ops-checklist-progress-bar"><span style={{ width: `${Math.round((answeredCount / definitions.length) * 100)}%` }} /></div>

          <div className="ops-checklist-items">
            {definitions.map((item) => {
              const answer = answers[item.itemId] || { status: "", notes: "" };
              const savedPhotos = currentEntry?.photos.filter((photo) => photo.itemId === item.itemId) || [];
              const queuedPhotos = pendingPhotos[item.itemId] || [];
              return (
                <div className={`ops-checklist-item ${answer.status ? `status-${answer.status}` : ""}`} key={item.itemId}>
                  <div className="ops-checklist-item-copy"><span>{item.category}</span><strong>{item.label}</strong><small>{item.guidance}</small></div>
                  <div className="ops-checklist-status-buttons">
                    <button type="button" className={answer.status === "pass" ? "active pass" : ""} onClick={() => updateAnswer(item.itemId, { status: "pass" })}>Pass</button>
                    <button type="button" className={answer.status === "attention" ? "active attention" : ""} onClick={() => updateAnswer(item.itemId, { status: "attention" })}>Needs attention</button>
                    <button type="button" className={answer.status === "na" ? "active na" : ""} onClick={() => updateAnswer(item.itemId, { status: "na" })}>N/A</button>
                  </div>
                  <input
                    className="ops-checklist-note"
                    value={answer.notes}
                    onChange={(event) => updateAnswer(item.itemId, { notes: event.target.value })}
                    placeholder={answer.status === "attention" ? "Describe the issue or needed repair…" : "Optional note"}
                    aria-label={`${item.label} Notes`}
                  />
                  {answer.status === "attention" || savedPhotos.length || queuedPhotos.length ? <div className="ops-checklist-item-media">
                    <label className="ops-photo-add"><span>Add photos</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(event) => { addPendingPhotos(item.itemId, event.target.files); event.target.value = ""; }} /></label>
                    {savedPhotos.map((photo) => <div className="ops-photo-thumb" key={photo.photoId}><img src={`/api/fleet-checklist-photos?photoId=${encodeURIComponent(photo.photoId)}`} alt={photo.fileName} /><button type="button" onClick={() => removePhoto(photo)}>Remove</button></div>)}
                    {queuedPhotos.map((file, index) => <div className="ops-photo-queued" key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><button type="button" onClick={() => setPendingPhotos((current) => ({ ...current, [item.itemId]: (current[item.itemId] || []).filter((_, itemIndex) => itemIndex !== index) }))}>Remove</button></div>)}
                  </div> : null}
                </div>
              );
            })}
          </div>

          <div className="ops-checklist-actions">
            <button type="button" className="ops-button" onClick={markAllPass} disabled={saving}>Mark remaining items pass</button>
            <div className="ops-maintenance-message" aria-live="polite">{message}</div>
            <button type="button" className="ops-refresh-button" onClick={saveChecklist} disabled={saving}>{saving ? "Saving…" : currentEntry ? "Save changes" : "Save checklist"}</button>
          </div>
        </div>
      ) : <div className="ops-maintenance-empty">No trucks are available from Linxup.</div>}

      {entries.length > 0 ? (
        <div className="ops-checklist-history">
          <div className="ops-section-title">Recent Checklist History</div>
          <div className="ops-wide-table-wrap">
            <table className="ops-table ops-checklist-history-table">
              <thead><tr><th>Date</th><th>Truck</th><th>Frequency</th><th>Progress</th><th>Issues</th><th>Inspector</th><th>Verified</th><th></th></tr></thead>
              <tbody>{entries.slice(0, 20).map((entry) => {
                const progress = entryProgress(entry, effectiveFleetChecklistDefinitions(entry.truck, entry.cadence, customizations));
                return <tr key={entry.entryId}>
                  <td>{dateLabel(entry.inspectionDate)}</td><td><strong>{entry.truck}</strong></td><td>{fleetChecklistCadenceLabel(entry.cadence)}</td>
                  <td><span className={`ops-checklist-history-status ${progress.complete ? "complete" : "started"}`}>{progress.complete ? "Complete" : `${progress.answered}/${progress.total}`}</span></td>
                  <td>{progress.attention ? <strong className="ops-checklist-attention-text">{progress.attention} need attention</strong> : "None"}</td><td>{entry.inspector || "—"}</td><td>{entry.completedAt ? new Date(entry.completedAt).toLocaleString("en-US") : "Incomplete"}<small>{entry.submittedByEmail || ""}</small></td>
                  <td><button type="button" className="ops-checklist-load" onClick={() => loadEntry(entry)}>Open</button></td>
                </tr>;
              })}</tbody>
            </table>
          </div>
        </div>
      ) : null}
    </section>
  );
}
