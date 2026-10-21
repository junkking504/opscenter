import { Activity, CalendarDays, CircleDollarSign, Megaphone, Truck, Users } from 'lucide-react';
import type { MouseEvent } from 'react';

export const workspacePages = [
  { workspace: 'Command', label: 'Command', key: 'commandView', icon: Activity, pages: [['now','Updates'],['forecast','Forecast'],['tv','The Huddle']] },
  { workspace: 'Schedule', label: 'Control', key: 'scheduleView', icon: CalendarDays, pages: [['board','Board'],['calendar','Calendar'],['estimates','Estimates'],['followup','Follow-Up'],['history','History'],['customers','Customers']] },
  { workspace: 'Krewe', label: 'Crew', key: 'kreweView', icon: Users, pages: [['today','Today'],['payperiod','Pay period'],['monthly','Monthly']] },
  { workspace: 'Fleet', label: 'Convoy', key: 'fleetView', icon: Truck, pages: [['overview','Overview'],['maintenance','Repairs'],['service','Maintenance']] },
  { workspace: 'Finance', label: 'Capital', key: 'financeView', icon: CircleDollarSign, pages: [['overview','Overview'],['payments','Payments'],['expenses','Expenses'],['accounting','Accounting'],['resale','Resale'],['recycling','Recycling']] },
  { workspace: 'Marketing', label: 'Campaign', key: 'marketingView', icon: Megaphone, pages: [['overview','Follow up'],['reviews','Reviews'],['performance','Results']] },
] as const;
export function pageHref(workspace: string, key: string, page: string, href = window.location.href) {
  const url = new URL(href);
  for (const stale of ['appointment','customer','q','truck','member','inspectionReports','knowledge','report','tv']) url.searchParams.delete(stale);
  url.searchParams.set('workspace',workspace); url.searchParams.set(key,page); url.searchParams.set('scheduleDay','today');
  if (workspace === 'Command' && page === 'tv') { url.searchParams.set('tv','1'); url.searchParams.delete('date'); url.searchParams.set('commandView','now'); }
  return url.pathname + url.search;
}
export function PageRail({ workspace, selected, canFinance, disabled, navigate, preload }: {
  workspace: string; selected: Record<string,string>; canFinance: boolean; disabled: boolean;
  navigate: (workspace: string, page: string) => void; preload: (workspace: string) => void;
}) {
  const open = (event: MouseEvent<HTMLAnchorElement>, target: string, page: string) => {
    if (disabled) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(target, page);
  };
  return <nav className="page-rail" aria-label="Pages">{workspacePages.filter(group => group.workspace !== 'Finance' || canFinance).map(group => <section className="page-rail-group" key={group.workspace} aria-label={group.label}>
    <h2>{group.label}</h2>{group.pages.filter(([id]) => !(group.workspace === 'Command' && ['forecast','tv'].includes(id) && !canFinance) && !(group.workspace === 'Krewe' && ['payperiod','monthly'].includes(id) && !canFinance)).map(([id,label]) => {
      const active = workspace === group.workspace && (selected[group.workspace] === id || group.workspace === 'Finance' && id === 'overview' && selected[group.workspace] === 'trends' || group.workspace === 'Marketing' && id === 'overview' && selected[group.workspace] === 'leads');
      return <a key={id} href={pageHref(group.workspace,group.key,id)} className={active ? 'page-rail-link active' : 'page-rail-link'} aria-current={active ? 'page' : undefined} aria-disabled={disabled || undefined} onPointerEnter={() => preload(group.workspace)} onFocus={() => preload(group.workspace)} onClick={event => open(event,group.workspace,id)}><group.icon size={15} aria-hidden="true" /><span>{label}</span></a>;
    })}
  </section>)}</nav>;
}
