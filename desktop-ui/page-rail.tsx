import { Activity, CalendarDays, CircleDollarSign, Megaphone, Truck, Users } from 'lucide-react';
import { useEffect, useRef, useState, type MouseEvent } from 'react';

export const workspacePages = [
  { workspace: 'Command', label: 'Command', key: 'commandView', icon: Activity, pages: [['now','Updates'],['today','Operating Control'],['monitor','Monitor'],['forecast','Forecast'],['tv','The Huddle']] },
  { workspace: 'Schedule', label: 'Control', key: 'scheduleView', icon: CalendarDays, pages: [['board','Board'],['calendar','Calendar'],['customers','Customers'],['estimates','Estimates'],['followup','Follow-Up'],['history','History']] },
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
  const [openWorkspace, setOpenWorkspace] = useState<string | null>(null);
  const railRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (!railRef.current?.contains(event.target as Node)) setOpenWorkspace(null);
    };
    document.addEventListener('pointerdown', closeOutside);
    return () => document.removeEventListener('pointerdown', closeOutside);
  }, []);
  const open = (event: MouseEvent<HTMLAnchorElement>, target: string, page: string) => {
    if (disabled) { event.preventDefault(); return; }
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault(); setOpenWorkspace(null); navigate(target, page);
  };
  return <nav ref={railRef} className="page-rail workspace-rail" aria-label="Workspaces" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpenWorkspace(null); }} onKeyDown={event => { if (event.key === 'Escape') { setOpenWorkspace(null); const group = (event.target as HTMLElement).closest('.workspace-rail-group'); (group?.querySelector('.workspace-rail-link') as HTMLButtonElement | null)?.focus(); } }}>{workspacePages.filter(group => group.workspace !== 'Finance' || canFinance).map(group => {
    const pages = group.pages.filter(([id]) => !(group.workspace === 'Command' && ['forecast','tv'].includes(id) && !canFinance) && !(group.workspace === 'Krewe' && ['payperiod','monthly'].includes(id) && !canFinance));
    const active = workspace === group.workspace;
    return <div className={`workspace-rail-group${openWorkspace === group.workspace ? ' is-open' : ''}`} key={group.workspace} onPointerEnter={() => { if (!disabled) preload(group.workspace); }}>
      <button type="button" className={`workspace-rail-link${active ? ' active' : ''}`} aria-current={active ? 'location' : undefined} disabled={disabled} aria-label={group.label} aria-expanded={openWorkspace === group.workspace} aria-controls={`workspace-menu-${group.workspace}`} onFocus={() => preload(group.workspace)} onClick={() => setOpenWorkspace(current => current === group.workspace ? null : group.workspace)} onKeyDown={event => { if (event.key === 'ArrowRight' || event.key === 'ArrowDown') { event.preventDefault(); const button = event.currentTarget; setOpenWorkspace(group.workspace); requestAnimationFrame(() => (button.parentElement?.querySelector('.workspace-rail-page') as HTMLAnchorElement | null)?.focus()); } }}><span className="workspace-rail-icon"><group.icon size={20} aria-hidden="true" /></span><span>{group.label}</span></button>
      <div id={`workspace-menu-${group.workspace}`} className="workspace-rail-flyout" aria-label={`${group.label} pages`}>
        <h2>{group.label}</h2>{pages.map(([id,label]) => {
          const current = active && (selected[group.workspace] === id || group.workspace === 'Finance' && id === 'overview' && selected[group.workspace] === 'trends' || group.workspace === 'Marketing' && id === 'overview' && selected[group.workspace] === 'leads');
          return <a key={id} href={pageHref(group.workspace,group.key,id)} className={`workspace-rail-page${current ? ' active' : ''}`} aria-current={current ? 'page' : undefined} aria-disabled={disabled || undefined} onClick={event => open(event,group.workspace,id)}>{label}</a>;
        })}
      </div>
    </div>;
  })}</nav>;
}
