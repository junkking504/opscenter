import type { CrewProgressJob } from './crew-progress-contract';
import type { DesktopAlert } from './live-contract';

const key = (label: string) => label.toLowerCase().replace(/[^a-z]/g, '')
  .replace(/^(location|address|serviceaddress)$/, 'address')
  .replace(/^(items|pickupitems)$/, 'items')
  .replace(/^(time|window|appointmentwindow)$/, 'window')
  .replace(/^(notes|keynotes|appointmentnotes)$/, 'notes');

// Add source-linked appointment context without replacing the recorded event.
export function crewAlertContext(alert: DesktopAlert, job?: CrewProgressJob, completed = false) {
  if (!job || alert.label === 'New Appointment' || alert.label === 'Geofence') return [];
  const existing = new Set(alert.facts.map(fact => key(fact.label)));
  const context = [
    ...(!completed ? [{label:'Appointment window',value:job.window},{label:'Recorded crew',value:job.crew}] : []),
    ...job.customerFacts.filter(fact => !completed || key(fact.label) !== 'customer'),
  ];
  return context.filter(fact => fact.value && !existing.has(key(fact.label)));
}
