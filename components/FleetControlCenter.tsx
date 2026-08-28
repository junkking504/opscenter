"use client";
/* eslint-disable @next/next/no-img-element -- authenticated local photo endpoints are not compatible with the Next image optimizer */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { effectiveFleetChecklistDefinitions, type FleetChecklistCustomization } from "@/lib/fleet-checklist-definitions";
import type { FleetChecklistEntry } from "@/lib/fleet-checklists";
import type { FleetIssue, FleetIssueAttachment, FleetIssuePhoto, FleetIssueSeverity, FleetIssueStatus } from "@/lib/fleet-issues";
import { buildFleetMaintenanceActions, type FleetMaintenanceAction } from "@/lib/fleet-maintenance-actions";
import type { FleetMapPayload } from "@/lib/fleet-map";

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

function workBucketLabel(priority: FleetMaintenanceAction["priority"]): string {
  return priority === "stop" || priority === "urgent" ? "Act now" : "Plan next";
}

export default function FleetControlCenter({
  truckOptions,
  initialEntries,
  initialIssues,
  customizations,
  today,
  fleetMapPayload,
  date,
}: {
  truckOptions: string[];
  initialEntries: FleetChecklistEntry[];
  initialIssues: FleetIssue[];
  customizations: FleetChecklistCustomization[];
  today: string;
  fleetMapPayload: FleetMapPayload | null;
  date: string;
}) {
  const router = useRouter();
  const [issues, setIssues] = useState(initialIssues);
  const [entries, setEntries] = useState(initialEntries);
  const [activePanel, setActivePanel] = useState<"today" | "repairs">("today");
  const [issueFilter, setIssueFilter] = useState<"active" | "all">("active");
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<IssueDraft>(() => issueDraft(undefined, truckOptions[0]));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [pendingPhotos, setPendingPhotos] = useState<File[]>([]);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);

  useEffect(() => setIssues(initialIssues), [initialIssues]);
  useEffect(() => setEntries(initialEntries), [initialEntries]);

  const readiness = useMemo(() => truckOptions.map((truck) => {
    const daily = entries.find((entry) => entry.truck === truck && entry.cadence === "daily" && entry.periodKey === today);
    const required = effectiveFleetChecklistDefinitions(truck, "daily", customizations).length;
    const checklistComplete = Boolean(daily?.completedAt && daily.answers.length === required && daily.inspector);
    const activeIssues = issues.filter((issue) => issue.truck === truck && issue.status !== "resolved");
    const outOfService = activeIssues.some((issue) => issue.severity === "out_of_service");
    return { checklistComplete, outOfService };
  }), [customizations, entries, issues, today, truckOptions]);

  const summary = {
    out: readiness.filter((truck) => truck.outOfService).length,
  };
  const visibleIssues = issues.filter((issue) => issueFilter === "all" || issue.status !== "resolved");
  const editingIssue = issues.find((issue) => issue.issueId === draft.issueId);
  const fleetActions = useMemo(() => buildFleetMaintenanceActions({
    today,
    truckOptions,
    entries,
    customizations,
    issues,
    fleetMap: fleetMapPayload,
  }), [customizations, entries, fleetMapPayload, issues, today, truckOptions]);
  const workItems = useMemo(() => {
    const priorityRank: Record<FleetMaintenanceAction["priority"], number> = { stop: 0, urgent: 1, next: 2, watch: 3 };
    const kindRank: Record<FleetMaintenanceAction["kind"], number> = { repair: 0, checklist: 1, telemetry: 2, mapping: 3 };
    const selected = new Map<string, FleetMaintenanceAction>();
    for (const action of [...fleetActions]
      .filter((candidate) => candidate.priority !== "watch")
      .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || kindRank[a.kind] - kindRank[b.kind] || a.truck.localeCompare(b.truck, undefined, { numeric: true }))) {
      if (!selected.has(action.truck)) selected.set(action.truck, action);
    }
    return [...selected.values()];
  }, [fleetActions]);
  const workSummary = {
    outOfService: summary.out,
    activeRepairs: issues.filter((issue) => issue.status !== "resolved").length,
    missingInspections: readiness.filter((truck) => !truck.checklistComplete).length,
  };

  function startIssue(issue?: FleetIssue, truck = truckOptions[0] || "") {
    setActivePanel("repairs");
    setDraft(issueDraft(issue, truck));
    setFormOpen(true);
    setMessage("");
    setPendingPhotos([]);
    setPendingAttachments([]);
  }

  function openAction(action: FleetMaintenanceAction) {
    if (action.kind === "repair") {
      const issue = issues.find((candidate) => candidate.issueId === action.issueId);
      if (issue) startIssue(issue);
      return;
    }
    if (action.kind === "checklist") {
      router.push(`/fleet?date=${encodeURIComponent(date)}&view=maintenance&section=checklists&truck=${encodeURIComponent(action.truck)}`);
      return;
    }
    router.push(`/fleet?date=${encodeURIComponent(date)}&section=map&truck=${encodeURIComponent(action.truck)}`);
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

  function addAttachments(files: FileList | null) {
    if (!files) return;
    const accepted = Array.from(files).filter((file) => [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(file.type) && file.size <= 10 * 1024 * 1024);
    setPendingAttachments((current) => [...current, ...accepted].slice(0, 6));
    if (accepted.length !== files.length) setMessage("Use PDF, Word, or Excel files smaller than 10 MB.");
  }

  async function uploadAttachments(issueId: string): Promise<number> {
    let uploaded = 0;
    for (const file of pendingAttachments) {
      const form = new FormData();
      form.set("issueId", issueId);
      form.set("attachment", file);
      const response = await fetch("/api/fleet-issue-attachments", { method: "POST", body: form });
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

  async function removeAttachment(attachment: FleetIssueAttachment) {
    if (!window.confirm(`Remove ${attachment.fileName}?`)) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/fleet-issue-attachments?attachmentId=${encodeURIComponent(attachment.attachmentId)}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(String(payload?.error || "Unable to remove this file."));
      const refresh = await fetch("/api/fleet-issues", { cache: "no-store" });
      const refreshed = await refresh.json().catch(() => ({}));
      if (Array.isArray(refreshed?.store?.issues)) setIssues(refreshed.store.issues);
      setMessage("Repair file removed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove this file.");
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
      const issueId = String(payload?.issue?.issueId || "");
      const uploadedPhotos = await uploadPhotos(issueId);
      const uploadedAttachments = await uploadAttachments(issueId);
      if (uploadedPhotos || uploadedAttachments) {
        const refresh = await fetch("/api/fleet-issues", { cache: "no-store" });
        const refreshed = await refresh.json().catch(() => ({}));
        if (Array.isArray(refreshed?.store?.issues)) nextIssues = refreshed.store.issues;
      }
      setIssues(nextIssues);
      setFormOpen(false);
      setDraft(issueDraft(undefined, truckOptions[0]));
      setPendingPhotos([]);
      setPendingAttachments([]);
      const uploads = [
        uploadedPhotos ? `${uploadedPhotos} photo${uploadedPhotos === 1 ? "" : "s"}` : "",
        uploadedAttachments ? `${uploadedAttachments} file${uploadedAttachments === 1 ? "" : "s"}` : "",
      ].filter(Boolean).join(" and ");
      setMessage(`${draft.issueId ? "Repair updated" : "Repair issue added"}${uploads ? ` · ${uploads} added` : ""}.`);
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
        <div><div className="ops-section-title">Today’s Fleet Work</div><div className="ops-muted">The next action for each truck that needs attention.</div></div>
        <button type="button" className="ops-refresh-button" onClick={() => startIssue()}>Add repair issue</button>
      </div>

      <div className="ops-fleet-work-tabs" role="tablist" aria-label="Fleet maintenance views">
        <button type="button" role="tab" aria-selected={activePanel === "today"} className={activePanel === "today" ? "active" : ""} onClick={() => setActivePanel("today")}>Today’s work</button>
        <button type="button" role="tab" aria-selected={activePanel === "repairs"} className={activePanel === "repairs" ? "active" : ""} onClick={() => setActivePanel("repairs")}>Repair queue <span>{workSummary.activeRepairs}</span></button>
      </div>

      {activePanel === "today" ? (
        <section className="ops-fleet-action-center" aria-label="Today’s fleet work">
          <div className="ops-fleet-work-summary" aria-label="Fleet work summary">
            <div className="out"><span>Out of service</span><strong>{workSummary.outOfService}</strong></div>
            <div className="attention"><span>Active repairs</span><strong>{workSummary.activeRepairs}</strong></div>
            <div className="missing"><span>Inspections incomplete</span><strong>{workSummary.missingInspections}</strong></div>
          </div>
          <div className="ops-fleet-action-list">
            {workItems.map((action) => (
              <div className={`ops-fleet-action-row priority-${action.priority}`} key={action.id}>
                <span className="ops-fleet-action-priority">{workBucketLabel(action.priority)}</span>
                <div className="ops-fleet-action-detail"><strong>{action.truck} · {action.title}</strong><small>{action.detail}</small></div>
                <button type="button" className="ops-checklist-load" onClick={() => openAction(action)}>{action.actionLabel}</button>
              </div>
            ))}
            {workItems.length === 0 ? <div className="ops-maintenance-empty">No fleet work needs attention right now.</div> : null}
          </div>
        </section>
      ) : null}

      {activePanel === "repairs" ? <>
      <div className="ops-repair-queue-header">
        <div><div className="ops-section-title">Repair Queue</div><div className="ops-muted">Checklist exceptions automatically appear here as repair work orders.</div></div>
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
          <div className="ops-repair-attachments">
            <label className="ops-photo-add"><span>Add invoice, estimate, or other file</span><input type="file" accept="application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.pdf,.doc,.docx,.xls,.xlsx" multiple onChange={(event) => { addAttachments(event.target.files); event.target.value = ""; }} /></label>
            {(editingIssue?.attachments || []).map((attachment) => <div className="ops-repair-attachment" key={attachment.attachmentId}><a href={`/api/fleet-issue-attachments?attachmentId=${encodeURIComponent(attachment.attachmentId)}`} target="_blank" rel="noreferrer">{attachment.fileName}</a><button type="button" onClick={() => removeAttachment(attachment)}>Remove</button></div>)}
            {pendingAttachments.map((file, index) => <div className="ops-photo-queued" key={`${file.name}-${file.size}-${index}`}><span>{file.name}</span><button type="button" onClick={() => setPendingAttachments((current) => current.filter((_, attachmentIndex) => attachmentIndex !== index))}>Remove</button></div>)}
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
      </> : null}
    </section>
  );
}
