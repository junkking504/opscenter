import type { OperationalAlert } from './operational-alert-presentation';

type Visit = {
  appointment_id?: string; jk_number?: string; job_id?: string;
  truck_number?: string | number; truck?: string; match_confidence?: string; pass_by_only?: boolean;
  first_arrival?: string; final_departure?: string;
  visit_count?: number;
  visit_intervals?: Array<{arrival?: string; departure?: string | null}>;
};
const truckKey = (value: unknown) => String(value || '').match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
const day = (stamp: string) => new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(stamp));
const clock = (stamp: string) => new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(stamp));
const minutes = (value: string) => {
  const match = value.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)(?:\s*(?:CT|CDT|CST))?$/i);
  if (!match || Number(match[1]) < 1 || Number(match[1]) > 12 || Number(match[2]) > 59) return null;
  return Number(match[1]) % 12 * 60 + Number(match[2]) + (/pm/i.test(match[3]) ? 720 : 0);
};

/** Older publishers used each revised exit timestamp as a new event identity.
 * Only a unique, confirmed, closed visit can establish that those are revisions.
 * Ambiguous matches, open visits, and distinct visit intervals stay separate.
 */
export function consolidateConfirmedVisitAlerts(alerts: OperationalAlert[], visits: Visit[], now = Date.now()): OperationalAlert[] {
  const groups = new Map<string, {alerts: OperationalAlert[]; stamp: string; start: string}>();
  const unmatched: OperationalAlert[] = [];
  for (const alert of alerts) {
    const isDeparture = alert.label === 'Departure';
    const stamp = alert.timestamp || '';
    const reference = alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
    const truck = truckKey(alert.truck || alert.title.match(/\bTruck\s*#?\s*\d+/i)?.[0]);
    const reported = minutes(alert.facts.find(fact => fact.label.toLowerCase() === alert.label.toLowerCase())?.value || '');
    if (alert.threadReply || !['Arrival','Departure'].includes(alert.label) || !reference || !truck || reported == null || !Number.isFinite(Date.parse(stamp))) {unmatched.push(alert);continue;}
    const candidates = new Map<string,{stamp:string;start:string}>();
    for (const visit of visits) {
      if (String(visit.jk_number || visit.job_id || '').toUpperCase() !== reference || truckKey(visit.truck_number || visit.truck) !== truck || visit.match_confidence !== 'confirmed' || visit.pass_by_only) continue;
      const intervals = visit.visit_intervals?.length ? visit.visit_intervals
        : visit.visit_count === 1 ? [{arrival:visit.first_arrival,departure:visit.final_departure}] : [];
      for (const interval of intervals) {
        const start = Date.parse(interval.arrival || ''), end = Date.parse(interval.departure || '');
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end > now) continue;
        const arrival = interval.arrival!, departure = interval.departure!;
        // Clock-only legacy messages cannot safely identify overnight visits.
        if (day(arrival) !== day(departure) || day(stamp) !== day(arrival)) continue;
        const first = minutes(clock(arrival))!, last = minutes(clock(departure))!;
        if (isDeparture ? reported < first || reported > last : reported !== first) continue;
        candidates.set(`${reference}:${truck}:${visit.appointment_id || ''}:${arrival}`,{stamp:departure,start:arrival});
      }
    }
    if (candidates.size !== 1) {unmatched.push(alert);continue;}
    const [key,interval] = [...candidates][0];
    const group = groups.get(key) || {alerts:[],...interval};
    group.alerts.push(alert); groups.set(key,group);
  }
  for (const group of groups.values()) {
    const ordered = [...group.alerts].sort((a,b) => (a.timestamp || '').localeCompare(b.timestamp || '') || a.id.localeCompare(b.id));
    const latest = ordered.at(-1)!;
    const facts = latest.facts.filter(fact => !['arrival','departure','duration','on-site time','visit verification'].includes(fact.label.toLowerCase()));
    const sourceMessageIds = [...new Set(ordered.flatMap(alert => [alert.id,...(alert.sourceMessageIds || [])]))];
    const revised = ordered.filter(alert=>alert.label === 'Departure').length > 1 || ordered.some(alert=>alert.corrected);
    unmatched.push({...latest,id:ordered[0].id,sourceMessageIds,label:'Duration',timestamp:group.stamp,detected:clock(group.stamp),corrected:revised,updatedAt:latest.updatedAt || latest.timestamp,
      next:'Review the recorded time on site and closeout status.',
      facts:[{label:'Duration',value:`${Math.round((Date.parse(group.stamp)-Date.parse(group.start))/6000)/10} min`},
        {label:'Arrival',value:clock(group.start)},{label:'Departure',value:clock(group.stamp)},...facts,
        ...(revised ? [{label:'Visit verification',value:`${sourceMessageIds.length} source reports combined using one confirmed visit.`}] : [])],
    });
  }
  return unmatched.sort((a,b) => (b.timestamp || '').localeCompare(a.timestamp || ''));
}
