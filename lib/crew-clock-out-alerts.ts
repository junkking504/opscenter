import type { OperationalAlert } from './operational-alert-presentation';
import type {DesktopCrewMember} from '../desktop-ui/lib/people-fleet-contract';

const employeeKey = (name: string) => name.trim().toLowerCase().replace(/,+/g, ' ').split(/\s+/).filter(Boolean).sort().join('-');
const payField = (label: string) => /^(total pay|hourly pay|tips|bonuses|other pay|supplemental pay)$/i.test(label);
const updatedTime = (alert: OperationalAlert) => Date.parse(alert.updatedAt || alert.timestamp || '') || 0;

function shiftKey(alert: OperationalAlert): string | null {
  if (alert.threadReply || !['Clock Out', 'Final Daily Pay'].includes(alert.label)) return null;
  const fingerprint = alert.eventFingerprint?.match(/^crew_(clock_out|daily_pay):(\d{4}-\d{2}-\d{2}):(.+)$/);
  if (fingerprint) return `${fingerprint[2]}:${fingerprint[3]}`;
  const name = alert.facts.find(fact => /^(krewe member|crew member|employee)$/i.test(fact.label))?.value || '';
  const stamp = Date.parse(alert.timestamp || '');
  if (!employeeKey(name) || !Number.isFinite(stamp)) return null;
  const date = new Intl.DateTimeFormat('en-CA', {timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
  return `${date}:${employeeKey(name)}`;
}

/** Final daily pay enriches the day's clock-out, retaining both source identities
 * for existing reviews and owned follow-ups. Missing/ambiguous shifts stay visible.
 */
export function consolidateCrewClockOutAlerts(alerts: OperationalAlert[]): OperationalAlert[] {
  const groups = new Map<string, OperationalAlert[]>();
  for (const alert of alerts) {
    const key = shiftKey(alert);
    if (key) groups.set(key, [...(groups.get(key) || []), alert]);
  }
  const replacements = new Map<string, OperationalAlert>();
  const consumed = new Set<string>();
  for (const group of groups.values()) {
    const clocks = group.filter(alert => alert.label === 'Clock Out');
    const pays = group.filter(alert => alert.label === 'Final Daily Pay').sort((a,b) => updatedTime(a) - updatedTime(b) || a.id.localeCompare(b.id));
    // Delivery retries already collapse by event fingerprint upstream. Multiple
    // remaining clock-outs can be separate shifts; never attach daily pay twice.
    if (clocks.length !== 1 || !pays.length) continue;
    const clock = clocks[0], pay = pays.at(-1)!;
    const payFacts = pay.facts.filter(fact => payField(fact.label));
    if (!payFacts.length) continue;
    const sourceMessageIds = [...new Set([clock, ...pays].flatMap(alert => [alert.id, ...(alert.sourceMessageIds || [])]))];
    const latest = updatedTime(pay) > updatedTime(clock) ? pay : clock;
    replacements.set(clock.id, {...clock, sourceMessageIds,
      facts:[...clock.facts.filter(fact => !payField(fact.label)), ...payFacts],
      corrected:clock.corrected || pays.some(alert => alert.corrected) || pays.length > 1 && pays.some(alert => JSON.stringify(alert.facts) !== JSON.stringify(pay.facts)),
      updatedAt:latest.updatedAt || latest.timestamp,
      needsAction:clock.needsAction || pay.needsAction,
      next:'Review the completed shift and final daily pay.',
    });
    for (const source of pays) consumed.add(source.id);
  }
  // Keep the clock-out's timestamp and position when final pay arrives later.
  return alerts.filter(alert => !consumed.has(alert.id)).map(alert => replacements.get(alert.id) || alert);
}

export function applyClockOutCorrections(alerts: OperationalAlert[], correctionSource?: {date:string;members:DesktopCrewMember[]}): OperationalAlert[] {
  if (!correctionSource) return alerts;
  return alerts.map(alert=>{
    if (alert.label!=='Clock Out') return alert;
    const matches=correctionSource.members.filter(member=>member.correction && shiftKey(alert)===`${correctionSource.date}:${employeeKey(member.name)}`);
    if (matches.length!==1) return alert;
    const member=matches[0];
    const money=(value:number|null)=>value===null?'Awaiting calculation':value.toLocaleString('en-US',{style:'currency',currency:'USD'});
    return {...alert,source:'OpsCenter',corrected:true,updatedAt:member.correction!.updatedAt,
      facts:[...alert.facts.filter(fact=>!payField(fact.label)&&!/^clock out$|^hours$|^pay basis$/i.test(fact.label)),
        {label:'Clock out',value:member.clockOut||'Not recorded'}, {label:'Hours',value:member.hours===null?'Unavailable':member.hours.toFixed(2)},
        {label:'Total pay',value:money(member.totalPay)}, {label:'Hourly pay',value:money(member.labor)},
        {label:'Tips',value:money(member.tips)}, {label:'Bonuses',value:money(member.bonuses)},
        ...(member.supplemental ? [{label:'Other pay',value:money(member.supplemental)}] : []),
        {label:'Pay basis',value:member.payNote||'OpsCenter correction · Not synced to JunkWare'}],
      needsAction:alert.needsAction||Boolean(member.issue),next:member.issue||member.junkwareSync?.message||'Review the corrected shift and pay.'};
  });
}
