/** Retired workspace URLs remain bookmarks, never a second application layout. */
export function currentWorkspaceUrl(source:URL):URL|null {
 const workspaces:Record<string,string>={'/':'Command','/jobs':'Schedule','/fleet':'Fleet','/crew':'Krewe','/finance':'Finance','/marketing':'Marketing'};
 const workspace=workspaces[source.pathname];if(!workspace)return null;
 const target=new URL(source);target.pathname='/desktop';target.searchParams.set('data','live');target.searchParams.set('workspace',workspace);
 const view=source.searchParams.get('view') || '';
 if(workspace==='Schedule') {
  const section=source.searchParams.get('workspace');
  const selected=section==='estimates'?'estimates':section==='unclosed'?'followup':view==='calendar'?'calendar':view==='monthly'?'history':'board';
  target.searchParams.set('scheduleView',selected);
 } else if(workspace==='Fleet' && ['overview','scores','maintenance','service','reports'].includes(view))target.searchParams.set('fleetView',view);
 else if(workspace==='Krewe' && ['today','payperiod','monthly','callin'].includes(view))target.searchParams.set('kreweView',view);
 else if(workspace==='Finance' && ['overview','reconciliation','payments','resale','recycling','trends','accounting','expenses'].includes(view))target.searchParams.set('financeView',view);
 else if(workspace==='Marketing' && ['overview','leads','reviews','performance'].includes(view))target.searchParams.set('marketingView',view);
 return target;
}
