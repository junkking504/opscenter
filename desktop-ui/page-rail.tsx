import { workspaceLabel } from './lib/workspace-labels';
import { Activity, CalendarDays, CircleDollarSign, Megaphone, Settings, Truck, Users } from 'lucide-react';
import type { MouseEvent } from 'react';

export const workspacePages = [
  { workspace: 'Command', label: workspaceLabel('Command'), key: 'commandView', icon: Activity, pages: [['now','Updates'],['today','Operating Control'],['monitor','Monitor'],['forecast','Forecast'],['tv','The Huddle']] },
  { workspace: 'Schedule', label: workspaceLabel('Schedule'), key: 'scheduleView', icon: CalendarDays, pages: [['board','Board'],['calendar','Calendar'],['customers','Customers'],['estimates','Estimates'],['followup','Follow-Up'],['history','History']] },
  { workspace: 'Krewe', label: workspaceLabel('Krewe'), key: 'kreweView', icon: Users, pages: [['today','Today'],['payperiod','Pay period'],['monthly','Monthly']] },
  { workspace: 'Fleet', label: workspaceLabel('Fleet'), key: 'fleetView', icon: Truck, pages: [['overview','Overview'],['maintenance','Repairs & inspections'],['service','Maintenance']] },
  { workspace: 'Finance', label: workspaceLabel('Finance'), key: 'financeView', icon: CircleDollarSign, pages: [['overview','Overview'],['payments','Payments'],['expenses','Expenses'],['accounting','Accounting'],['resale','Resale'],['recycling','Recycling']] },
  { workspace: 'Marketing', label: workspaceLabel('Marketing'), key: 'marketingView', icon: Megaphone, pages: [['overview','Follow up'],['reviews','Reviews'],['performance','Results']] },
  { workspace: 'Settings', label: 'Settings', key: 'settingsView', icon: Settings, pages: [['overview','Settings']] },
] as const;
export function pageHref(workspace: string, key: string, page: string, href = window.location.href) {
  const url = new URL(href);
  for (const stale of ['appointment','customer','q','truck','member','inspectionReports','knowledge','report','tv','action']) url.searchParams.delete(stale);
  url.searchParams.set('workspace',workspace); url.searchParams.set(key,page); url.searchParams.set('scheduleDay','today');
  if (workspace === 'Command' && page === 'tv') { url.searchParams.set('tv','1'); url.searchParams.delete('date'); url.searchParams.set('commandView','now'); }
  return url.pathname + url.search;
}
type RailProps = {
  workspace: string; canFinance: boolean; disabled: boolean;
  navigate: (workspace: string, page: string) => void; preload: (workspace: string) => void;
};
export function WorkspaceRailLink({ group, workspace, disabled, navigate, preload }: Omit<RailProps, 'canFinance'> & { group: typeof workspacePages[number] }) {
  const active = workspace === group.workspace;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(group.workspace, group.pages[0][0]);
  };
  return <div className="workspace-rail-group">
    <a href={pageHref(group.workspace, group.key, group.pages[0][0])} className={`workspace-rail-link${active ? ' active' : ''}`} aria-current={active ? 'page' : undefined} aria-disabled={disabled || undefined} aria-label={group.label} onClick={open} onPointerEnter={() => { if (!disabled) preload(group.workspace); }} onFocus={() => { if (!disabled) preload(group.workspace); }}>
      <span className="workspace-rail-icon"><group.icon size={20} aria-hidden="true" /></span><span>{group.label}</span>
    </a>
  </div>;
}
export function PageRail(props: RailProps) {
  return <nav className="page-rail workspace-rail" aria-label="Workspaces">
    {workspacePages.filter(group => group.workspace !== 'Settings' && (group.workspace !== 'Finance' || props.canFinance)).map(group => <WorkspaceRailLink key={group.workspace} group={group} {...props} />)}
  </nav>;
}
