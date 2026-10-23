import { workspaceLabel } from './lib/workspace-labels';
import { Activity, ChevronRight, X, CalendarDays, CircleDollarSign, Megaphone, Settings, Truck, Users } from 'lucide-react';
import type { MouseEvent } from 'react';

export const workspacePages = [
  { workspace: 'Command', label: workspaceLabel('Command'), key: 'commandView', icon: Activity, pages: [['now','Updates'],['today','Operating Control'],['forecast','Forecast'],['tv','The Huddle']] },
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
  workspace: string; canFinance: boolean; disabled: boolean; collapsed?: boolean; currentPage?: string;
  expandedWorkspace?: string; showPages?: (workspace: string) => void; closePages?: () => void;
  navigate: (workspace: string, page: string) => void; preload: (workspace: string) => void;
};
export function WorkspaceRailLink({ group, workspace, disabled, navigate, preload, collapsed }: Omit<RailProps, 'canFinance'> & { group: typeof workspacePages[number] }) {
  const active = workspace === group.workspace;
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); navigate(group.workspace, group.pages[0][0]);
  };
  return <div className="workspace-rail-group">
    <a href={pageHref(group.workspace, group.key, group.pages[0][0])} className={`workspace-rail-link${active ? ' active' : ''}`} aria-current={active ? (collapsed === false ? 'true' : 'page') : undefined} aria-disabled={disabled || undefined} aria-label={group.label} onClick={open} onPointerEnter={() => { if (!disabled) preload(group.workspace); }} onFocus={() => { if (!disabled) preload(group.workspace); }}>
      <span className="workspace-rail-icon"><group.icon size={20} aria-hidden="true" /></span><span>{group.label}</span>
    </a>
  </div>;
}
export function PageRail(props: RailProps) {
  const { workspace, collapsed, currentPage, disabled, navigate, preload, closePages, showPages } = props;
  const groups = workspacePages.filter(group => group.workspace !== 'Settings' && (group.workspace !== 'Finance' || props.canFinance));
  const expandedGroup = [...groups, workspacePages[6]].find(group => group.workspace === (props.expandedWorkspace || workspace)) || groups[0];
  const pages = expandedGroup.pages.filter(([page]) => page !== 'tv' || props.canFinance);
  return <>
    <nav id="workspace-sidebar-navigation" className="page-rail workspace-rail" aria-label="Workspaces">
      {groups.map(group => <div className="workspace-page-group" key={group.workspace}>
        <WorkspaceRailLink group={group} {...props} />
        <button type="button" className="workspace-group-toggle" aria-label={`${!collapsed && expandedGroup === group ? 'Hide' : 'Show'} ${group.label} pages`} aria-expanded={!collapsed && expandedGroup === group} aria-controls={!collapsed && expandedGroup === group ? 'sidebar-page-panel' : undefined} onClick={() => !collapsed && expandedGroup === group ? closePages?.() : showPages?.(group.workspace)}><ChevronRight size={14} aria-hidden="true" /></button>
      </div>)}
    </nav>
    {!collapsed && <>
      <button type="button" className="sidebar-page-backdrop" aria-label="Close sidebar pages" tabIndex={-1} onClick={closePages} />
      <section id="sidebar-page-panel" className="sidebar-page-panel" aria-label={`${expandedGroup.label} pages`}>
        <header><strong>{expandedGroup.label}</strong><button type="button" className="sidebar-panel-close" aria-label="Close page panel" onClick={closePages}><X size={18} aria-hidden="true" /></button></header>
        <nav className="workspace-page-list" aria-label={`${expandedGroup.label} pages`}>
          {pages.map(([page, label]) => <a key={page} className="workspace-page-link" href={pageHref(expandedGroup.workspace, expandedGroup.key, page)} aria-current={workspace === expandedGroup.workspace && currentPage === page ? 'page' : undefined} aria-disabled={disabled || undefined} onPointerEnter={() => { if (!disabled) preload(expandedGroup.workspace); }} onFocus={() => { if (!disabled) preload(expandedGroup.workspace); }} onClick={event => {
            if (disabled) { event.preventDefault(); return; }
            if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
            event.preventDefault(); navigate(expandedGroup.workspace, page);
          }}>{label}</a>)}
        </nav>
      </section>
    </>}
  </>;
}
