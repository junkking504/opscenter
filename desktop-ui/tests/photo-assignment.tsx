import React from 'react';
import { createRoot } from 'react-dom/client';
import LivePhotoReview from '../live-photo-review';
import '../app/globals.css';
import type { PhotoAppointmentOptions, PhotoAssignmentInput, PhotoAssignmentStatus, PhotoReviewRecord, PhotoReviewSnapshot } from '../lib/photo-review-contract';

// Local demonstration only. Every read/write is synthetic and stays in memory.
const id = 'a'.repeat(64);
const params = new URLSearchParams(location.search);
const uncertain = params.has('uncertain'), lostResponse = params.has('lost');
let saved: PhotoAssignmentInput | null = null, verified = false, posts = 0;
const appointmentOptions: PhotoAppointmentOptions = { date: '2026-09-28', sourceAt: '2026-09-28T15:00:00Z', appointments: [
  { appointmentId: '100001', jk: 'JK1000001', date: '2026-09-28', truck: 'Truck# 3', customer: 'Sample Customer A', address: '100 Example Street, Baton Rouge', time: '8:00–9:00 AM', status: 'Confirmed' },
  { appointmentId: '100002', jk: 'JK1000002', date: '2026-09-28', truck: 'Truck# 4', customer: 'Sample Customer B', address: '200 Example Avenue, New Orleans', time: '10:00–11:00 AM', status: 'Completed' },
] };
const record: PhotoReviewRecord = { id, revision: 'b'.repeat(64), state: 'review', receivedAt: '2026-09-28T14:13:00Z', outcomeAt: '2026-09-28T14:13:00Z', jobDate: '2026-09-28', sender: 'Sender ending 1388', senderKey: 'example', jk: '', category: 'after', caption: '', reason: uncertain ? 'upload_outcome_uncertain' : 'sender_not_mapped_to_truck', reasonLabel: uncertain ? 'Upload outcome uncertain' : 'Sender mapping needed', nextStep: uncertain ? 'Check the existing photos in JunkWare before a retry.' : 'Choose the exact appointment below to assign this photo.', attempts: 0, previewAvailable: true, sourceHref: null, assignmentBlocked: uncertain ? 'The previous upload may have succeeded. Check the existing photos in JunkWare before any retry.' : null };
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.pathname !== '/api/desktop/photos') throw new Error('Unexpected preview request.');
  if (init?.method === 'POST') {
    const next = JSON.parse(String(init.body)) as PhotoAssignmentInput; posts++;
    if (saved && saved.requestId !== next.requestId) throw new Error('Duplicate request identity');
    saved = next;
    document.getElementById('post-count')!.textContent = String(posts);
    if (lostResponse && posts === 1) throw new Error('Simulated lost response. Check upload status.');
  }
  if (url.searchParams.has('appointments')) return Response.json({ ...appointmentOptions, appointments: url.searchParams.get('appointments') === appointmentOptions.date ? appointmentOptions.appointments : [] });
  if (url.searchParams.has('record') || init?.method === 'POST') {
    const status: PhotoAssignmentStatus = { state: saved ? verified ? 'completed' : 'assigned' : 'review', verified, requestId: saved?.requestId || null, appointment: saved ? appointmentOptions.appointments.find(row => row.appointmentId === saved?.appointmentId)! : null, category: saved?.category || null, updatedAt: new Date().toISOString(), message: saved ? verified ? 'Photo uploaded and verified in JunkWare.' : 'Assignment saved. Waiting for the photo worker; upload is not yet verified.' : 'The photo still needs review.' };
    return Response.json(status);
  }
  const snapshot: PhotoReviewSnapshot = { observedAt: new Date().toISOString(), complete: true, unreadable: 0, unavailableStates: [], counts: { review: saved ? 0 : 1, failed: 0, processing: 0, incoming: 0, assigned: saved && !verified ? 1 : 0 }, total: verified ? 0 : 1, filtered: verified ? 0 : 1, page: 1, pages: 1, records: verified ? [] : [{ ...record, state: saved ? 'assigned' : 'review' }], reasons: [{ reason: record.reason, label: record.reasonLabel, count: 1 }], senders: [{ key: 'example', label: record.sender, count: 1 }] };
  return Response.json(snapshot);
};
function Preview() {
  return <main style={{ maxWidth: 1180, margin: '24px auto', padding: 16 }}><h1 style={{ fontWeight: 700, fontSize: 22 }}>Photo review · local preview</h1><p style={{ margin: '8px 0 20px' }}>Synthetic example. No real photo, appointment, or upload is changed.</p><LivePhotoReview /><div style={{ display: 'flex', gap: 12, alignItems: 'center' }}><button onClick={() => { verified = Boolean(saved); }}>Simulate verified upload</button><span>Assignments submitted: <span id="post-count">0</span></span></div></main>;
}
createRoot(document.getElementById('root')!).render(<Preview />);
