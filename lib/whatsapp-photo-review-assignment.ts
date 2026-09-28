import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { withPhotoContextClaimLock } from './whatsapp-photo-trailing-context';
import type { WhatsAppImageMessage, ReviewPhotoAssignment } from './whatsapp-job-photo-queue';
import type { WhatsAppPhotoMatch } from './whatsapp-job-photo-matching';
import type { PhotoAppointmentOptions, PhotoAssignmentInput, PhotoAssignmentStatus } from '../desktop-ui/lib/photo-review-contract';

type RecordValue = Record<string, any>; // Private queue envelopes include worker-owned evidence.
const states = ['assigned', 'incoming', 'processing', 'completed', 'review', 'failed'] as const;
const digest = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
export const photoRevision = (row: RecordValue) => digest(JSON.stringify(row));
export class PhotoAssignmentError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export function readAssignmentRecord(root: string, state: string, id: string): RecordValue | null {
  if (!/^[a-f0-9]{64}$/.test(id) || !states.includes(state as typeof states[number])) throw new PhotoAssignmentError('Choose a valid photo.');
  try {
    const file = path.join(root, state, `${id}.json`), stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size > 1_000_000) throw new Error('Invalid record');
    const row = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!row || typeof row !== 'object' || Array.isArray(row) || digest(String(row.messageId || '')) !== id) throw new Error('Invalid identity');
    return row;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new PhotoAssignmentError('The photo record needs recovery before assignment.', 409);
  }
}
/** No provider download: a held photo must have a checksum-verified original. */
export function reviewedPhotoOriginal(root: string, row: RecordValue): string | null {
  const ext = row.mimeType === 'image/png' ? 'png' : row.mimeType === 'image/jpeg' ? 'jpg' : null;
  if (!ext || !row.sha256 || !row.messageId) return null;
  const file = path.join(root, 'media', `${digest(row.messageId)}.${ext}`);
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 5 * 1024 * 1024) return null;
    const bytes = fs.readFileSync(file), hash = digest(bytes);
    const signature = ext === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    return signature && [hash, Buffer.from(hash, 'hex').toString('base64')].includes(row.sha256) ? file : null;
  } catch { return null; }
}
const matchReasons = new Set(['sender_not_mapped_to_truck', 'explicit_job_ambiguous', 'ambiguous_context', 'jk_not_on_active_schedule', 'jk_not_found_in_junkware', 'truck_gps_unavailable', 'truck_gps_stale', 'job_coordinates_unavailable', 'truck_not_near_active_job', 'nearest_job_ambiguous']);
export function photoAssignmentBlocked(row: RecordValue, state: string): string | null {
  if (!['review', 'failed'].includes(state)) return 'This photo is already queued or processing. Check its upload status.';
  if (row.manualAssignment) return 'An assignment has already been recorded. Check its upload status before another action.';
  if (row.match || row.upload || row.timing?.uploadStartedAt || row.timing?.uploadQueuedAt || /uncertain|outcome_unknown/.test(String(row.review?.reason || ''))) return 'The previous upload may have succeeded. Check the existing photos in JunkWare before any retry.';
  if (row.recycling || row.resale || row.truckLoadPhoto || row.truckLoadStatus || (state === 'review' && !matchReasons.has(row.review?.reason))) return 'This record needs its original workflow reviewed before it can be assigned as an appointment photo.';
  if (row.version !== 1 || !row.senderPhone || !row.phoneNumberId || !row.mediaId || !Number.isFinite(Date.parse(row.receivedAt))) return 'The original message details are incomplete. Recover the original record first.';
  return null;
}
function statusOf(row: RecordValue, state: PhotoAssignmentStatus['state']): PhotoAssignmentStatus {
  const assignment = row.manualAssignment as ReviewPhotoAssignment | undefined;
  const verified = Boolean(assignment) && state === 'completed' && row.upload?.verified === true && Number.isSafeInteger(row.upload.beforeCount) && row.upload.beforeCount >= 0 && Number.isSafeInteger(row.upload.afterCount) && row.upload.afterCount > row.upload.beforeCount && row.match?.appointmentId === assignment?.appointment.appointmentId && row.match?.jkNumber === assignment?.appointment.jk;
  const failure = /uncertain|outcome_unknown/.test(String(row.review?.reason || '')) ? 'The upload result is uncertain. Check the selected appointment’s existing photos in JunkWare before any retry.' : row.review?.reason === 'reviewed_original_unavailable' ? 'The original photo could not be verified. Obtain a replacement for the selected appointment.' : 'The photo still needs review. Close these details and reopen the queue record for the latest reason.';
  const message = verified ? 'Photo uploaded and verified in JunkWare.' : state === 'assigned' || state === 'incoming' ? 'Assignment saved. Waiting for the photo worker; upload is not yet verified.' : state === 'processing' ? 'Upload is processing. JunkWare verification is pending.' : state === 'review' || state === 'failed' ? failure : 'Upload verification is unavailable. Check the appointment in JunkWare.';
  return { state, verified, requestId: assignment?.requestId || null, appointment: assignment?.appointment || null, category: assignment?.category || null, message, updatedAt: row.outcomeAt || assignment?.assignedAt || null };
}
export function readPhotoAssignmentStatus(root: string, id: string): PhotoAssignmentStatus {
  for (const state of states) {
    const row = readAssignmentRecord(root, state, id);
    if (row) return statusOf(row, state);
  }
  throw new PhotoAssignmentError('The photo is no longer available in the queue. Reload the queue before continuing.', 404);
}
function writeAtomic(file: string, row: RecordValue) {
  const temp = `${file}.${randomUUID()}.tmp`, fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(row)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temp, file); } finally { fs.rmSync(temp, { force: true }); }
}
function dispatch(root: string, state: string, id: string) {
  const destination = path.join(root, 'assigned'); fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  fs.renameSync(path.join(root, state, `${id}.json`), path.join(destination, `${id}.json`));
  for (const dir of [destination, path.join(root, state)]) { const fd = fs.openSync(dir, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
}
export function assignReviewedPhoto(input: PhotoAssignmentInput, actor: string, root: string, options: (date: string) => PhotoAppointmentOptions): PhotoAssignmentStatus {
  if (!input || Object.keys(input).some(key => !['id', 'state', 'revision', 'requestId', 'date', 'appointmentId', 'jk', 'category', 'confirmed'].includes(key))
    || !/^[a-f0-9]{64}$/.test(input.id) || !['review', 'failed'].includes(input.state) || !/^[a-f0-9]{64}$/.test(input.revision)
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(input.requestId)
    || !/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{1,12}$/.test(input.appointmentId) || !/^JK\d{4,12}$/.test(input.jk)
    || !['before', 'after', 'donation'].includes(input.category) || input.confirmed !== true || !actor) throw new PhotoAssignmentError('Confirm a dated appointment and photo category.');
  const fingerprint = digest(JSON.stringify([actor, input.state, input.revision, input.date, input.appointmentId, input.jk, input.category]));
  const result = withPhotoContextClaimLock(root, `${input.id}.json`, () => {
    const found = states.flatMap(state => { const row = readAssignmentRecord(root, state, input.id); return row ? [{ state, row }] : []; });
    if (found.length !== 1) throw new PhotoAssignmentError('The photo queue changed or has conflicting records. Reload it before assigning.', 409);
    const { state, row } = found[0];
    if (row.manualAssignment?.requestId === input.requestId) {
      if (row.manualAssignment.fingerprint !== fingerprint) throw new PhotoAssignmentError('This request already belongs to a different assignment.', 409);
      // Resume only a save interrupted before the atomic queue move. Worker
      // outcomes always have a review/error/outcome marker and cannot replay.
      if (['review', 'failed'].includes(state) && !row.review && !row.error && !row.outcome && !row.match && !row.upload) dispatch(root, state, input.id);
      return readPhotoAssignmentStatus(root, input.id);
    }
    if (state !== input.state || photoRevision(row) !== input.revision) throw new PhotoAssignmentError('This photo changed while you were reviewing it. Reload it before assigning.', 409);
    const blocked = photoAssignmentBlocked(row, state);
    if (blocked) throw new PhotoAssignmentError(blocked, 409);
    if (!reviewedPhotoOriginal(root, row)) throw new PhotoAssignmentError('The original photo is missing or could not be verified. Obtain a replacement before uploading.', 409);
    const candidates = options(input.date).appointments.filter(appt => appt.appointmentId === input.appointmentId && appt.jk === input.jk && appt.date === input.date && !/cancelled|canceled/i.test(appt.status));
    if (candidates.length !== 1) throw new PhotoAssignmentError('The selected appointment is unavailable, cancelled, or ambiguous. Reload the appointment list.', 409);
    const manualAssignment: ReviewPhotoAssignment = { version: 1, requestId: input.requestId, fingerprint, actor, assignedAt: new Date().toISOString(), appointment: candidates[0], category: input.category, sourceRevision: input.revision, prior: { state, review: row.review || null, error: row.error || row.lastError || null, outcomeAt: row.outcomeAt || null, attempts: row.attempts || 0 } };
    const updated: RecordValue = { ...row, manualAssignment };
    for (const key of ['review', 'error', 'lastError', 'outcome', 'outcomeAt']) delete updated[key];
    writeAtomic(path.join(root, state, `${input.id}.json`), updated);
    dispatch(root, state, input.id);
    return statusOf(updated, 'assigned');
  });
  if (!result) throw new PhotoAssignmentError('This photo is being updated. Check its status before trying again.', 409);
  return result;
}
/** Exact appointment binding bypasses automatic GPS/context matching. */
export function reviewedPhotoMatch(message: WhatsAppImageMessage): WhatsAppPhotoMatch | null {
  const assignment = message.manualAssignment;
  if (!assignment) return null;
  if (assignment.version !== 1 || !assignment.actor || !/^\d{1,12}$/.test(assignment.appointment?.appointmentId) || !/^JK\d{4,12}$/.test(assignment.appointment?.jk) || !['before', 'after', 'donation'].includes(assignment.category)) throw new Error('Invalid reviewed photo assignment.');
  return { status: 'matched', method: 'review_assignment', appointmentId: assignment.appointment.appointmentId, jkNumber: assignment.appointment.jk, truck: assignment.appointment.truck || null, distanceMiles: null, category: assignment.category };
}
