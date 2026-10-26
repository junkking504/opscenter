import type { DesktopAlert } from './live-contract';
type PreviewAlert=Pick<DesktopAlert,'label'|'title'|'facts'|'timestamp'|'updatedAt'>;
export function operationalUpdatePreview(alert:PreviewAlert, customer?:string):string {
  const fact=(pattern:RegExp)=>alert.facts.find(f=>pattern.test(f.label))?.value;
  if(alert.label==='Inspection Submitted') return [fact(/^Inspector$/i),fact(/^Reported status$/i)].filter(Boolean).join(' · ') || alert.title;
  if(alert.label==='Krewe Summary') {
    const clocks=alert.facts.filter(f=>/^\d{1,2}:\d{2}(?:\s*[AP]M)?$/i.test(f.value.trim()));
    if(clocks.length)return `${clocks.length} clocked in · ${clocks.slice(0,2).map(f=>`${f.label} ${f.value}`).join(' · ')}${clocks.length>2?` · +${clocks.length-2} more`:''}`;
  }
  if(alert.label==='Schedule Summary') {
    const count=fact(/^Appointments$/i);
    if(count && /^\d+$/.test(count))return `${count} appointment${count==='1'?'':'s'} in schedule snapshot`;
  }
  if(alert.label==='Geofence') {
    const duration=fact(/^Time on site$/i);
    return [alert.title,duration && `On site: ${duration}`].filter(Boolean).join(' · ');
  }
  const detail=fact(/^(Clock in|Clock out|Payment|Total|On-site time|Status|Reason|Location|Items|Pickup items)$/i);
  const heading=customer || (alert.title!==alert.label?alert.title:'');
  if(heading || detail)return [heading,detail && detail!==heading?detail:''].filter(Boolean).join(' · ');
  const facts=alert.facts.filter(f=>!f.href && f.value!==alert.label && !/^(Operating day|Schedule)$/i.test(f.label)).slice(0,2);
  return facts.length?facts.map(f=>`${f.label}: ${f.value}`).join(' · '):'Details unavailable';
}
export function operationalUpdateHasEdit(alert:PreviewAlert):boolean {
  const original=Date.parse(alert.timestamp || ''),updated=Date.parse(alert.updatedAt || '');
  return Number.isFinite(original) && Number.isFinite(updated) && updated>original;
}
