import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { Button } from './components/ui/button';
import { appointmentRegion, scheduleTruckNames, truckLabel, type ScheduleAppointment, type ScheduleSnapshot } from './lib/schedule-contract';
import { adjustRoute, planEligible, routeAreas, routePlanSourceKey, type PlanOptions, type PlanRoute, type RoutePlan } from './lib/route-plan';
import './schedule-route-plan.css';

const time = (minutes: number|null) => minutes===null ? 'Unknown' : `${minutes>=1440?'+1 day · ':''}${Math.floor(minutes/60)%12||12}:${String(minutes%60).padStart(2,'0')} ${minutes%1440>=720?'PM':'AM'}`;
export default function ScheduleRoutePlan({snapshot,busy,select,review}: {snapshot:ScheduleSnapshot;busy:boolean;select:(id:string)=>void;review:(job:ScheduleAppointment,truck:string)=>void}) {
  const [open,setOpen]=useState(false);
  const [trucks,setTrucks]=useState(()=>[...new Set(snapshot.appointments.filter(planEligible).map(j=>truckLabel(j.truck)).filter(t=>t!=='Unassigned'))]);
  const [area,setArea]=useState('metro'); const [start,setStart]=useState('08:00'); const [service,setService]=useState(30);
  const [plan,setPlan]=useState<RoutePlan|null>(null); const [draft,setDraft]=useState<PlanRoute[]|null>(null);
  const [loading,setLoading]=useState(false); const [error,setError]=useState(''); const [dirty,setDirty]=useState(false);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const sourceKey=routePlanSourceKey(snapshot.appointments);
  const currentKey=useRef(sourceKey); currentKey.current=sourceKey;
  const stale=!!plan&&plan.sourceKey!==sourceKey;
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
  const historical=snapshot.date<today;
  const names=scheduleTruckNames(snapshot).filter(t=>t!=='Unassigned');
  const changeOptions=()=>{setDirty(true);setDraft(null);};
  const calculate=async (routes?:PlanRoute[])=>{
    if(loading||busy) return;
    request.current?.abort(); const controller=new AbortController(); request.current=controller;
    const timeout=window.setTimeout(()=>controller.abort(),120_000);
    setLoading(true);setError('');
    try {
      const [hours,minutes]=start.split(':').map(Number);
      const options:PlanOptions={trucks,area,start:hours*60+minutes,serviceMinutes:service,...(routes?{routes}:{})};
      const response=await fetch('/api/desktop/schedule/plan',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({...options,date:snapshot.date,sourceKey}),signal:controller.signal});
      const body=await response.json();
      if(!response.ok) throw new Error(body.error||'The route proposal is unavailable.');
      if(currentKey.current!==body.sourceKey) throw new Error('The schedule changed. Rebuild the proposal with the latest appointments.');
      setPlan(body);setDraft(body.routes.map((r:PlanRoute)=>({truck:r.truck,appointmentIds:r.appointmentIds})));setDirty(false);
    } catch(failure) {if(request.current===controller) setError(failure instanceof Error&&failure.name!=='AbortError'?failure.message:'Route calculation timed out. No assignments were changed.');}
    finally {window.clearTimeout(timeout);if(request.current===controller)setLoading(false);}
  };
  const adjust=(id:string,truck:string,direction=0)=>{setDraft(adjustRoute(draft||[],id,truck,direction));setDirty(true);};
  const valid=!!plan&&!dirty&&!stale&&!loading;
  return <section className="schedule-route-plan" aria-label="Route Planner">
    <header><div><h2>Route Planner</h2><p>One proposed route per truck. Review stops and travel before changing assignments.</p></div><Button variant="outline" disabled={busy} aria-expanded={open} onClick={()=>setOpen(!open)}>{open?'Hide Planner':'Plan Routes'}</Button></header>
    {open&&<>
      <div className="route-plan-options">
        <fieldset disabled={loading||busy}><legend>Trucks To Plan</legend><div className="route-plan-trucks">{names.map(truck=><label key={truck}><input type="checkbox" checked={trucks.includes(truck)} onChange={()=>{setTrucks(trucks.includes(truck)?trucks.filter(t=>t!==truck):[...trucks,truck]);changeOptions();}}/>{truck}</label>)}</div><small>Trucks with open work are preselected. Confirm which trucks are active; this does not verify crew or load readiness.</small></fieldset>
        <div className="route-plan-settings">
          <label>Include Unassigned From<select disabled={loading||busy} value={area} onChange={e=>{setArea(e.target.value);changeOptions();}}>{Object.entries(routeAreas).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
          <label>First Stop No Earlier Than<input type="time" disabled={loading||busy} value={start} onChange={e=>{setStart(e.target.value);changeOptions();}}/></label>
          <label>Assumed Minutes Per Stop<input type="number" min="5" max="240" disabled={loading||busy} value={service} onChange={e=>{setService(Number(e.target.value));changeOptions();}}/></label>
          <Button disabled={loading||busy||!trucks.length||!start||service<5||service>240} onClick={()=>calculate()}>{loading?'Calculating…':plan?'Rebuild Proposal':'Propose Routes'}</Button>
        </div>
        <p>Existing assignments stay on their trucks initially, including other territories. Unassigned stops are balanced by stop count; window order and nearby locations guide the sequence. This is a starting proposal, not an optimized or verified route.</p>
      </div>
      {error&&<p className="route-plan-notice" role="alert">{error}</p>}
      {stale&&<p className="route-plan-notice" role="status">The schedule changed. Rebuild the proposal before reviewing assignments.</p>}
      {dirty&&plan&&!stale&&<p className="route-plan-notice" role="status">Proposal edited. {draft?<Button variant="outline" disabled={loading||busy} onClick={()=>calculate(draft)}>Recalculate Edited Routes</Button>:'Rebuild to use the new planning assumptions.'} Travel and arrival estimates are hidden until recalculated.</p>}
      {plan&&<>
        <div className="route-plan-explainer"><strong>Proposal Only · Nothing Applied</strong><span>Google current traffic · Calculated {new Date(plan.calculatedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})}. Planned arrivals assume the entered service time and start at the first stop—not at the truck’s GPS position. Missing travel makes downstream arrivals unknown.</span><span>{plan.excluded} closed, unverified, or unidentified appointments excluded. Stop order is not saved to JunkWare; Review Assignment changes only the truck after confirmation. Appointment windows stay unchanged.{historical?' Historical date: assignments cannot be applied from this proposal.':''}</span></div>
        <div className="route-plan-routes">{(draft||plan.routes).map(route=>{
          const calculated=plan.routes.find(r=>r.truck===route.truck);
          const legs=calculated?.stops.slice(1)||[]; const allKnown=legs.every(s=>s.travelMinutes!==null); const warnings=calculated?.stops.filter(s=>s.warnings.length).length||0;
          return <article className="route-plan-truck" key={route.truck}><header><h3>{route.truck}</h3><span>{route.appointmentIds.length} Stops{valid&&route.appointmentIds.length>1?` · ${allKnown?'':'Partial: '}${legs.reduce((sum,s)=>sum+(s.travelMinutes||0),0)} min · ${legs.reduce((sum,s)=>sum+(s.miles||0),0).toFixed(1)} mi between stops`:''}{valid&&warnings?` · ${warnings} Need Review`:''}</span></header>
            {!route.appointmentIds.length&&<p className="route-plan-empty">No stops proposed for this truck.</p>}
            <ol>{route.appointmentIds.map((id,index)=>{
              const job=snapshot.appointments.find(j=>j.recordId===id); if(!job)return null;
              const stop=calculated?.stops.find(s=>s.id===id); const region=appointmentRegion(job); const changed=truckLabel(job.truck)!==route.truck;
              return <li key={id}>
                {index>0&&<div className="route-plan-leg">↓ {valid&&stop?(stop.travelMinutes===null?'Travel Unavailable — Verify Location / Provider':`${stop.travelMinutes} min · ${stop.miles} mi from previous stop`):'Recalculate travel'}</div>}
                <div className="route-plan-stop"><span className={`route-plan-number territory-${region.code.toLowerCase()}`}>{index+1}</span>
                  <div className="route-plan-detail"><button className="route-plan-reference" disabled={busy} onClick={()=>select(id)}>{job.jkNumber||'JK Pending'} · {job.customerName||'Customer Unavailable'}</button><span>{job.appointmentTime||'Time Not Set'} · {region.label} · {job.appointmentType}</span><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(job.address)}`} target="_blank" rel="noopener noreferrer">{job.address||'Address Unavailable'}</a><small>{valid&&stop?`${index===0?'Planned Start':'Planned Arrival'}: ${time(stop.arrival)}${stop.warnings.length?` · ${stop.warnings.join(' · ')}`:''}`:'Estimates Need Recalculation'}</small></div>
                  <div className="route-plan-stop-actions"><div><Button size="sm" variant="outline" aria-label={`Move ${job.jkNumber} earlier in ${route.truck}`} disabled={loading||busy||stale||!draft||index===0} onClick={()=>adjust(id,route.truck,-1)}><ArrowUp size={14}/></Button><Button size="sm" variant="outline" aria-label={`Move ${job.jkNumber} later in ${route.truck}`} disabled={loading||busy||stale||!draft||index===route.appointmentIds.length-1} onClick={()=>adjust(id,route.truck,1)}><ArrowDown size={14}/></Button></div><select aria-label={`Proposed truck for ${job.jkNumber}`} value={route.truck} disabled={loading||busy||stale||!draft} onChange={e=>adjust(id,e.target.value)}>{trucks.map(t=><option key={t}>{t}</option>)}</select>{changed?<Button variant="outline" size="sm" disabled={!valid||historical||busy} onClick={()=>review(job,route.truck)}>Review Assignment</Button>:<small>Current Assignment</small>}</div>
                </div>
              </li>;
            })}</ol>
          </article>;
        })}</div>
      </>}
    </>}
  </section>;
}
