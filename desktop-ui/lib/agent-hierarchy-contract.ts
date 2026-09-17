export type AgentDefinition = { id: string; name: string; parent: string | null; responsibility: string; dependencies: string[] };
export type AgentTab = { page: string; tab: string; owner: string };
const role = (id: string, name: string, parent: string | null, responsibility: string, dependencies: string[] = []): AgentDefinition => ({id,name,parent,responsibility,dependencies});
export const hierarchyAgents: AgentDefinition[] = [
  role('command','Command coordinator',null,'Surface unresolved priorities and supervise both branches.'),
  role('operations','Operations lead','command','Coordinate page heads and cross-page ownership.'),
  role('engineering','Engineering lead','command','Coordinate implementation, source reliability, acceptance and releases.'),
  role('control','Control head','operations','Review dispatch, appointment and closeout exceptions.',['JunkWare']),
  role('crew','Crew head','operations','Review staffing and crew follow-through.',['JunkWare','Crew Portal']),
  role('convoy','Convoy head','operations','Supervise fleet restrictions and truck readiness.',['truck-assessments']),
  role('capital','Capital head','operations','Review financial source exceptions without conflating actual, assumed and unknown amounts.',['JunkWare','QuickBooks']),
  role('campaign','Campaign head','operations','Review lead and review collection health.',['SearchKings','Podium']),
  role('dispatch','Dispatch specialist','control','Review assignments, route progress and outstanding appointment actions.',['JunkWare','truck-assessments']),
  role('followup','Appointment follow-up specialist','control','Review estimates and follow-up work in the existing operating queue.',['JunkWare','operating-queue']),
  role('staffing','Staffing and inspection completion specialist','crew','Review missing crew assignments, inspections and fuel readiness.',['truck-assessments']),
  role('payroll','Payroll review specialist','crew','Review payroll source exceptions; Capital remains the financial escalation owner.',['JunkWare','Crew Portal','operating-queue']),
  role('maintenance','Maintenance specialist','convoy','Review repair restrictions and service due dates.',['truck-assessments']),
  role('inspection','Inspection specialist','convoy','Review reported defects and evidence needed to clear restrictions.',['truck-assessments']),
  role('capacity','Capacity specialist','convoy','Review supported capacity and disposal recommendations.',['truck-assessments','unload-cost']),
  role('payments','Payment reconciliation specialist','capital','Review payment exceptions through the existing reconciliation workflow.',['JunkWare','QuickBooks','operating-queue']),
  role('expenses','Expense reconciliation specialist','capital','Review receipt conflicts and provisional disposal costs.',['unload-cost','operating-queue']),
  role('accounting','Accounting and reporting specialist','capital','Review accounting source availability and reporting exceptions.',['QuickBooks','operating-queue']),
  role('leads','Lead follow-up specialist','campaign','Review lead collection health and existing follow-up exceptions.',['SearchKings','operating-queue']),
  role('reviews','Review specialist','campaign','Review review-source availability and existing review exceptions.',['Podium','operating-queue']),
  role('visit-tracking','Visit tracking','operations','Produce shared arrival and departure evidence.',['visit-tracking']),
  role('unload-cost','Unload and cost reconciliation','operations','Produce shared unload and cost evidence without writing accounting records.',['unload-cost']),
  role('implementation','Product and implementation','engineering','Own observed product defects for a scoped engineering session.',['maintenance-observer']),
  role('integrations','Integrations and data reliability','engineering','Review source failures and preserve source precedence.',['maintenance-observer']),
  role('verification','Verification and acceptance','engineering','Track interaction failures until the existing acceptance workflow verifies recovery.',['maintenance-observer']),
  role('release','Release and runtime reliability','engineering','Review runner failures and runtime observations.',['runner','maintenance-observer']),
  ...Array.from({length:9},(_,i)=>role(`truck-${i+1}`,`Truck ${i+1} agent`,'convoy','Assess the truck and retain responsibility until a specialist accepts.',['truck-assessments'])),
];
const tabs = (page: string, entries: Array<[string,string]>): AgentTab[] => entries.map(([tab,owner])=>({page,tab,owner}));
export const hierarchyTabs: AgentTab[] = [
  ...tabs('Command',[['Alerts','command'],['Control','operations'],['Monitor','engineering']]),
  ...tabs('Control',[['Board','dispatch'],['Calendar','dispatch'],['Estimates','followup'],['Follow-Up','followup'],['History','control']]),
  ...tabs('Crew',[['Today','staffing'],['Call-in plan','staffing'],['Pay period','payroll'],['Monthly','payroll']]),
  ...tabs('Convoy',[['Trucks','convoy'],['Inspections & Repairs','inspection'],['Service','maintenance'],['Driving','convoy'],['History & Costs','capacity']]),
  ...tabs('Capital',[['Overview','capital'],['Payments','payments'],['Expenses','expenses'],['Accounting','accounting'],['Resale','accounting'],['Recycling','accounting'],['Trends','accounting']]),
  ...tabs('Campaign',[['Follow up','leads'],['Reviews','reviews'],['Results','campaign']]),
];
export type HierarchyFinding = { id: string; feed: string; title: string; detail: string; href: string; target: string; origin: string; priority: 'urgent'|'next'|'watch' };
export type HierarchyFeed = { id: string; available: boolean; observedAt: string | null; detail: string; findings: HierarchyFinding[] };
export type HierarchyIssue = HierarchyFinding & { owner: string; proposedOwner: string | null; status: 'open'|'unconfirmed'|'source_cleared'; firstSeenAt: string; lastSeenAt: string; dueAt: string; escalatedTo: string | null; history: Array<{at:string;from:string;to:string;event:'assigned'|'proposed'|'accepted'|'source_cleared'|'reopened'}> };
export type HierarchyAssessment = AgentDefinition & { status:'monitoring'|'needs_review'|'unavailable'; checkedAt:string; detail:string; openCount:number; overdueCount:number };
export type HierarchySnapshot = { version:1; date:string; checkedAt:string; agents:HierarchyAssessment[]; tabs:AgentTab[]; feeds:Omit<HierarchyFeed,'findings'>[]; issues:HierarchyIssue[]; warnings:string[] };
