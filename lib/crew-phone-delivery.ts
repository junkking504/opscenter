import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { CrewPhoneError, type CrewPhoneDelivery } from './crew-phone';
import { readCrewPhoneDirectory } from './crew-phone-directory';
import { createCrewPhoneEnrollment, revokeCrewPhone } from './crew-phone-store';
import { chicagoDateKey } from './chicago-date';

// Separate, explicit approval: routine deployment must never create this file.
const approvalPath = () => process.env.OPS_CREW_PHONE_DELIVERY_APPROVAL || path.join(process.env.HOME || '', 'Library/Application Support/OpsCenter/crew-phone-delivery-approval.json');
const root = () => path.join(process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'crew-phones'), 'deliveries');
type Approval = { schema: 1; enabled: true; provider: 'meta-whatsapp'; purpose: 'crew-phone-setup'; approvedBy: string; approvedAt: string; validUntil: string; monthlyBudgetMicros: number; maxAttemptsPerMonth: number; reserveMicros: number; template: string; language: string; testRecipientName?: string; testRequestId?: string };
type Saved = CrewPhoneDelivery & { schema: 1; actor: string; month: string; reservedMicros: number };
function approval(): Approval {
  let value: Approval;
  try { value = JSON.parse(fs.readFileSync(approvalPath(), 'utf8')); }
  catch { throw new CrewPhoneError('OpsBot setup-code delivery needs spending approval and an approved WhatsApp authentication template.', 503); }
  if (value.schema !== 1 || value.enabled !== true || value.provider !== 'meta-whatsapp' || value.purpose !== 'crew-phone-setup'
    || !value.approvedBy || !Number.isFinite(Date.parse(value.approvedAt)) || Date.parse(value.approvedAt) > Date.now()
    || !Number.isFinite(Date.parse(value.validUntil)) || Date.parse(value.validUntil) <= Date.now()
    || !Number.isSafeInteger(value.monthlyBudgetMicros) || value.monthlyBudgetMicros < 1 || value.monthlyBudgetMicros > 1_000_000
    || !Number.isSafeInteger(value.maxAttemptsPerMonth) || value.maxAttemptsPerMonth < 1 || value.maxAttemptsPerMonth > 100
    || !Number.isSafeInteger(value.reserveMicros) || value.reserveMicros < 10_000 || value.reserveMicros > value.monthlyBudgetMicros
    || !/^[a-z][a-z0-9_]{0,99}$/.test(value.template) || !/^[a-z]{2}(?:_[A-Z]{2})?$/.test(value.language)) {
    throw new CrewPhoneError('OpsBot setup-code delivery approval is unavailable or expired.', 503);
  }
  return value;
}
function configuration() {
  const value = approval();
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
  const version = process.env.WHATSAPP_GRAPH_API_VERSION || '';
  if (!/^\d+$/.test(phoneNumberId) || !/^v\d+\.\d+$/.test(version)) throw new CrewPhoneError('OpsBot WhatsApp connection is unavailable.', 503);
  return { ...value, phoneNumberId, version };
}
export function crewPhoneDeliveryAvailability() {
  try { const config = configuration(); return { available: true, message: 'OpsBot sends the code to this company phone on WhatsApp.', ...(config.testRecipientName && config.testRequestId ? {testRecipientName:config.testRecipientName,testRequestId:config.testRequestId}: {}) }; }
  catch (error) { return { available: false, message: error instanceof CrewPhoneError ? error.message : 'OpsBot setup-code delivery is unavailable.' }; }
}
/** Number possession is proven by the one-use code, never by this public request. */
export async function requestCrewPhoneSetup(rawNumber:unknown,rawRequestId:unknown) {
  if(typeof rawNumber!=='string' || rawNumber.length>32 || typeof rawRequestId!=='string' || !uuid.test(rawRequestId))throw new CrewPhoneError('Enter this company phone’s number.');
  const digits=rawNumber.replace(/[^0-9]/g,'').replace(/^1(?=\d{10}$)/,'');
  if(!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits))throw new CrewPhoneError('Enter a valid 10-digit company phone number.');
  const contacts=readCrewPhoneDirectory().company.filter(p=>p.number.replace(/-/g,'')===digits);
  const message='If this is a registered company phone, check WhatsApp for your 6-digit OpsBot code. The code expires in 10 minutes. If it does not arrive, contact your manager.';
  if(contacts.length!==1)return {message};
  const actor=`crew-self-setup:${createHash('sha256').update(digits).digest('hex')}`;
  const receipt=await sendCrewPhoneSetup(contacts[0].truck,rawRequestId,actor);
  if(receipt.status==='failed')throw new CrewPhoneError('OpsBot could not send the setup code. Contact your manager.',503);
  if(receipt.status==='pending' || receipt.status==='uncertain')return {message:'The send is not yet confirmed. Check WhatsApp first, then use Check send status. Do not request another code while this send is uncertain.'};
  return {message};
}
function token() {
  const configured = process.env.WHATSAPP_ACCESS_TOKEN_BASE64 ? Buffer.from(process.env.WHATSAPP_ACCESS_TOKEN_BASE64, 'base64').toString('utf8').trim() : process.env.WHATSAPP_ACCESS_TOKEN?.trim();
  if (configured) return configured;
  try { return execFileSync('security', ['find-generic-password', '-w', '-s', 'opscenter-whatsapp-access-token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 10_000 }).trim(); }
  catch { throw new CrewPhoneError('OpsBot WhatsApp connection is unavailable.', 503); }
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
function read(file: string): Saved {
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as Saved;
  if (value.schema !== 1 || !uuid.test(value.requestId) || !value.actor || !Number.isSafeInteger(value.reservedMicros) || value.reservedMicros < 10_000
    || !/^\d{4}-\d{2}$/.test(value.month) || !['pending', 'accepted', 'failed', 'uncertain'].includes(value.status)
    || !uuid.test(value.deviceId) || !Number.isFinite(Date.parse(value.createdAt))) throw new Error('Invalid setup delivery receipt.');
  return value;
}
function save(value: Saved) {
  const temp = path.join(root(), `${value.requestId}.${randomUUID()}.tmp`);
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temp, path.join(root(), `${value.requestId}.json`));
  const dir = fs.openSync(root(), 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
function project({ actor: _actor, schema: _schema, month: _month, reservedMicros: _reserved, ...value }: Saved): CrewPhoneDelivery {
  return { ...value, cancelled: fs.existsSync(path.join(root(), '..', 'revoked', `${value.deviceId}.json`)) };
}
export function listCrewPhoneDeliveries(): CrewPhoneDelivery[] {
  if (!fs.existsSync(root())) return [];
  return fs.readdirSync(root()).filter(name => name.endsWith('.json')).map(name => project(read(path.join(root(), name))))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
}

/** Local oversight only; never reads a token or contacts the provider. */
export function crewPhoneDeliveryHealth(now=Date.now()) {
  let policy:Approval|null=null;
  try {policy=approval();}catch{/* Still read the complete ledger so prior send failures remain visible. */}
  let names:string[]=[];
  try {names=fs.readdirSync(root()).filter(n=>n.endsWith('.json'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  if(names.length>10_000)throw new Error('Delivery history exceeds monitoring bound');
  const rows=names.map(name=>{const file=path.join(root(),name);if(fs.statSync(file).size>2*1024*1024)throw new Error('Oversized delivery receipt');return read(file);});
  const latest=new Map<string,Saved>();
  for(const row of rows.filter(r=>!r.test).sort((a,b)=>a.createdAt.localeCompare(b.createdAt)))latest.set(row.number,row);
  const exceptions=[...latest.values()].filter(row=>row.status==='failed' || row.status==='uncertain' || (row.status==='pending' && now-Date.parse(row.createdAt)>2*60_000)).map(row=>({requestId:row.requestId,status:row.status,createdAt:row.createdAt}));
  if(!policy)return {ready:false,reason:'Setup-code delivery approval is unavailable or expired.',exceptions};
  const monthly=rows.filter(r=>r.month===chicagoDateKey(new Date(now)).slice(0,7));
  const limited=monthly.length>=policy.maxAttemptsPerMonth || monthly.reduce((sum,row)=>sum+row.reservedMicros,0)+policy.reserveMicros>policy.monthlyBudgetMicros;
  return {ready:!limited,reason:limited?'The existing monthly setup delivery limit is reached.':'Setup delivery approval is current; receipt acceptance does not confirm arrival on the phone.',exceptions};
}

/** One durable reservation and one provider attempt per request; never replay an uncertain send. */
export async function sendCrewPhoneSetup(truck: string, requestId: string, actor: string, test = false): Promise<CrewPhoneDelivery> {
  if (!uuid.test(requestId) || !actor.trim()) throw new CrewPhoneError('A manager and valid send request are required.');
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  const file = path.join(root(), `${requestId}.json`);
  const existing = () => {
    if (!fs.existsSync(file)) return null;
    const saved = read(file);
    if (saved.actor !== actor || saved.truck !== truck || Boolean(saved.test) !== test) throw new CrewPhoneError('This send request belongs to another setup.', 409);
    return project(saved);
  };
  const prior = existing();
  if (prior) return prior;
  const config = configuration();
  if (test && (!config.testRecipientName || config.testRequestId !== requestId)) throw new CrewPhoneError('This test send has not been approved.', 403);
  const directory = readCrewPhoneDirectory();
  const contacts = test ? directory.managers.filter(phone => phone.name === config.testRecipientName).map(phone => ({label:`${phone.name} test`,number:phone.number})) : directory.company.filter(phone => phone.truck === truck);
  if (contacts.length !== 1) throw new CrewPhoneError('Choose a truck with exactly one saved company phone.');
  const contact = contacts[0];
  const accessToken = token();
  if (!accessToken) throw new CrewPhoneError('OpsBot WhatsApp connection is unavailable.', 503);
  const lock = path.join(root(), '.reserve-lock');
  try { fs.mkdirSync(lock); } catch { throw new CrewPhoneError('Another setup send is being prepared. Check recent sends before trying again.', 409); }
  let receipt: Saved, code: string;
  try {
    const raced = existing();
    if (raced) return raced;
    const month = chicagoDateKey().slice(0, 7);
    const history = fs.readdirSync(root()).filter(name => name.endsWith('.json')).map(name => read(path.join(root(), name)));
    const monthly = history.filter(row => row.month === month);
    if (monthly.length >= config.maxAttemptsPerMonth || monthly.reduce((sum, row) => sum + row.reservedMicros, 0) + config.reserveMicros > config.monthlyBudgetMicros)
      throw new CrewPhoneError('The approved monthly setup-code sending limit has been reached.', 429);
    if(actor.startsWith('crew-self-setup:')) {
      const recent=history.filter(row=>row.number===contact.number && !row.test);
      if(recent.some(row=>Date.now()-Date.parse(row.createdAt)<10*60_000))throw new CrewPhoneError('A setup code was already requested for this phone. Check WhatsApp or wait 10 minutes before requesting a new one.',429);
      if(recent.filter(row=>chicagoDateKey(new Date(row.createdAt))===chicagoDateKey()).length>=3)throw new CrewPhoneError('This phone has reached today’s setup-code limit. Contact your manager.',429);
    }
    if (history.some(row => row.truck === truck && Date.now() - Date.parse(row.createdAt) < 60_000)) throw new CrewPhoneError('Wait one minute before sending another setup code to this truck.', 429);
    const enrollment = createCrewPhoneEnrollment(truck, contact.label, actor);
    code = enrollment.code;
    receipt = { schema: 1, requestId, actor, month, reservedMicros: config.reserveMicros, truck, label: contact.label, number: contact.number, ...(test ? {test:true}: {}),
      deviceId: enrollment.deviceId, createdAt: new Date().toISOString(), expiresAt: enrollment.expiresAt, status: 'pending', message: 'Send started. Check WhatsApp before creating another code.' };
    save(receipt);
  } finally { fs.rmdirSync(lock); }
  try {
    const response = await fetch(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`, {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(20_000),
      body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', to: `1${contact.number.replace(/-/g, '')}`, type: 'template', template: {
        name: config.template, language: { code: config.language }, components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
        ],
      } }),
    });
    const body = await response.json() as { error?: { code?: number }; messages?: Array<{ id?: string }> };
    if (!response.ok || body.error) {
      receipt.status = response.status >= 500 ? 'uncertain' : 'failed';
      receipt.message = receipt.status === 'failed' ? 'WhatsApp rejected this setup message. No automatic retry was made.' : 'WhatsApp send could not be confirmed. Check the phone before sending another code.';
      if (receipt.status === 'failed') revokeCrewPhone(receipt.deviceId, actor);
    } else if (typeof body.messages?.[0]?.id === 'string' && body.messages[0].id) {
      receipt.status = 'accepted'; receipt.providerMessageId = body.messages[0].id;
      receipt.message = 'WhatsApp accepted the setup message. Phone delivery is not yet confirmed.';
    } else throw new Error('Missing provider receipt.');
  } catch {
    receipt.status = 'uncertain'; receipt.message = 'WhatsApp send could not be confirmed. Check the phone before sending another code.';
  }
  save(receipt);
  return project(receipt);
}
