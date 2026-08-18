"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { JobCrewNote as JobCrewNoteRecord } from "@/lib/job-crew-notes";

export default function JobCrewNote({ date, jobKey, appointmentId, initialNote }: { date: string; jobKey: string; appointmentId: string; initialNote?: JobCrewNoteRecord }) {
  const router = useRouter();
  const [note, setNote] = useState(initialNote?.body || "");
  const [savedNote, setSavedNote] = useState(initialNote?.body || "");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function save(nextNote = note) {
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/job-crew-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, jobKey, appointmentId, note: nextNote }) });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "The crew note could not be saved.");
      setSavedNote(nextNote.trim());
      setEditing(false);
      router.refresh();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "The crew note could not be saved.");
    } finally { setSaving(false); }
  }

  if (!/^\d{1,12}$/.test(appointmentId)) return null;
  return (
    <section className={`ops-job-crew-note${savedNote ? " has-note" : ""}`} aria-label="Crew note">
      <div className="ops-job-crew-note-heading">
        <div><span>CREW NOTE</span><strong>{savedNote ? "Visible in the Crew Portal" : "Add instructions the assigned crew can see"}</strong></div>
        {!editing ? <button type="button" onClick={() => setEditing(true)}>{savedNote ? "Edit" : "Add note"}</button> : null}
      </div>
      {savedNote && !editing ? <p>{savedNote}</p> : null}
      {editing ? <div className="ops-job-crew-note-editor">
        <textarea value={note} onChange={(event) => setNote(event.target.value.slice(0, 2_000))} placeholder="Access instructions, special handling, gate code, or what the crew needs to know…" rows={3} autoFocus />
        <div>
          <button type="button" className="secondary" disabled={saving} onClick={() => { setNote(savedNote); setEditing(false); setError(""); }}>Cancel</button>
          {savedNote ? <button type="button" className="secondary danger" disabled={saving} onClick={() => { setNote(""); void save(""); }}>Remove</button> : null}
          <button type="button" disabled={saving || !note.trim()} onClick={() => void save()}>{saving ? "Saving…" : "Save for crew"}</button>
        </div>
        {error ? <small role="alert">{error}</small> : null}
      </div> : null}
    </section>
  );
}
