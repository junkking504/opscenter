import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { chicagoDateKey } from './chicago-date';
import type { CrewPhone } from './crew-phone';
import { readCrewPhoneDirectory } from './crew-phone-directory';

type Contact = { kind: 'manager' | 'company'; name: string; number: string };
type Approval = { schema: 1; purpose: 'waypoint-manager'; approvedBy: string; approvedAt: string; contacts: Contact[] };
const read = (file: string) => JSON.parse(fs.readFileSync(file, 'utf8'));
const actorFor = (number: string) => `crew-self-setup:${createHash('sha256').update(number.replace(/-/g, '')).digest('hex')}`;

/** Exact, approved Waypoint-only manager identity. Call after phone authentication; never use this
 * policy to grant OpsCenter sessions or unrelated system access.
 * The private approval file is installed separately after exact-target approval.
 * Labels, selected crew names, default trucks and manager sessions grant nothing.
 */
export function crewIsWaypointManager(phone: CrewPhone, now = new Date()): boolean {
  if (phone.test || !/^[a-f0-9-]{36}$/.test(phone.deviceId)) return false;
  const root = process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'crew-phones');
  try {
    const approval: Approval = read(path.join(root, 'manager-access.json'));
    if (approval.schema !== 1 || approval.purpose !== 'waypoint-manager'
      || typeof approval.approvedBy !== 'string' || !approval.approvedBy.trim()
      || !Number.isFinite(Date.parse(approval.approvedAt)) || Date.parse(approval.approvedAt) > now.getTime()
      || !Array.isArray(approval.contacts) || !approval.contacts.length || approval.contacts.length > 50
      || approval.contacts.some(contact => !contact || !['manager', 'company'].includes(contact.kind)
        || typeof contact.name !== 'string' || !contact.name.trim()
        || !/^[2-9]\d{2}-[2-9]\d{2}-\d{4}$/.test(contact.number))
      || new Set(approval.contacts.map(contact => contact.number)).size !== approval.contacts.length) return false;
    const binding = read(path.join(root, 'bindings', `${phone.deviceId}.json`));
    const saved = binding.phone as CrewPhone;
    if (binding.schema !== 1 || saved?.deviceId !== phone.deviceId
      || saved.enrolledAt !== phone.enrolledAt || saved.expiresAt !== phone.expiresAt
      || !Number.isFinite(Date.parse(saved.enrolledAt)) || Date.parse(saved.enrolledAt) > now.getTime()
      || !Number.isFinite(Date.parse(saved.expiresAt)) || Date.parse(saved.expiresAt) <= now.getTime()
      || chicagoDateKey(new Date(saved.enrolledAt)) !== chicagoDateKey(now)
      || fs.existsSync(path.join(root, 'revoked', `${phone.deviceId}.json`))) return false;
    const directory = readCrewPhoneDirectory();
    const contacts: Contact[] = [
      ...directory.managers.map(row => ({kind: 'manager' as const, name: row.name, number: row.number})),
      ...directory.company.map(row => ({kind: 'company' as const, name: row.label, number: row.number})),
    ];
    return approval.contacts.some(approved => contacts.filter(row => row.number === approved.number).length === 1
      && contacts.filter(row => row.kind === approved.kind && row.name === approved.name).length === 1
      && contacts.some(row => row.kind === approved.kind && row.name === approved.name && row.number === approved.number)
      && binding.actor === actorFor(approved.number));
  } catch { return false; } // Missing, corrupt or ambiguous policy never expands visibility.
}

export const crewCanBrowseAllTrucks=crewIsWaypointManager;
