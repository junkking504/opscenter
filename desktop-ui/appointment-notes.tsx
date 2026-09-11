import './appointment-notes.css';

/** Only extract the source's trailing attribution; leave all other text intact. */
export function appointmentNoteEntry(original: string) {
  const raw = original.trim();
  const attribution = raw.match(/\s*\((\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM))\s*,\s*([^()]+)\)\s*$/i);
  const body = attribution ? raw.slice(0, attribution.index).trimEnd() : raw;
  // Only routine system move entries belong in collapsed history. Call-center
  // narratives may contain important instructions and stay fully visible.
  return {body, date: attribution?.[1] || '', author: attribution?.[2].trim() || '', history: /^Appointment moved from\s/i.test(body)};
}

export default function AppointmentNotes({notes}: {notes: string[]}) {
  const entries = notes.filter(note => note.trim()).map(appointmentNoteEntry);
  const notesOnly = entries.filter(note => !note.history);
  const history = entries.filter(note => note.history);
  const render = (items: typeof entries) => <ol className="appointment-note-list">{items.map((note, index) => <li key={index}><article>
    <header><span>{note.date || 'Date not recorded'}</span>{note.author && <span>{note.author}</span>}</header>
    <p>{note.body}</p>
  </article></li>)}</ol>;
  return <section className="appointment-source-notes" aria-label="Appointment notes">
    <h3>Appointment notes <span>{entries.length}</span></h3>
    {notesOnly.length ? render(notesOnly) : <p className="appointment-notes-empty">{history.length ? 'Only schedule-change history is recorded.' : 'No notes recorded.'}</p>}
    {history.length > 0 && <details className="appointment-note-history"><summary>Schedule-change history ({history.length})</summary>{render(history)}</details>}
  </section>;
}
