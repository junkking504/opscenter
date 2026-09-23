import {chicagoDateKey} from './chicago-date';
import type {TrackedVisit} from './visit-tracking-agent';
import type {DumpFeePolicy} from './dump-expense-policy';
import type {TruckExpense} from './truck-expense-notifications';
import type {TruckLoadEvent} from './truck-load-status';
import type {DumpExpenseRecord} from '../desktop-ui/lib/dump-expense-contract';
import {canonicalDumpLocation} from './dump-expense-identity';

export const UNLOAD_COST_AGENT='unload-cost' as const;
const normalized=(value:string)=>value.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const truckKey=(value:string)=>value.match(/\d+/)?.[0]?.replace(/^0+/,'');
const knownSites=[['gentilly','gentillt','gentilly landfill','gl'],['river birch','river birch landfill','rbl'],['stranco','stranco transfer station','sts'],['green meadow','green meadow transfer station','mengel','gmts'],['ebr','ebr landfill','baton rouge landfill','brl','br landfill','br landfilll']];
function facilityKey(name:string,policy:DumpFeePolicy|null) {
  const key=normalized(name);
  const configured=policy?.facilities.find(site=>[site.name,...site.aliases].some(alias=>normalized(alias)===key));
  const configuredKey=normalized(configured?.name || name);
  return knownSites.find(aliases=>aliases.includes(configuredKey))?.[0] || configuredKey;
}
export function uniqueTrackedVisits(visits:TrackedVisit[]):TrackedVisit[] {
  const result:TrackedVisit[]=[];
  for(const visit of visits) {
    const index=result.findIndex(prior=>prior.id===visit.id || (prior.kind===visit.kind && prior.truck===visit.truck && prior.entryIds.some(id=>visit.entryIds.includes(id))));
    if(index<0) {result.push(visit);continue;}
    const prior=result[index];
    const preferred=visit.departedAt && (!prior.departedAt || (visit.departureSource==='native_geofence' && prior.departureSource!=='native_geofence')) ? visit : prior;
    result[index]={...preferred,entryIds:[...new Set([...prior.entryIds,...visit.entryIds])]};
  }
  return result;
}
/** Exactly one physical unload per visit, always at the original arrival.
 * A later expense changes the cost only; it can never clear later pickups. */
