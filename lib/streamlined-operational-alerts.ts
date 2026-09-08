import type { OperationalAlert } from './operational-alert-presentation';
import type { readJobRows } from './desktop-schedule-source';

type Job = ReturnType<typeof readJobRows>[number];
const reference = (alert: OperationalAlert) => alert.title.match(/\bJK\d+\b/i)?.[0]?.toUpperCase();
const truckKey = (value?: string) => value?.match(/\d+/)?.[0]?.replace(/^0+/, '') || '';
const day = (stamp?: string) => stamp && Number.isFinite(Date.parse(stamp)) ? new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date(stamp)) : '';
const ids = (alerts: OperationalAlert[]) => [...new Set(alerts.flatMap(alert=>[alert.id,...(alert.sourceMessageIds || [])]))];
const appointmentId = (alert: OperationalAlert) => {
  try { return new URL(alert.href,'https://opscenter.invalid').searchParams.get('appointment'); } catch { return null; }
};

/** Presentation only: preserve source identities so existing reviews and owned
 * follow-ups survive consolidation. Ambiguous appointments and visits stay visible. */
export function streamlineOperationalAlerts(input: OperationalAlert[], jobs: Job[], date: string): OperationalAlert[] {
  let alerts = input.map(alert=>({...alert}));
  const closeoutId = (job: Job) => `appointment-closeout:${date}:${job.appointmentId}`;
  // A verified JunkWare closeout can precede its Slack report. Do not leave
  // visit alerts stranded while that message is waiting to be published.
  for (const job of jobs) {
    if (job.sourceDate !== date || !/complete|closed/i.test(job.status) || jobs.filter(other=>other.jkNumber === job.jkNumber).length !== 1) continue;
    const related = alerts.filter(alert=>reference(alert) === job.jkNumber.toUpperCase() && !alert.threadReply);
    if (related.some(alert=>/^(Job|Estimate) (Completed|Closed)$/.test(alert.label)) || !related.some(alert=>['Arrival','Departure','Duration'].includes(alert.label) && (!appointmentId(alert) || appointmentId(alert) === job.appointmentId))) continue;
    const timestamp = [job.completedAt,job.closeoutObservedAt].find(stamp=>stamp && Number.isFinite(Date.parse(stamp)));
    alerts.push({id:closeoutId(job),label:/estimate/i.test(job.appointmentType)?'Estimate Completed':'Job Completed',source:'JunkWare',timestamp,
      title:job.jkNumber,truck:job.truck,territory:job.territory,domain:'Dispatch',owner:'Dispatch',needsAction:false,
      detected:timestamp?new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(timestamp)):'Time unavailable',
      facts:[],next:'Closeout confirmed in JunkWare.',href:`/desktop?workspace=Schedule&date=${date}&appointment=${encodeURIComponent(job.appointmentId)}`});
  }
  const removed = new Set<string>();
  for (const complete of alerts.filter(alert=>/^(Job|Estimate) (Completed|Closed)$/.test(alert.label) && !alert.threadReply)) {
    const matches = jobs.filter(job=>job.jkNumber.toUpperCase() === reference(complete) && job.sourceDate === date);
    if (matches.length !== 1 || !/complete|closed/i.test(matches[0].status)) continue;
    const job = matches[0];
    const related = alerts.filter(alert=>alert !== complete && (!alert.threadReply || alert.label === 'Photos Uploaded') && day(alert.timestamp) === date && reference(alert) === reference(complete)
      && (!appointmentId(alert) || appointmentId(alert) === job.appointmentId)
      && (['Payment Recorded','Photos Uploaded'].includes(alert.label) && !truckKey(alert.truck) || truckKey(alert.truck) && truckKey(alert.truck) === truckKey(job.truck) || ['Arrival','Departure','Duration'].includes(alert.label) && appointmentId(alert) === job.appointmentId));
    const otherCompletions = related.filter(alert=>/^(Job|Estimate) (Completed|Closed)$/.test(alert.label));
    if (otherCompletions.length) continue;
    const visits = related.filter(alert=>['Arrival','Departure','Duration'].includes(alert.label));
    // Once JunkWare confirms closeout, visit reports belong to that completion.
    // Keep every source alias so review and Control ownership survive the fold.
    const duration = visits.length === 1 ? visits : [];
    const photos = related.filter(alert=>alert.label === 'Photos Uploaded' && !alert.needsAction && job.photos.length > 0);
    const payment = related.filter(alert=>alert.label === 'Payment Recorded');
    const merged = [...visits,...photos,...payment];
    complete.sourceMessageIds = [...new Set([...ids([complete,...merged]),closeoutId(job)])];
    complete.photos = job.photos.length ? job.photos : complete.photos;
    complete.facts = [...complete.facts,...duration.flatMap(alert=>alert.facts.filter(fact=>['Duration','Arrival','Departure'].includes(fact.label)
      && !complete.facts.some(existing=>existing.label === fact.label))),...payment.flatMap(alert=>alert.facts.filter(fact=>/^payments?$/i.test(fact.label)
      && !complete.facts.some(existing=>/^payments?$/i.test(existing.label))))];
    for (const alert of merged) removed.add(alert.id);
  }
  alerts = alerts.filter(alert=>!removed.has(alert.id));
  const summarize = (members: OperationalAlert[], label: string, facts: OperationalAlert['facts']) => {
    if (!members.length) return;
    const canonical = members.find(alert=>alert.label === label) || [...members].sort((a,b)=>(a.timestamp || '').localeCompare(b.timestamp || ''))[0];
    const aliases = ids(members);
    alerts = alerts.filter(alert=>!members.includes(alert));
    alerts.push({...canonical,label,title:label,facts,needsAction:false,next:'Recorded · No action required.',sourceMessageIds:aliases,truck:undefined});
  };
  const crew = alerts.filter(alert=>!alert.threadReply && ['Clock In','Krewe Summary'].includes(alert.label) && day(alert.timestamp) === date);
  // The live summary is authoritative for corrected clock-in values; historical
  // individual clock-ins remain aliases, so prior reviews keep their identity.
  const summary = crew.find(alert=>alert.label === 'Krewe Summary');
  summarize(crew,'Krewe Summary',summary?.facts || crew.map(alert=>({label:alert.title,value:alert.facts.find(fact=>/^clock in$/i.test(fact.label))?.value || alert.detected})));
  const carryover = alerts.filter(alert=> {
    if (alert.label === 'Schedule Summary') return day(alert.timestamp) === date;
    if (alert.label !== 'New Appointment' || alert.threadReply || day(alert.timestamp) !== date) return false;
    const clock = new Intl.DateTimeFormat('en-GB',{timeZone:'America/Chicago',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(alert.timestamp!));
    const matches = jobs.filter(job=>job.jkNumber.toUpperCase() === reference(alert) && job.sourceDate === date);
    return clock === '00:00' && matches.length === 1 && Boolean(day(matches[0].bookedAt)) && day(matches[0].bookedAt) < date;
  });
  const scheduleSummary = carryover.find(alert=>alert.label === 'Schedule Summary');
  summarize(carryover,'Schedule Summary',scheduleSummary?.facts || [{label:'Operating day',value:date},{label:'Existing appointments',value:String(carryover.length)},{label:'Schedule',value:'Opening schedule · booked before today',href:`/schedule?date=${date}`}]);
  return alerts.sort((a,b)=>(b.timestamp || '').localeCompare(a.timestamp || ''));
}

export { requiresAlertAttention } from '../desktop-ui/lib/alert-attention';
