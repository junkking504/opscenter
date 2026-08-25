"use client";

import { useState } from "react";

export default function JobAppointmentNote({ appointmentId }: { appointmentId: string }) {
  const [note, setNote] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState("");

  async function save() {
    if (saving || !note.trim()) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch("/api/junkware-appointment-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ appointmentId, note }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.ok) throw new Error(payload?.error || "JunkWare could not save the appointment note.");
      setSavedAt("Added and verified in JunkWare.");
      setNote("");
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "JunkWare could not save the appointment note.");
    } finally {
      setSaving(false);
    }
  }

  if (!/^\d{1,12}$/.test(appointmentId)) return null;

  return (
    <section className="ops-job-appointment-note" aria-label="Add appointment note in JunkWare">
      <div className="ops-job-appointment-note-heading">
        <div><span>APPOINTMENT NOTE</span><strong>Saved as a note in JunkWare</strong></div>
        {!editing ? <button type="button" onClick={() => setEditing(true)}>Add note</button> : null}
      </div>
      {savedAt && !editing ? <p role="status">{savedAt}</p> : null}
      {editing ? (
        <div className="ops-job-appointment-note-editor">
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 500))}
            placeholder="Add an appointment note for dispatch, the customer, or the Krewe…"
            rows={3}
            maxLength={500}
            autoFocus
          />
          <div>
            <button type="button" className="secondary" disabled={saving} onClick={() => { setNote(""); setEditing(false); setError(""); }}>Cancel</button>
            <button type="button" disabled={saving || !note.trim()} onClick={() => void save()}>{saving ? "Saving to JunkWare…" : "Save in JunkWare"}</button>
          </div>
          {error ? <small role="alert">{error}</small> : null}
        </div>
      ) : null}
    </section>
  );
}