export function projectUnloadEvents(date:string,visits:TrackedVisit[],now=Date.now()):TruckLoadEvent[] {
  return uniqueTrackedVisits(visits).filter(visit=>visit.kind==='geofence' && visit.resetLocation && visit.entryIds.length && visit.firstObservedAt
    && Date.parse(visit.firstObservedAt)<=now && chicagoDateKey(new Date(visit.firstObservedAt))===date).map(visit=>({
    eventId:`unload:${visit.id}`,date,truck:visit.truck.replace('Truck ','Truck# '),kind:'yard_reset',loadFraction:0,
    occurredAt:visit.firstObservedAt,recordedAt:visit.firstObservedAt,recordedBy:`Unload agent: ${canonicalDumpLocation(visit.name)} (${visit.arrivalSource==='live_position'?'GPS facility arrival':'geofence entry'})`,
    appointmentId:'',jobNumber:'',loadSize:'',loadQuantity:'',contents:'',resetLocation:visit.resetLocation!,
  }));
}
export function projectVerifiedExpenseUnloadEvents(
  date:string,
  expenses:TruckExpense[],
  records:DumpExpenseRecord[],
  completedJobs:Array<{appointmentId:string;truck:string;completedAt:string}>,
  linkedExpenseIds:ReadonlySet<string>=new Set(),
  now=Date.now(),
):TruckLoadEvent[] {
  const matched=new Set(records.filter(record=>record.enteredAt && record.status==='actual' && record.actualExpenseId).map(record=>record.actualExpenseId!));
  return expenses.filter(expense=>expense.kind==='dump' && expense.date===date && !!truckKey(expense.truck) && !expense.reconciliationNote && !matched.has(expense.id)
    && !linkedExpenseIds.has(expense.id) && Number.isFinite(Date.parse(expense.transactionAt)) && Date.parse(expense.transactionAt)<=now)
    .map(expense=>({
      eventId:`unload:expense:${expense.id}`,date,truck:`Truck# ${truckKey(expense.truck)}`,kind:'yard_reset' as const,loadFraction:0,
      occurredAt:new Date(expense.transactionAt).toISOString(),recordedAt:expense.sourceObservedAt || new Date(expense.transactionAt).toISOString(),
      recordedBy:`Verified JunkWare dump expense: ${canonicalDumpLocation(expense.location)}`,
      appointmentId:'',jobNumber:'',loadSize:'',loadQuantity:'',contents:'',resetLocation:'dump',
      coveredAppointmentIds:[...new Set(completedJobs.filter(job=>truckKey(job.truck)===truckKey(expense.truck)
        && Number.isFinite(Date.parse(job.completedAt)) && Date.parse(job.completedAt)<=Date.parse(expense.transactionAt)).map(job=>job.appointmentId))].sort(),
    }));
}
export function runUnloadCostAgent(date:string,inputVisits:TrackedVisit[],inputExpenses:TruckExpense[],policy:DumpFeePolicy|null,now=Date.now()) {
  const visits=uniqueTrackedVisits(inputVisits);
  const records:DumpExpenseRecord[]=visits.filter(visit=>visit.kind==='geofence' && visit.resetLocation==='dump' && visit.entryIds.length && visit.firstObservedAt
    && Date.parse(visit.firstObservedAt)<=now && (!policy || chicagoDateKey(new Date(visit.firstObservedAt))>=policy.effectiveFrom)).map(visit=>{
    const site=policy?.facilities.find(site=>facilityKey(site.name,policy)===facilityKey(visit.name,policy));
    const fee=site?.minimumFee ?? policy?.defaultMinimumFee ?? null;
    return {id:`dump-visit:${visit.id}`,date:chicagoDateKey(new Date(visit.firstObservedAt)),truck:visit.truck,location:canonicalDumpLocation(visit.name),
      enteredAt:visit.firstObservedAt,departedAt:visit.departedAt,departureBounds:visit.departureBounds,replaceUntil:null,
      amount:fee,assumedAmount:fee,status:fee===null?'minimum_missing':'assumed',window:visit.departedAt?'open':'onsite',
      actualExpenseId:null,transactionAt:visit.firstObservedAt,unloadEventId:`unload:${visit.id}`};
  });
  const actuals=[...new Map(inputExpenses.filter(row=>row.kind==='dump' && Date.parse(row.transactionAt)<=now).map(row=>[row.id,{...row}])).values()];
  for(const expense of actuals) if(expense.receipt.trim() && actuals.some(other=>other.id!==expense.id && other.date===expense.date
    && truckKey(other.truck)!==truckKey(expense.truck) && other.receipt.trim().toLowerCase()===expense.receipt.trim().toLowerCase()
    && facilityKey(other.location,policy)===facilityKey(expense.location,policy)))
    expense.reconciliationNote='Receipt ownership conflict: this receipt is recorded on different trucks at the same facility. Review receipt or crew evidence; recorded ownership has not been changed.';
  const options=actuals.map(expense=>{
    const time=Date.parse(expense.transactionAt);
    // Collection time is not exact arrival time. A named receipt just before
    // the first GPS observation needs review, never automatic replacement.
    const nearby=records.filter(record=>expense.location.trim() && record.date===expense.date
      && truckKey(record.truck)===truckKey(expense.truck)
      && facilityKey(record.location,policy)===facilityKey(expense.location,policy)
      && Date.parse(record.enteredAt!)>time && Date.parse(record.enteredAt!)-time<=5*60_000);
    const candidates=records.filter(record=>truckKey(record.truck)===truckKey(expense.truck) && time>=Date.parse(record.enteredAt!)
      && (record.date===expense.date || (!!record.departedAt && chicagoDateKey(new Date(record.departedAt))===expense.date && Date.parse(record.departedAt)-Date.parse(record.enteredAt!)<=36*3600_000))
      && (!expense.location.trim() || facilityKey(record.location,policy)===facilityKey(expense.location,policy)));
    // Precise onsite timing can distinguish repeated named-site visits. A late
    // record without that evidence must have one possible visit for its day.
    const onsite=candidates.filter(record=>record.departedAt && time<=Date.parse(record.departureBounds?.after || record.departedAt));
    if(nearby.length) {
      expense.reconciliationNote ||= 'Receipt precedes the first recorded arrival by five minutes or less. Confirm the visit using receipt or crew evidence before combining costs; no assumption has been replaced.';
      return [...new Set([...candidates,...nearby])];
    }
    return expense.location.trim() && onsite.length===1 ? onsite : candidates;
  });
  const matched=new Set<string>();
  actuals.forEach((expense,index)=>{
    const candidates=options[index];
    const record=candidates.length===1 && !expense.reconciliationNote
      && options.filter(matches=>matches.includes(candidates[0])).length===1 ? candidates[0] : null;
    if(record) {
      record.status='actual';record.amount=expense.amount;record.actualExpenseId=expense.id;record.sourceExpenseIds=expense.sourceExpenseIds || [expense.id];
      record.transactionAt=expense.transactionAt;matched.add(expense.id);
    } else if(candidates.length || expense.reconciliationNote) {
      const note=expense.reconciliationNote || 'More than one visit or actual expense could match. Review the dump records; no assumption has been replaced.';
      candidates.forEach(candidate=>candidate.reconciliationNote=note);
    }
  });
  const result:DumpExpenseRecord[]=[...records.filter(record=>record.date===date),...actuals.filter(row=>row.date===date && !matched.has(row.id)).map(expense=>({
    id:`dump-actual:${expense.id}`,date,truck:expense.truck.replace('#',''),location:canonicalDumpLocation(expense.location),enteredAt:null,departedAt:null,replaceUntil:null,
    amount:expense.amount,assumedAmount:null,status:'actual' as const,window:null,actualExpenseId:expense.id,sourceExpenseIds:expense.sourceExpenseIds || [expense.id],transactionAt:expense.transactionAt,
    reconciliationNote:expense.reconciliationNote || (options[actuals.indexOf(expense)].length ? 'Review the matching visit or competing expense before counting the combined cost.' : undefined),
  }))].sort((a,b)=>Date.parse(b.transactionAt)-Date.parse(a.transactionAt));
  const total=(status:'actual'|'assumed')=>Math.round(result.filter(record=>record.status===status).reduce((sum,record)=>sum+(record.amount??0),0)*100)/100;
  const missingMinimumCount=result.filter(record=>record.status==='minimum_missing').length;
  const needsReviewCount=result.filter(record=>record.reconciliationNote).length;
  return {agentId:UNLOAD_COST_AGENT,date,records:result,unloads:projectUnloadEvents(date,visits,now),actualTotal:actuals.some(row=>row.date===date && (row.reconciliationNote?.startsWith('Possible duplicate') || row.reconciliationNote?.startsWith('Receipt ownership'))) ? null : total('actual'),assumedTotal:total('assumed'),
    total:missingMinimumCount || needsReviewCount ? null : Math.round((total('actual')+total('assumed'))*100)/100,missingMinimumCount,needsReviewCount};
}
