"use client";
/* eslint-disable @next/next/no-img-element -- authenticated local photo endpoints are not compatible with the Next image optimizer */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { effectiveFleetChecklistDefinitions, type FleetChecklistCustomization } from "@/lib/fleet-checklist-definitions";
import type { FleetChecklistEntry } from "@/lib/fleet-checklists";
import type { FleetIssue, FleetIssuePhoto, FleetIssueSeverity, FleetIssueStatus } from "@/lib/fleet-issues";

type IssueDraft = {
  issueId: string;
  truck: string;
  title: string;
  description: string;
  severity: FleetIssueSeverity;
  status: FleetIssueStatus;
  owner: string;
  dueDate: string;
  resolution: string;
  cost: string;
  downtimeHours: string;
};

function issueDraft(issue?: FleetIssue, truck = ""): IssueDraft {
  return {
    issueId: issue?.issueId || "",
    truck: issue?.truck || truck,
    title: issue?.title || "",
    description: issue?.description || "",
    severity: issue?.severity || "repair_soon",
    status: issue?.status || "open",
    owner: issue?.owner || "",
    dueDate: issue?.dueDate || "",
    resolution: issue?.resolution || "",
    cost: issue?.cost == null ? "" : String(issue.cost),
    downtimeHours: issue?.downtimeHours == null ? "" : String(issue.downtimeHours),
  };
}

function severityLabel(severity: FleetIssueSeverity): string {
  if (severity === "out_of_service") return "Out of service";
  if (severity === "repair_soon") return "Repair soon";
  return "Monitor";
}

function statusLabel(status: FleetIssueStatus): string {
  if (status === "in_progress") return "In progress";
  return status === "resolved" ? "Resolved" : "Open";
}

