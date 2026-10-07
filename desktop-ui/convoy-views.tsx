import { historyEntries } from './lib/convoy-records';
import { ConvoyRecords } from './convoy-records';
import {ConvoyDashboard,ConvoyService} from './convoy-dashboard';
import { truckDisplayText } from '../lib/junkware-trucks';
import { ConvoyRepairs } from './convoy-repairs';
import { Button } from './components/ui/button';
import { DrivingScoreDetails } from './driving-scores';
import { sameTruck } from './lib/convoy-presentation';
import type { DesktopFleetSnapshot, DesktopFleetTruck, FleetIssueRow, FleetMaintenanceRow, FleetView } from './lib/people-fleet-contract';
import './convoy.css';

export type FleetRecord = { mode?: 'edit'; kind: 'truck' | 'load' | 'history' | 'issue' | 'checklist' | 'maintenance' | 'interval'; truck: DesktopFleetTruck; serviceType?: string; interval?: import('./lib/people-fleet-contract').FleetIntervalRow; issue?: FleetIssueRow; record?: FleetMaintenanceRow; initialStatus?: 'scheduled' | 'completed' };
type Props = { now: number; onView?: (view:FleetView)=>void; snapshot: DesktopFleetSnapshot; trucks: DesktopFleetTruck[]; view: FleetView; truckId: string; onTruck: (id: string) => void; open: (record: FleetRecord) => void };
const money = (n: number | null) => n === null ? 'Not recorded' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const number = (n: number | null) => n === null ? 'Not recorded' : n.toLocaleString('en-US', { maximumFractionDigits: 1 });
const costSummary = (rows: Array<{cost: number|null}>) => {const known=rows.filter(r=>r.cost!==null);const missing=rows.length-known.length;return known.length ? `${money(known.reduce((sum,r)=>sum+(r.cost??0),0))}${missing?` recorded · ${missing} missing totals`:''}` : 'Not recorded';};
const dateLabel = (date: string) => date ? new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date not recorded';


export function ConvoyHistory({ snapshot, truck, open }: { snapshot: DesktopFleetSnapshot; truck: DesktopFleetTruck; open: Props['open'] }) {
  return <ConvoyRecords snapshot={snapshot} trucks={[truck]} truckId={truck.id} open={open} compact/>;
}

export function ConvoyViews({snapshot,trucks,view,truckId,onTruck,open,now,onView}:Props) {
  const visible = trucks.filter(truck => !truckId || truck.id === truckId);
  const scopedRepairs = snapshot.issues.filter(row => !truckId || sameTruck(row.truck, truckId));
  return <>
    {view!=='overview'&&<div className="convoy-toolbar"><label>Truck<select value={truckId} onChange={event=>onTruck(event.target.value)}><option value="">All trucks</option>{trucks.map(truck=><option key={truck.id} value={truck.id}>{truck.label.replace(/Truck\s*#\s*/,'Truck ')}</option>)}{truckId&&!trucks.some(truck=>truck.id===truckId)&&<option value={truckId}>{truckId} · unavailable on this day</option>}</select></label><span>{truckId ? 'Showing this truck across Convoy. Choose All trucks to see the whole fleet.' : `${trucks.length} trucks in the fleet`}</span><a href={`/fleet-inspections?date=${encodeURIComponent(snapshot.date)}`}>Truck phone inspections</a></div>}
    {truckId&&!visible.length&&<p className="convoy-empty">This truck is not available in this day’s records. Choose another truck or All trucks.</p>}
    {view==='overview'&&<ConvoyDashboard {...{snapshot,trucks,truckId,onTruck,open,now,onView}}/>}
    {view==='maintenance'&&<ConvoyRepairs snapshot={snapshot} trucks={trucks} truckId={truckId} onTruck={onTruck} open={open}/>}
    {view==='service'&&<ConvoyService {...{snapshot,trucks,truckId,onTruck,open,now,onView}}/>}
    {view==='scores'&&<section className="convoy-panel convoy-driving"><header><h2>Driving</h2><p>{dateLabel(snapshot.date)} · Scores and the driving records behind them.</p></header>{visible.map(truck=>{const rows=(snapshot.drivingScores||[]).filter(row=>sameTruck(row.truck,truck.id));const row=rows[0];return <details key={truck.id}><summary><strong>{truck.label}</strong><span>{row?.display||'No driving score available'}</span><span>{row?.drivers.length?row.drivers.join(', '):'Driver not confirmed'}</span><span>View driving details</span></summary>{row?<DrivingScoreDetails rows={rows}/>:<p className="convoy-empty">No scoring record is available for this truck and day. GPS activity alone does not establish a driving score.</p>}</details>;})}</section>}
    {view==='reports'&&<><ConvoyRecords snapshot={snapshot} trucks={trucks} truckId={truckId} open={open}/><details className="convoy-monthly-report"><summary>Monthly usage & cost summary · {snapshot.date.slice(0,7)}</summary><section className="convoy-panel"><header><h2>Monthly summary</h2><p>{snapshot.date.slice(0,7)} · {snapshot.reportCoverageDays} observed days in the production and driving report. Missing costs stay “Not recorded.”</p></header>
      {visible.map(truck=>{const row=snapshot.reportRows.find(r=>sameTruck(r.truck,truck.id));const issues=scopedRepairs.filter(r=>sameTruck(r.truck,truck.id)&&r.updatedAt.startsWith(snapshot.date.slice(0,7)));const services=historyEntries({maintenance:snapshot.maintenance,issues:[]}).filter(r=>sameTruck(r.truck,truck.id)&&r.status==='completed'&&r.date.startsWith(snapshot.date.slice(0,7)));return <article className="convoy-report" key={truck.id}><header className="convoy-heading"><h3>{truck.label}</h3><Button variant="outline" size="sm" onClick={()=>open({kind:'history',truck})}>View truck history</Button></header><dl><div><dt>Jobs / revenue</dt><dd>{row?`${number(row.jobsCompleted)} jobs · ${money(row.revenue)}`:'Not available'}</dd></div><div><dt>Driving / idle</dt><dd>{row?`${number(row.miles)} mi · ${number(row.idleTimeMinutes)} min idle`:'Not available'}</dd></div><div><dt>Repair costs · records updated this month</dt><dd>{costSummary(issues)}</dd></div><div><dt>Downtime · records updated this month</dt><dd>{issues.length&&issues.every(r=>r.downtimeHours!==null)?`${number(issues.reduce((sum,r)=>sum+(r.downtimeHours??0),0))} hours`:'Not recorded'}</dd></div><div><dt>Completed service costs this month</dt><dd>{costSummary(services)}</dd></div><div><dt>Average truck driving score</dt><dd>{row?number(row.averageDriverScore):'Not available'}</dd></div></dl></article>;})}
      {!truckId&&snapshot.reportRows.filter(row=>!trucks.some(t=>sameTruck(t.id,row.truck))).map(row=><article className="convoy-row" key={row.truck}><div><strong>{truckDisplayText(row.truck)}</strong><p>{number(row.jobsCompleted)} jobs · {money(row.revenue)} · Report-only record; no physical truck details.</p></div></article>)}

    </section></details></>}
  </>;
}
