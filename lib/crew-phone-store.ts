import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { JUNKWARE_DISPATCH_TRUCKS } from './junkware-trucks';
import { CrewPhoneError, type CrewPhone } from './crew-phone';

type Enrollment = { schema: 1; deviceId: string; truck: string; label: string; actor: string; createdAt: string; expiresAt: string };
type Binding = { schema: 1; keyHash: string; enrollmentHash: string; actor: string; phone: CrewPhone };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const root = () => process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'crew-phones');
function directory(name: string) {
  const dir = path.join(root(), name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}
function read<T>(file: string): T | null {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}
function writeOnce(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temp, 'wx', 0o600);
  try { fs.writeFileSync(fd, JSON.stringify(value)); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  try {
    fs.linkSync(temp, file);
    const parent = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(parent); } finally { fs.closeSync(parent); }
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  finally { fs.unlinkSync(temp); }
}
function validPhone(phone: CrewPhone): boolean {
  return Boolean(phone && uuid.test(phone.deviceId) && JUNKWARE_DISPATCH_TRUCKS.includes(phone.truck)
    && typeof phone.label === 'string' && phone.label.length > 0 && phone.label.length <= 80
    && Number.isFinite(Date.parse(phone.enrolledAt)) && Number.isFinite(Date.parse(phone.expiresAt))
    && Date.parse(phone.expiresAt) > Date.parse(phone.enrolledAt));
}
function validBinding(binding: Binding): boolean {
  return Boolean(binding && binding.schema === 1 && /^[a-f0-9]{64}$/.test(binding.keyHash)
    && /^[a-f0-9]{64}$/.test(binding.enrollmentHash) && typeof binding.actor === 'string' && binding.actor
    && validPhone(binding.phone));
}
function revoked(id: string) { return fs.existsSync(path.join(directory('revoked'), `${id}.json`)); }

/** Only a manager-authorized server caller may issue an enrollment. */
export function createCrewPhoneEnrollment(truck: string, label: string, actor: string, now = new Date()) {
  if (!JUNKWARE_DISPATCH_TRUCKS.includes(truck)) throw new CrewPhoneError('Choose a truck.');
  if (!label.trim() || label.length > 80) throw new CrewPhoneError('Enter a phone name, up to 80 characters.');
  if (!actor.trim()) throw new CrewPhoneError('Manager access is required.', 403);
  const code = randomBytes(18).toString('base64url');
  const enrollment: Enrollment = { schema: 1, deviceId: randomUUID(), truck, label: label.trim(), actor,
    createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + 10 * 60_000).toISOString() };
  writeOnce(path.join(directory('enrollments'), `${hash(code)}.json`), enrollment);
  return { code, deviceId: enrollment.deviceId, truck, label: enrollment.label, expiresAt: enrollment.expiresAt };
}

/** The phone generates and retains its random key before the first request.
 * Atomic binding permits only that phone to recover a lost response. */
