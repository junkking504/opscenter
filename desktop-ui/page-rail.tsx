import { workspaceLabel } from './lib/workspace-labels';
import { Activity, ChevronDown, CalendarDays, CircleDollarSign, Megaphone, Settings, Truck, Users } from 'lucide-react';
import { useState, type MouseEvent } from 'react';

export const workspacePages = [
  { workspace: 'Command', label: workspaceLabel('Command'), key: 'commandView', icon: Activity, pages: [['now','Updates'],['today','Operating Control'],['forecast','Forecast'],['tv','The Huddle']] },
  { workspace: 'Schedule', label: workspaceLabel('Schedule'), key: 'scheduleView', icon: CalendarDays, pages: [['board','Board'],['calendar','Calendar'],['customers','Customers'],['estimates','Estimates'],['followup','Follow-Up'],['history','History']] },
  { workspace: 'Krewe', label: workspaceLabel('Krewe'), key: 'kreweView', icon: Users, pages: [['today','Today'],['payperiod','Pay period'],['monthly','Monthly']] },
  { workspace: 'Fleet', label: workspaceLabel('Fleet'), key: 'fleetView', icon: Truck, pages: [['overview','Overview'],['inspections','Inspections'],['maintenance','Repairs'],['service','Maintenance'],['reports','Records'],['scores','Driving']] },
  { workspace: 'Finance', label: workspaceLabel('Finance'), key: 'financeView', icon: CircleDollarSign, pages: [['overview','Overview'],['trends','Trends'],['payments','Payments'],['expenses','Expenses'],['accounting','Accounting'],['resale','Resale'],['recycling','Recycling']] },
  { workspace: 'Marketing', label: workspaceLabel('Marketing'), key: 'marketingView', icon: Megaphone, pages: [['overview','Follow up'],['reviews','Reviews'],['performance','Results']] },
  { workspace: 'Settings', label: 'Settings', key: 'settingsView', icon: Settings, pages: [['overview','Settings']] },
] as const;
export function pageHref(workspace: string, key: string, page: string, href = window.location.href) {
  const url = new URL(href);
  for (const stale of ['focus','alert','notification','appointment','customer','q','truck','member','inspectionReports','knowledge','report','tv','action']) url.searchParams.delete(stale);
  url.searchParams.set('workspace',workspace); url.searchParams.set(key,page); url.searchParams.set('scheduleDay','today');
  if (workspace === 'Command' && page === 'tv') { url.searchParams.set('tv','1'); url.searchParams.delete('date'); url.searchParams.set('commandView','now'); }
  return url.pathname + url.search;
}
type RailProps = {
  workspace: string; canFinance: boolean; disabled: boolean; expanded?: boolean; currentPage?: string;
  navigate: (workspace: string, page: string) => void; preload: (workspace: string) => void;
};
export function WorkspaceRailLink({ group, workspace, disabled, navigate, preload, expanded }: Omit<RailProps, 'canFinance'> & { group: typeof workspacePages[number] }) {
  const active = workspace === group.workspace;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(group.workspace, group.pages[0][0]);
  };
  return <div className="workspace-rail-group">
    <a href={pageHref(group.workspace, group.key, group.pages[0][0])} className={`workspace-rail-link${active ? ' active' : ''}`} aria-current={active ? (expanded ? 'true' : 'page') : undefined} aria-disabled={disabled || undefined} aria-label={group.label} onClick={open} onPointerEnter={() => { if (!disabled) preload(group.workspace); }} onFocus={() => { if (!disabled) preload(group.workspace); }}>
      <span className="workspace-rail-icon"><group.icon size={20} aria-hidden="true" /></span><span>{group.label}</span>
    </a>
  </div>;
}
function WorkspacePageGroup(props: RailProps & { group: typeof workspacePages[number] }) {
  const { group, workspace, currentPage, disabled, navigate, preload } = props;
  const active = workspace === group.workspace;
  const [expanded, setExpanded] = useState(active);
  const [wasActive, setWasActive] = useState(active);
  // Reveal the destination when another control changes workspace, while still
  // allowing manual disclosure; leaving a workspace never moves its page links.
  if (active !== wasActive) { setWasActive(active); if (active) setExpanded(true); }
  const pages = group.pages.filter(([page]) => page !== 'tv' || props.canFinance);
  return <div className="workspace-page-group">
    <div className="workspace-group-heading">
      <WorkspaceRailLink {...props} expanded={expanded} />
      <button type="button" className="workspace-group-toggle" aria-label={`${expanded ? 'Collapse' : 'Expand'} ${group.label} pages`} aria-expanded={expanded} aria-controls={`sidebar-pages-${group.workspace}`} onClick={() => setExpanded(value => !value)}><ChevronDown size={16} aria-hidden="true" /></button>
    </div>
    <div id={`sidebar-pages-${group.workspace}`} className="workspace-page-list" hidden={!expanded}>
      {pages.map(([page, label]) => <a key={page} className="workspace-page-link" href={pageHref(group.workspace, group.key, page)} aria-current={active && currentPage === page ? 'page' : undefined} aria-disabled={disabled || undefined} onPointerEnter={() => { if (!disabled) preload(group.workspace); }} onFocus={() => { if (!disabled) preload(group.workspace); }} onClick={event => {
        if (disabled) { event.preventDefault(); return; }
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
        event.preventDefault(); navigate(group.workspace, page);
      }}>{label}</a>)}
    </div>
  </div>;
}
export function PageRail(props: RailProps) {
  return <nav id="workspace-sidebar-navigation" className="page-rail workspace-rail" aria-label="Workspaces">
    {workspacePages.filter(group => group.workspace !== 'Settings' && (group.workspace !== 'Finance' || props.canFinance)).map(group => <WorkspacePageGroup key={group.workspace} group={group} {...props} />)}
  </nav>;
}
