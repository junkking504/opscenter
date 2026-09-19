import {readMetrics,type AnyRecord} from './opsData';
import type {CrewPhoneDay} from './crew-phone';
import {bonusProgress,moneyValue,truckKey,type WaypointDaySummary} from './waypoint-day-summary';
const nameKey=(name:unknown)=>String(name || '').trim().toLowerCase().replace(/\s+/g,' ');
const amountForTruck=(values:AnyRecord|undefined,truck:string)=>{
  const matches=Object.entries(values || {}).filter(([key])=>truckKey(key)===truckKey(truck));
  return matches.length===1?moneyValue(matches[0][1]):null;
};
/** Project only this truck's completed appointments and the selected crew's performance.
 * Never return upcoming appointments, payroll rates, wages or other employees. */
export function projectWaypointDay(day:CrewPhoneDay,metrics:AnyRecord|null,now=Date.now()):WaypointDaySummary {
  const result:WaypointDaySummary={date:day.date,truck:day.truck,test:false,observedAt:null,stale:true,revenue:null,tips:null,completed:null,crew:[]};
  if(!metrics || metrics.date!==day.date || !Array.isArray(metrics.appointments))return {...result,message:'Today’s totals are unavailable. Refresh after the next source update.'};
  const freshness=metrics.source_freshness?.metrics?.truck_revenue;
  result.observedAt=freshness?.as_of || metrics.generated_at || null;
  const age=result.observedAt?now-Date.parse(result.observedAt):Infinity;
  result.stale=freshness?.status!=='current' || !Number.isFinite(age) || age<0 || age>10*60_000;
  result.message=result.stale?'Last reported totals · source update pending.':'Today so far · totals update after JunkWare sync.';
  const seen=new Set<string>();
  result.completed=metrics.appointments.filter((row:AnyRecord)=>truckKey(row.truck_number || row.truck || row.assigned_truck)===truckKey(day.truck) && /^completed\b/i.test(String(row.job_status || ''))).flatMap((row:AnyRecord)=>{
    const id=String(row.appt_id || row.appointment_id || row.job_id || '');if(!id || seen.has(id))return [];seen.add(id);
    return [{id,reference:String(row.job_id || id),customer:String(row.customer_name || 'Completed appointment'),address:String(row.service_address || row.address || ''),time:String(row.appointment_time || ''),type:String(row.appointment_type || 'Job'),revenue:moneyValue(row.revenue),tips:moneyValue(row.tip) ?? 0}];
  });
  result.revenue=amountForTruck(metrics.revenue_by_truck,day.truck);
  result.tips=amountForTruck(metrics.tips_by_truck,day.truck);
  if(result.tips===null && metrics.tips_by_truck && freshness?.status==='current')result.tips=0;
  // A valid completed feed with no activity is a known zero; a missing truck with activity is unknown.
  if(!result.completed.length && freshness?.status==='current'){result.revenue ??= 0;result.tips ??= 0;}
  const rows=[...(Array.isArray(metrics.payroll_records)?metrics.payroll_records:[]),...(Array.isArray(metrics.employee_leaderboard)?metrics.employee_leaderboard:[])];
  result.crew=[...new Set([day.driver,...day.navigators])].map(name=>{
    const row=rows.find((candidate:AnyRecord)=>nameKey(candidate.name || candidate.employee || candidate.employee_name)===nameKey(name));
    const revenue=moneyValue(row?.individual_revenue),tips=moneyValue(row?.tip),bonus=moneyValue(row?.revenue_bonus);
    // Do not promise a tier for salary/ineligible staff or when payroll's current policy disagrees.
    const progress=revenue!==null && row?.is_salary===false && bonus!==null && bonusProgress(revenue).bonus===bonus?bonusProgress(revenue):null;
    return {name,revenue,tips,bonus,progress};
  });
  return result;
}
export function readWaypointDay(day:CrewPhoneDay){return projectWaypointDay(day,readMetrics(day.date));}
