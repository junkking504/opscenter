import path from 'node:path';
import {readMetrics,type AnyRecord} from './opsData';
import type {CrewPhoneDay} from './crew-phone';
import {readVerifiedJunkwareScheduleSnapshot,type VerifiedJunkwareScheduleSnapshot} from './junkware-fast-schedule';
import {bonusProgress,moneyValue,truckKey,type WaypointDaySummary} from './waypoint-day-summary';
const nameKey=(name:unknown)=>String(name || '').trim().toLowerCase().replace(/\s+/g,' ');
const cents=(value:number)=>Math.round(value*100);
const amount=(value:number)=>Math.round(value)/100;
const amountForTruck=(values:AnyRecord|undefined,truck:string)=>{
  const matches=Object.entries(values || {}).filter(([key])=>truckKey(key)===truckKey(truck));
  return matches.length===1?moneyValue(matches[0][1]):null;
};
const amountForPerson=(values:AnyRecord|undefined,name:string)=>{
  const matches=Object.entries(values || {}).filter(([key])=>nameKey(key)===nameKey(name));
  return matches.length===1?moneyValue(matches[0][1]):null;
};
/** Project only this truck's completed appointments and the selected crew's performance.
 * Never return upcoming appointments, payroll rates, wages or other employees. */
export function projectWaypointDay(day:CrewPhoneDay,metrics:AnyRecord|null,now=Date.now(),schedule:VerifiedJunkwareScheduleSnapshot|null=null):WaypointDaySummary {
  const result:WaypointDaySummary={date:day.date,truck:day.truck,test:false,observedAt:null,stale:true,revenue:null,tips:null,completed:null,crew:[]};
  if(!metrics || metrics.date!==day.date || !Array.isArray(metrics.appointments))return {...result,message:'Today’s totals are unavailable. Refresh after the next source update.'};
  const freshness=metrics.source_freshness?.metrics?.truck_revenue;
  result.observedAt=freshness?.as_of || metrics.generated_at || null;
  const metricsObservedAt=Date.parse(result.observedAt || '');
  const seen=new Set<string>();
  result.completed=metrics.appointments.filter((row:AnyRecord)=>truckKey(row.truck_number || row.truck || row.assigned_truck)===truckKey(day.truck) && /^completed\b/i.test(String(row.job_status || ''))).flatMap((row:AnyRecord)=>{
    const id=String(row.appt_id || row.appointment_id || row.job_id || '');if(!id || seen.has(id))return [];seen.add(id);
    return [{id,reference:String(row.job_id || id),customer:String(row.customer_name || 'Completed appointment'),address:String(row.service_address || row.address || ''),time:String(row.appointment_time || ''),type:String(row.appointment_type || 'Job'),revenue:moneyValue(row.revenue),tips:moneyValue(row.tip) ?? 0}];
  });
  result.revenue=amountForTruck(metrics.revenue_by_truck,day.truck);
  result.tips=amountForTruck(metrics.tips_by_truck,day.truck);
  if(result.tips===null && metrics.tips_by_truck && freshness?.status==='current')result.tips=0;
  const metricsById=new Map<string,AnyRecord>();
  for(const row of metrics.appointments){
    const id=String(row.appt_id || row.appointment_id || row.job_id || '');
    if(id)metricsById.set(id,row);
  }
  const projectedCrew=new Map<string,{revenue:number;tips:number}>();
  let overlayObservedAt=Number.NaN,overlayApplied=false;
  const scheduleAge=schedule?now-schedule.freshnessAtMs:Infinity;
  if(schedule?.date===day.date && scheduleAge>=0 && scheduleAge<=120_000){
    for(const row of schedule.appointments){
      if(truckKey(row.truck_number || row.truck || row.assigned_truck)!==truckKey(day.truck) || !/^completed\b/i.test(String(row.job_status || '')))continue;
      const id=String(row.appt_id || row.appointment_id || row.job_id || '');
      const observedAt=Date.parse(String(row.status_observed_at || row.closeout_verified_at || schedule.scrapedAt || ''));
      const metricRow=metricsById.get(id);
      if(!id || seen.has(id) || !Number.isFinite(observedAt) || (Number.isFinite(metricsObservedAt) && observedAt<=metricsObservedAt) || /^completed\b/i.test(String(metricRow?.job_status || '')))continue;
      const revenue=moneyValue(row.closeout?.total ?? row.revenue),tips=moneyValue(row.closeout?.tip ?? row.tip) ?? 0;
      if(revenue===null)continue;
      seen.add(id);overlayApplied=true;overlayObservedAt=Math.max(overlayObservedAt || 0,observedAt);
      result.completed.push({id,reference:String(row.job_id || id),customer:String(row.customer_name || 'Completed appointment'),address:String(row.service_address || row.address || ''),time:String(row.appointment_time || ''),type:String(row.appointment_type || 'Job'),revenue,tips});
      result.revenue=result.revenue===null?null:amount(cents(result.revenue)+cents(revenue));
      result.tips=result.tips===null?null:amount(cents(result.tips)+cents(tips));
      if(String(metricRow?.crew_assignment_status || '').toLowerCase()!=='verified')continue;
      const names=[metricRow?.driver_normalized_name,metricRow?.navigator_normalized_name,...(Array.isArray(metricRow?.additional_crew)?metricRow.additional_crew:[])].map(value=>String(value || '').trim()).filter(Boolean);
      const unique=[...new Map(names.map(name=>[nameKey(name),name])).values()].sort((a,b)=>nameKey(a).localeCompare(nameKey(b)));
      if(!unique.length)continue;
      const revenueBase=Math.floor(cents(revenue)/unique.length),revenueRemainder=cents(revenue)%unique.length;
      const tipBase=Math.floor(cents(tips)/unique.length),tipRemainder=cents(tips)%unique.length;
      unique.forEach((name,index)=>{
        const current=projectedCrew.get(nameKey(name)) || {revenue:0,tips:0};
        current.revenue+=revenueBase+(index<revenueRemainder?1:0);
        current.tips+=tipBase+(index<tipRemainder?1:0);
        projectedCrew.set(nameKey(name),current);
      });
    }
  }
  // A valid completed feed with no activity is a known zero; a missing truck with activity is unknown.
  if(!result.completed.length && freshness?.status==='current'){result.revenue ??= 0;result.tips ??= 0;}
  const rows=[...(Array.isArray(metrics.payroll_records)?metrics.payroll_records:[]),...(Array.isArray(metrics.employee_leaderboard)?metrics.employee_leaderboard:[])];
  result.crew=[...new Set([day.driver,...day.navigators])].map(name=>{
    const row=rows.find((candidate:AnyRecord)=>nameKey(candidate.name || candidate.employee || candidate.employee_name)===nameKey(name));
    const projected=projectedCrew.get(nameKey(name));
    const baseRevenue=amountForPerson(metrics.credited_revenue_by_employee,name) ?? moneyValue(row?.individual_revenue);
    const baseTips=amountForPerson(metrics.credited_tip_by_employee,name) ?? moneyValue(row?.tip);
    const revenue=baseRevenue===null?null:amount(cents(baseRevenue)+(projected?.revenue || 0));
    const tips=baseTips===null?null:amount(cents(baseTips)+(projected?.tips || 0));
    const bonus=moneyValue(row?.revenue_bonus);
    // Do not promise a tier for salary/ineligible staff or when payroll's current policy disagrees.
    const progress=revenue!==null && row?.is_salary===false && bonus!==null && bonusProgress(revenue).bonus===bonus?bonusProgress(revenue):null;
    return {name,revenue,tips,bonus,progress};
  });
  if(Number.isFinite(overlayObservedAt))result.observedAt=new Date(overlayObservedAt).toISOString();
  const age=result.observedAt?now-Date.parse(result.observedAt):Infinity;
  result.stale=freshness?.status!=='current' || !Number.isFinite(age) || age<0 || age>10*60_000;
  result.message=result.stale?'Last reported totals · source update pending.':overlayApplied?'Today so far · verified JunkWare closeout included; bonuses confirm after metrics sync.':'Today so far · totals update after JunkWare sync.';
  return result;
}
export function readWaypointDay(day:CrewPhoneDay){
  const dataDir=process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw', 'workspace', 'opsbot', 'data');
  return projectWaypointDay(day,readMetrics(day.date),Date.now(),readVerifiedJunkwareScheduleSnapshot(dataDir,day.date));
}
