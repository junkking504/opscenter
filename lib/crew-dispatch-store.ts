import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { JUNKWARE_DISPATCH_TRUCKS } from './junkware-trucks';
import { CrewPhoneError } from './crew-phone';
import type { CrewAssignment, CrewDispatch } from './crew-dispatch';
import { nextCrewJobUnlocked, type CrewCompletionReceipt } from './crew-job-release';

type Revision = CrewDispatch & { schema: 1; requestId: string; fingerprint: string; actor: string; at: string; completionReceiptId?: string };
type Completion = CrewCompletionReceipt & { requestId: string; date: string; recordId: string; createdAt?: string; updatedAt: string };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const root = () => process.env.OPS_CREW_DISPATCH_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'crew-dispatch');
export function validCrewDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) === value;
}
function directory(truck: string) {
  if (!JUNKWARE_DISPATCH_TRUCKS.includes(truck)) throw new CrewPhoneError('Choose a truck.');
  return path.join(root(), truck.replace(' ', '-'));
}
function validAssignment(value: CrewAssignment | null) {
  return value === null || Boolean(value && uuid.test(value.assignmentId) && /^\d{1,12}$/.test(value.appointmentId)
    && validCrewDate(value.date) && Number.isFinite(Date.parse(value.releasedAt)));
}
function history(truck: string): Revision[] {
  const dir = directory(truck);
  let names: string[];
  try { names = fs.readdirSync(dir).filter(name => /^\d+\.json$/.test(name)).sort((a,b) => parseInt(a) - parseInt(b)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error; }
  return names.map((name, index) => {
    const value = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')) as Revision;
    if (value.schema !== 1 || value.truck !== truck || value.version !== index + 1 || parseInt(name) !== index + 1
      || !uuid.test(value.requestId) || !/^[a-f0-9]{64}$/.test(value.fingerprint) || !value.actor || !Number.isFinite(Date.parse(value.at))
      || !validAssignment(value.current) || !validAssignment(value.queued)
      || (!value.current && value.queued) || (value.current && value.current.appointmentId === value.queued?.appointmentId)) throw new Error('Dispatch history needs recovery.');
    return value;
  });
}
function projection(value: CrewDispatch): CrewDispatch { return {truck:value.truck,version:value.version,current:value.current,queued:value.queued}; }
export function readCrewDispatch(truck: string): CrewDispatch {
  const latest = history(truck).at(-1);
  return latest ? projection(latest) : {truck,version:0,current:null,queued:null};
}
/** Read one durable request for crash recovery without replaying a release. */
export function readCrewDispatchRequest(truck: string, requestId: string): CrewDispatch | null {
  const saved = history(truck).find(row => row.requestId === requestId);
  return saved ? projection(saved) : null;
}
function append(truck: string, requestId: string, expectedVersion: number, actor: string, input: unknown,
  change: (current: CrewDispatch) => CrewDispatch, now = new Date(), completionReceiptId?: string): CrewDispatch {
  if (!uuid.test(requestId) || !Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !actor.trim()) throw new CrewPhoneError('A valid dispatch reference and manager are required.');
  const rows = history(truck);
  const fingerprint = createHash('sha256').update(JSON.stringify({actor,input,expectedVersion})).digest('hex');
  const previous = rows.find(row => row.requestId === requestId);
  const latest = rows.at(-1);
  if (previous) {
    if (previous.fingerprint !== fingerprint) throw new CrewPhoneError('This dispatch request was already used for a different change.', 409);
    return projection(latest!);
  }
  if ((latest?.version || 0) !== expectedVersion) throw new CrewPhoneError('Dispatch changed. Refresh before assigning another job.', 409);
  const next = change(latest || {truck,version:0,current:null,queued:null});
  const value: Revision = {...next,schema:1,version:expectedVersion+1,requestId,fingerprint,actor,at:now.toISOString(),...(completionReceiptId?{completionReceiptId}:{})};
  const dir = directory(truck); fs.mkdirSync(dir, {recursive:true,mode:0o700});
  const file = path.join(dir, `${value.version}.json`), temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally {fs.closeSync(fd);}
  try {
    fs.linkSync(temp, file);
    const parent = fs.openSync(dir,'r'); try {fs.fsyncSync(parent);} finally {fs.closeSync(parent);}
  } catch(error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const saved = history(truck).find(row=>row.requestId===requestId);
    if (!saved || saved.fingerprint!==fingerprint) throw new CrewPhoneError('Dispatch changed. Refresh before assigning another job.',409);
  } finally {fs.unlinkSync(temp);}
  return readCrewDispatch(truck);
}
/** Caller must verify the selected job still belongs to this truck in the current source. */
export function releaseCrewJob(input: {truck:string;requestId:string;expectedVersion:number;appointmentId:string;date:string}, actor:string, now = new Date()) {
  if (!/^\d{1,12}$/.test(input.appointmentId) || !validCrewDate(input.date)) throw new CrewPhoneError('Choose a valid appointment.');
  return append(input.truck,input.requestId,input.expectedVersion,actor,{action:'release',appointmentId:input.appointmentId,date:input.date}, current=> {
    if (current.current?.appointmentId===input.appointmentId || current.queued?.appointmentId===input.appointmentId) throw new CrewPhoneError('This job is already assigned to this crew.',409);
    if (current.queued) throw new CrewPhoneError('Remove the queued assignment before replacing it.',409);
    const assignment: CrewAssignment = {assignmentId:randomUUID(),appointmentId:input.appointmentId,date:input.date,releasedAt:now.toISOString()};
    return {...current,...(current.current ? {queued:assignment} : {current:assignment})};
  },now);
}
export function clearQueuedCrewJob(truck:string, requestId:string, expectedVersion:number, actor:string) {
  return append(truck,requestId,expectedVersion,actor,{action:'clear-queued'},current=>({...current,queued:null}));
}
export function matchingCrewCompletion(state: CrewDispatch, receipt: Completion, now = new Date()): boolean {
  const current = state.current;
  return Boolean(current && uuid.test(receipt.requestId) && receipt.date===current.date
    && receipt.recordId===`${current.date}:appointment:${current.appointmentId}`
    && Number.isFinite(Date.parse(receipt.createdAt || '')) && Date.parse(receipt.createdAt!)>=Date.parse(current.releasedAt)
    && Date.parse(receipt.createdAt!)<=Date.parse(receipt.updatedAt)
    && Date.parse(receipt.updatedAt)<=now.getTime()
    && nextCrewJobUnlocked({currentAppointmentId:current.appointmentId,nextAppointmentId:null,nextReleased:false},receipt));
}
/** Both inputs come from server-owned receipt storage and a fresh source GET.
 * No phone endpoint accepts these as supplied completion evidence. */
export function advanceCrewDispatch(state: CrewDispatch, receipt: Completion, source: CrewCompletionReceipt['sourceResult'], now = new Date()) {
  if (!matchingCrewCompletion(state,receipt,now) || !source || (source.closeout as {truck?:string} | undefined)?.truck!==state.truck
    || !nextCrewJobUnlocked({currentAppointmentId:state.current!.appointmentId,nextAppointmentId:null,nextReleased:false},{action:'closeout',status:'verified',sourceResult:source})) throw new CrewPhoneError('The current appointment is not verified complete with photos.',409);
  return append(state.truck,receipt.requestId,state.version,'verified-closeout', {action:'advance',assignmentId:state.current!.assignmentId,receiptId:receipt.requestId}, current=>({
    ...current,current:current.queued ? {...current.queued,releasedAt:now.toISOString()} : null,queued:null,
  }),now,receipt.requestId);
}
