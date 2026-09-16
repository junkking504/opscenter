import { matchesExactJkReference } from './whatsapp-job-photo-matching';

/** Treat query-key casing as representation; reject missing or ambiguous identity. */
export function junkwarePhotoIdentityIssue(urlValue: string, title: string, appointmentId: string, jkNumber: string): string | null {
  if (!/^\d{1,12}$/.test(appointmentId)) return 'invalid expected appointment';
  const issues: string[] = [];
  if (!matchesExactJkReference(title, jkNumber)) issues.push(/\bJK\s*[-#:]*\s*\d/i.test(title) ? 'title JK differs or is ambiguous' : 'title JK missing');
  try {
    const url = new URL(urlValue);
    if (url.origin !== 'https://junkware.junk-king.com' || url.username || url.password
      || url.pathname.toLowerCase() !== '/franchise/appointment.aspx') issues.push('URL is not the JunkWare appointment page');
    const ids = [...url.searchParams].filter(([key]) => key.toLowerCase() === 'id').map(([, value]) => value);
    if (ids.length !== 1) issues.push(ids.length ? 'URL appointment ID is ambiguous' : 'URL appointment ID missing');
    else if (ids[0] !== appointmentId) issues.push('URL appointment ID differs');
  } catch { issues.push('URL is invalid'); }
  return issues.length ? issues.join('; ') : null;
}

export function junkwarePhotoPageIdentity(urlValue: string, title: string, appointmentId: string, jkNumber: string): boolean {
  return junkwarePhotoIdentityIssue(urlValue, title, appointmentId, jkNumber) === null;
}

/** Reconcile a transient POST response with exactly one read of the owning page.
 * The callback must be a GET navigation, never the upload action. */
export async function verifyJunkwarePhotoPostbackIdentity(input: {
  appointmentId: string;
  jkNumber: string;
  readIdentity: () => Promise<{ url: string; title: string }>;
  readAppointment: () => Promise<void>;
}): Promise<string | null> {
  const issue = async () => {
    const state = await input.readIdentity();
    return junkwarePhotoIdentityIssue(state.url, state.title, input.appointmentId, input.jkNumber);
  };
  const initialIssue = await issue();
  if (!initialIssue) return null;
  try { await input.readAppointment(); }
  catch { throw new Error(`JunkWare appointment read-back failed after photo upload: ${initialIssue}.`); }
  const readbackIssue = await issue();
  if (readbackIssue) throw new Error(`JunkWare appointment identity did not verify after photo upload: ${readbackIssue}; initial response: ${initialIssue}.`);
  return initialIssue;
}