export function enrollCrewPhone(rawCode: unknown, rawKey: unknown, now = new Date()): CrewPhone {
  if (typeof rawCode !== 'string' || !/^[A-Za-z0-9_-]{24}$/.test(rawCode.trim())
    || typeof rawKey !== 'string' || !/^[a-f0-9]{64}$/.test(rawKey)) throw new CrewPhoneError('Enter the setup code from your manager.');
  const enrollmentHash = hash(rawCode.trim());
  const enrollment = read<Enrollment>(path.join(directory('enrollments'), `${enrollmentHash}.json`));
  if (!enrollment || enrollment.schema !== 1 || !uuid.test(enrollment.deviceId)
    || !JUNKWARE_DISPATCH_TRUCKS.includes(enrollment.truck) || !Number.isFinite(Date.parse(enrollment.expiresAt))
    || !Number.isFinite(Date.parse(enrollment.createdAt)) || typeof enrollment.label !== 'string'
    || typeof enrollment.actor !== 'string' || !enrollment.actor) throw new CrewPhoneError('This setup code is invalid. Get a new code from your manager.', 403);
  if (revoked(enrollment.deviceId)) throw new CrewPhoneError('Access for this phone was removed. Contact your manager.', 403);
  const keyHash = hash(rawKey);
  const bindingFile = path.join(directory('bindings'), `${enrollment.deviceId}.json`);
  const existing = read<Binding>(bindingFile);
  if (!existing) {
    if (Date.parse(enrollment.expiresAt) <= now.getTime() || Date.parse(enrollment.createdAt) > now.getTime()) throw new CrewPhoneError('This setup code expired. Get a new code from your manager.', 403);
    // A connection key can never be repurposed for another phone or truck.
    const keyFile = path.join(directory('keys'), `${keyHash}.json`);
    writeOnce(keyFile, { deviceId: enrollment.deviceId });
    if (read<{deviceId: string}>(keyFile)?.deviceId !== enrollment.deviceId) throw new CrewPhoneError('Use a new connection for this phone.', 409);
    const phone: CrewPhone = { deviceId: enrollment.deviceId, truck: enrollment.truck, label: enrollment.label,
      enrolledAt: now.toISOString(), expiresAt: new Date(now.getTime() + 90 * 86400_000).toISOString() };
    if (!validPhone(phone)) throw new Error('Invalid enrollment record.');
    writeOnce(bindingFile, { schema: 1, keyHash, enrollmentHash, actor: enrollment.actor, phone } satisfies Binding);
  }
  const saved = read<Binding>(bindingFile);
  if (!saved || !validBinding(saved)) throw new Error('Phone enrollment needs recovery.');
  if (saved.keyHash !== keyHash || saved.enrollmentHash !== enrollmentHash) throw new CrewPhoneError('This setup code was already used by another phone.', 409);
  const phone = crewPhone(rawKey, now);
  if (!phone) throw new CrewPhoneError('Access for this phone is expired or removed. Contact your manager.', 403);
  return phone;
}

/** All job reads/writes must resolve this server-owned truck on every request. */
export function crewPhone(key: string, now = new Date()): CrewPhone | null {
  if (!/^[a-f0-9]{64}$/.test(key)) return null;
  const keyHash = hash(key);
  const index = read<{deviceId: string}>(path.join(directory('keys'), `${keyHash}.json`));
  if (!index || !uuid.test(index.deviceId)) return null;
  const saved = read<Binding>(path.join(directory('bindings'), `${index.deviceId}.json`));
  if (!saved || !validBinding(saved) || saved.keyHash !== keyHash || saved.phone.deviceId !== index.deviceId
    || Date.parse(saved.phone.enrolledAt) > now.getTime() || Date.parse(saved.phone.expiresAt) <= now.getTime()
    || revoked(index.deviceId)) return null;
  return saved.phone;
}
export function listCrewPhones(now = new Date()): Array<CrewPhone & { state: 'active' | 'expired' | 'revoked' }> {
  return fs.readdirSync(directory('bindings')).filter(name => uuid.test(name.replace(/\.json$/, '')) && name.endsWith('.json')).map(name => {
    const saved = read<Binding>(path.join(directory('bindings'), name));
    if (!saved || !validBinding(saved)) throw new Error('Phone enrollment needs recovery.');
    const state = revoked(saved.phone.deviceId) ? 'revoked' as const : Date.parse(saved.phone.expiresAt) <= now.getTime() ? 'expired' as const : 'active' as const;
    return { ...saved.phone, state };
  }).sort((a, b) => a.truck.localeCompare(b.truck) || a.label.localeCompare(b.label));
}
export function revokeCrewPhone(deviceId: string, actor: string, now = new Date()) {
  if (!uuid.test(deviceId)) throw new CrewPhoneError('Choose a company phone.');
  if (!actor.trim()) throw new CrewPhoneError('Manager access is required.', 403);
  writeOnce(path.join(directory('revoked'), `${deviceId}.json`), { actor, revokedAt: now.toISOString() });
  if (!revoked(deviceId)) throw new Error('Phone removal could not be verified.');
}