function dateLabel(value: string): string {
  if (!value) return "—";
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

export default function FleetControlCenter({
  truckOptions,
  initialEntries,
  initialIssues,
  customizations,
  today,
}: {
  truckOptions: string[];
  initialEntries: FleetChecklistEntry[];
  initialIssues: FleetIssue[];
  customizations: FleetChecklistCustomization[];
  today: string;
}) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [entries, setEntries] = useState(initialEntries);
  const [issueFilter, setIssueFilter] = useState<"active" | "all">("active");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<IssueDraft>(() => issueDraft(undefined, truckOptions[0]));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);

  useEffect(() => setIssues(initialIssues), [initialIssues]);
  useEffect(() => setEntries(initialEntries), [initialEntries]);

  const readiness = useMemo(() => truckOptions.map((truck) => {
    const daily = entries.find((entry) => entry.truck === truck && entry.cadence === "daily" && entry.periodKey === today);
    const required = effectiveFleetChecklistDefinitions(truck, "daily", customizations).length;
    const checklistComplete = Boolean(daily?.completedAt && daily.answers.length === required && daily.inspector);
    const activeIssues = issues.filter((issue) => issue.truck === truck && issue.status !== "resolved");
    const outOfService = activeIssues.some((issue) => issue.severity === "out_of_service");
    const overdue = activeIssues.some((issue) => issue.dueDate && issue.dueDate < today);
    const state = outOfService ? "out" : activeIssues.length ? "attention" : !checklistComplete ? "missing" : "ready";
    return { truck, daily, required, checklistComplete, activeIssues, overdue, state };
  }), [customizations, entries, issues, today, truckOptions]);

  const summary = {
    ready: readiness.filter((truck) => truck.state === "ready").length,
    missing: readiness.filter((truck) => truck.state === "missing").length,
    attention: readiness.filter((truck) => truck.state === "attention").length,
    out: readiness.filter((truck) => truck.state === "out").length,
  };
  const visibleIssues = issues.filter((issue) => issueFilter === "all" || issue.status !== "resolved");
  const editingIssue = issues.find((issue) => issue.issueId === draft.issueId);

  function startIssue(issue?: FleetIssue, truck = truckOptions[0] || "") {
    setDraft(issueDraft(issue, truck));
    setFormOpen(true);
    setMessage("");
    setPendingPhotos([]);
  }

  function addPhotos(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => ["image/jpeg", "image/png", "image/webp"].includes(file.type) && file.size <= 5 * 1024 * 1024);
    setPendingPhotos((current) => [...current, ...accepted].slice(0, 6));
    if (accepted.length !== files.length) setMessage("Use JPEG, PNG, or WebP photos smaller than 5 MB.");
  }

  async function uploadPhotos(issueId: string): Promise<number> {
    let uploaded = 0;
    for (const file of pendingPhotos) {
      const form = new FormData();
      form.set("issueId", issueId);
      form.set("photo", file);
      const response = await fetch("/api/fleet-issue-photos", { method: "POST", body: form });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || `Unable to upload ${file.name}.`));
      uploaded += 1;
    }
    return uploaded;
  }

  async function removePhoto(photo: FleetIssuePhoto) {
    if (!window.confirm(`Remove ${photo.fileName}?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/fleet-issue-photos?photoId=${encodeURIComponent(photo.photoId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to remove this photo."));
      const refresh = await fetch("/api/fleet-issues", { cache: "no-store" });
      const refreshed = await refresh.json().catch(() => ({}));
      if (Array.isArray(refreshed?.store?.issues)) setIssues(refreshed.store.issues);
      setMessage("Repair photo removed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this photo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveIssue() {
    if (!draft.truck || !draft.title.trim()) {
      setMessage("Truck and issue title are required.");
      return;
    }
    if (draft.status === "resolved" && !draft.resolution.trim()) {
      setMessage("Add a resolution note before closing the repair.");
      return;
    }
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/fleet-issues", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          cost: draft.cost === "" ? null : Number(draft.cost),
          downtimeHours: draft.downtimeHours === "" ? null : Number(draft.downtimeHours),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to save this repair."));
      let nextIssues = Array.isArray(payload?.store?.issues) ? payload.store.issues : issues;
      const uploaded = await uploadPhotos(String(payload?.issue?.issueId || ""));
      if (uploaded) {
        const refresh = await fetch("/api/fleet-issues", { cache: "no-store" });
        const refreshed = await refresh.json().catch(() => ({}));
        if (Array.isArray(refreshed?.store?.issues)) nextIssues = refreshed.store.issues;
      }
      setIssues(nextIssues);
      setFormOpen(false);
      setDraft(issueDraft(undefined, truckOptions[0]));
      setPendingPhotos([]);
      setMessage(`${draft.issueId ? "Repair updated" : "Repair issue added"}${uploaded ? ` · ${uploaded} photo${uploaded === 1 ? "" : "s"} added` : ""}.`);
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to save this repair.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="ops-card ops-fleet-control-card">
      <div className="ops-card-header compact ops-maintenance-header">
        <div><div className="ops-section-title">Fleet readiness</div><div className="ops-muted">Today’s required inspections and unresolved repair issues in one view.</div></div>
        <button type="button" className="ops-refresh-button" onClick={() => startIssue()}>Add repair issue</button>
      </div>

      <div className="ops-readiness-summary">
        <div className="ready"><span>Ready</span><strong>{summary.ready}</strong></div>
        <div className="missing"><span>Checklist missing</span><strong>{summary.missing}</strong></div>
        <div className="attention"><span>Attention needed</span><strong>{summary.attention}</strong></div>
        <div className="out"><span>Out of service</span><strong>{summary.out}</strong></div>
      </div>

      <div className="ops-readiness-grid">
        {readiness.map((row) => (
          <div className={`ops-readiness-truck state-${row.state}`} key={row.truck}>
            <div><strong>{row.truck}</strong><span>{row.state === "ready" ? "Ready" : row.state === "missing" ? "Checklist missing" : row.state === "out" ? "Out of service" : "Attention needed"}</span></div>
            <small>{row.checklistComplete ? `Daily check by ${row.daily?.inspector}` : `${row.daily?.answers.length || 0}/${row.required} daily items`}</small>
            <small>{row.activeIssues.length ? `${row.activeIssues.length} active repair${row.activeIssues.length === 1 ? "" : "s"}${row.overdue ? " · overdue" : ""}` : "No open repairs"}</small>
            <button type="button" onClick={() => startIssue(undefined, row.truck)}>Add issue</button>
          </div>
        ))}
      </div>

      <div className="ops-repair-queue-header">
        <div><div className="ops-section-title">Repair queue</div><div className="ops-muted">Checklist exceptions automatically appear here as repair work orders.</div></div>
        <div className="ops-checklist-cadence"><button type="button" className={issueFilter === "active" ? "active" : ""} onClick={() => setIssueFilter("active")}>Active</button><button type="button" className={issueFilter === "all" ? "active" : ""} onClick={() => setIssueFilter("all")}>All history</button></div>
      </div>

      {formOpen ? (
        <div className="ops-repair-form">
          <div className="ops-maintenance-form-title">{draft.issueId ? "Update repair work order" : "New repair work order"}</div>
          <div className="ops-repair-form-grid">
            <label><span>Truck *</span><select value={draft.truck} onChange={(event) => setDraft({ ...draft, truck: event.target.value })}>{truckOptions.map((truck) => <option key={truck}>{truck}</option>)}</select></label>
            <label className="wide"><span>Issue *</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="What needs repair?" /></label>
            <label><span>Severity</span><select value={draft.severity} onChange={(event) => setDraft({ ...draft, severity: event.target.value as FleetIssueSeverity })}><option value="monitor">Monitor</option><option value="repair_soon">Repair soon</option><option value="out_of_service">Out of service</option></select></label>
            <label><span>Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as FleetIssueStatus })}><option value="open">Open</option><option value="in_progress">In progress</option><option value="resolved">Resolved</option></select></label>
            <label><span>Owner</span><input value={draft.owner} onChange={(event) => setDraft({ ...draft, owner: event.target.value })} placeholder="Shop or responsible person" /></label>
            <label><span>Due date</span><input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} /></label>
            <label className="wide"><span>Description</span><input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Symptoms, damage, parts, or diagnostic notes" /></label>
            <label><span>Repair cost</span><input type="number" min="0" step="0.01" value={draft.cost} onChange={(event) => setDraft({ ...draft, cost: event.target.value })} placeholder="$0.00" /></label>
            <label><span>Downtime hours</span><input type="number" min="0" step="0.25" value={draft.downtimeHours} onChange={(event) => setDraft({ ...draft, downtimeHours: event.target.value })} placeholder="0" /></label>
            <label className="full"><span>Resolution {draft.status === "resolved" ? "*" : ""}</span><textarea rows={2} value={draft.resolution} onChange={(event) => setDraft({ ...draft, resolution: event.target.value })} placeholder="Work completed, parts replaced, and return-to-service notes" /></label>
          </div>
          <div className="ops-repair-photos">
            <label className="ops-photo-add"><span>Add damage or completed-repair photos</span><input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={(event) => { addPhotos(event.target.files); event.target.value = ""; }} /></label>
            {(editingIssue?.photos || []).map((photo) => <div className="ops-photo-thumb" key={photo.photoId}><img src={`/api/fleet-issue-photos?photoId=${encodeURIComponent(photo.photoId)}`} alt={photo.fileName} /><button type="button" onClick={() => removePhoto(photo)}>Remove</button></div>)}
            {pendingPhotos.map((file, index) => <div className="ops-photo-queued" key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><button type="button" onClick={() => setPendingPhotos((current) => current.filter((_, photoIndex) => photoIndex !== index))}>Remove</button></div>)}
          </div>
          <div className="ops-maintenance-form-actions"><button type="button" className="ops-refresh-button" onClick={saveIssue} disabled={saving}>{saving ? "Saving…" : "Save repair"}</button><button type="button" className="ops-button" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</button></div>
        </div>
      ) : null}

      <div className="ops-maintenance-message" aria-live="polite">{message}</div>
      <div className="ops-wide-table-wrap">
        <table className="ops-table ops-repair-table">
          <thead><tr><th>Truck</th><th>Issue</th><th>Severity</th><th>Status</th><th>Owner / due</th><th>Source</th><th></th></tr></thead>
          <tbody>
            {visibleIssues.map((issue) => <tr key={issue.issueId}>
              <td><strong>{issue.truck}</strong></td>
              <td><strong>{issue.title}</strong><small>{issue.description || "No description"}</small>{issue.resolution ? <small>Resolution: {issue.resolution}</small> : null}</td>
              <td><span className={`ops-issue-severity ${issue.severity}`}>{severityLabel(issue.severity)}</span></td>
              <td><span className={`ops-maintenance-status ${issue.status === "resolved" ? "completed" : "scheduled"}`}>{statusLabel(issue.status)}</span></td>
              <td>{issue.owner || "Unassigned"}<small>{issue.dueDate ? `${issue.dueDate < today && issue.status !== "resolved" ? "Overdue · " : "Due · "}${dateLabel(issue.dueDate)}` : "No due date"}</small></td>
              <td>{issue.sourceInspectionDate ? `Checklist · ${dateLabel(issue.sourceInspectionDate)}` : "Manual"}<small>{issue.sourceInspector || ""}</small></td>
              <td><button type="button" className="ops-checklist-load" onClick={() => startIssue(issue)}>Update</button></td>
            </tr>)}
            {visibleIssues.length === 0 ? <tr><td colSpan={7} className="ops-maintenance-empty">No {issueFilter === "active" ? "active " : ""}repair issues.</td></tr> : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}
