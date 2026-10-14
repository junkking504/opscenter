import {readDesktopSchedule,scheduleRoutePairs,readDesktopClosestTrucks} from './desktop-schedule';
import {scheduleMapLocation} from '../desktop-ui/lib/schedule-contract';
import {appointmentCostRoute,appointmentCostOnsite,closestCostTruck} from './appointment-cost-route';
import {truckNumber,sameTruck} from './junkware-trucks';
import {osmTravelMatrix} from './osm-travel-matrix';
import fs from 'node:fs';
import path from 'node:path';
import {parseCsv} from './wex-fuel';
import {normalizePayrollEmployeeKey as employeeKey} from './payroll-corrections';
import {readScheduleCrewRoster} from './schedule-crew-roster';
import {appliedPayrollCorrectionForEmployee} from './applied-payroll-corrections';
import {readAppointmentCost,AppointmentCostError} from './appointment-cost-store';
import {readWexRealtimePrice,readWexFleetPlanningPrice} from './wex-realtime-prices';
import {planningCrewHourly,planningOnsiteMinutes,appointmentCostLabor,calculateAppointmentCost,allocateAppointmentTravel,defaultCostWarehouse,type CostTravel,type AppointmentCostSummary} from './appointment-cost-model';
import {chicagoDateKey,addDays} from './report-dates';
import {chicagoClockToDate} from './live-pay';
import {readTruckGpsRoute} from './desktop-gps-route';
import {costOnsiteMinutes,recordedCostTransfer} from './appointment-cost-recorded';
import type {TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';
import type {Coordinates} from './job-route-proximity';
export async function readAppointmentCostEstimate(date:string,id:string,snapshot=readDesktopSchedule(date),gpsRoutes=new Map<string,TruckGpsRoute>()){
 const costJobs=appointmentCostRoute(snapshot.appointments);
 const job=costJobs.find(row=>row.recordId===id);
 if(!job)throw new AppointmentCostError('Appointment is absent from the selected day.',404);
 const sourceRoot=process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data');
 const sourceOnsiteMinutes=costOnsiteMinutes(appointmentCostOnsite(job),job.truck);
 const key=`${date}:${job.appointmentId||job.recordId}`;
 const canceled=/cancel/i.test(job.status);
 const provisionalRoute=!truckNumber(job.truck)||job.junkwareSyncStatus==='pending';
 const proximity=!canceled&&provisionalRoute&&snapshot.fleet.isToday?await readDesktopClosestTrucks(date,id,snapshot).catch(()=>null):null;
 const closest=proximity?closestCostTruck(proximity.closest,snapshot.fleet.trucks):null;
 const costTruck=closest?.truck||job.truck;
 const routeAssumptions:string[]=!canceled&&provisionalRoute?[closest?`Provisional closest-truck round trip from ${closest.truck}'s last reported location (GPS ${closest.gpsUpdatedAt||'time unavailable'}). Selected by road travel time; return to that location is assumed. No dispatch assignment is made.`:'Closest truck unavailable for this day or location; provisional local warehouse round trip.']:[];
 const routeJobs=provisionalRoute?[]:costJobs.filter(row=>sameTruck(row.truck,job.truck)&&!/cancel/i.test(row.status));
 const pairs=scheduleRoutePairs(routeJobs);
 const before=pairs.find(row=>row.toAppointmentId===id),after=pairs.find(row=>row.fromAppointmentId===id);
 const previous=routeJobs.find(row=>row.recordId===before?.fromAppointmentId),next=routeJobs.find(row=>row.recordId===after?.toAppointmentId);
 const first=routeJobs.find(row=>!pairs.some(pair=>pair.toAppointmentId===row.recordId));
 const record=readAppointmentCost(key,defaultCostWarehouse(first?.territory||job.territory));
 const hq=record.inputs.warehouse==='BRHQ'?{latitude:30.4191544,longitude:-91.1449730}:{latitude:29.9863006,longitude:-90.0586452};
 const travel:CostTravel={miles:null,minutes:null,inbound:closest?`${closest.truck} GPS location`:previous?.jkNumber||record.inputs.warehouse,outbound:closest?`${closest.truck} GPS location`:next?.jkNumber||record.inputs.warehouse,note:provisionalRoute?routeAssumptions[0]||'No planned attendance.':'Half of each shared job-to-job leg; full warehouse legs. Planned road miles, without traffic or dump detours. Warehouse is a planning assumption.',approximate:!job.location||Boolean(previous&&!previous.location)||Boolean(next&&!next.location)};
 const point=scheduleMapLocation(job),origin=closest?.position||(previous?scheduleMapLocation(previous):hq),destination=closest?.position||(next?scheduleMapLocation(next):hq);
 if(!canceled&&point&&origin&&destination){
  const leg=async(a:Coordinates,b:Coordinates)=>{const result=await osmTravelMatrix([a],[b]);const row=result?.[0];const seconds=typeof row?.duration==='string'&&/^\d+(?:\.\d+)?s$/.test(row.duration)?Number(row.duration.slice(0,-1)):NaN;return row?.condition==='ROUTE_EXISTS'&&!row.status?.code&&typeof row.distanceMeters==='number'&&row.distanceMeters>=0&&Number.isFinite(row.distanceMeters)&&Number.isFinite(seconds)&&seconds>=0?{miles:row.distanceMeters/1609.344,minutes:seconds/60}:null;};
  const [incoming,outgoing]=await Promise.all([leg(origin,point),leg(point,destination)]);
  if(incoming&&outgoing){
   const truck=`Truck ${truckNumber(job.truck)}`;
   if(!provisionalRoute&&!gpsRoutes.has(truck))gpsRoutes.set(truck,readTruckGpsRoute(date,truck,sourceRoot));
   const gps=gpsRoutes.get(truck)!;
   const inboundRecorded=previous?recordedCostTransfer(appointmentCostOnsite(previous),appointmentCostOnsite(job),truck,gps,snapshot.operationalStops||[]):null;
   const outboundRecorded=next?recordedCostTransfer(appointmentCostOnsite(job),appointmentCostOnsite(next),truck,gps,snapshot.operationalStops||[]):null;
   if(inboundRecorded!==null)incoming.minutes=inboundRecorded;
   if(outboundRecorded!==null)outgoing.minutes=outboundRecorded;
   travel.note+=` Travel time: inbound ${inboundRecorded===null?'road estimate':'recorded transfer'}, outbound ${outboundRecorded===null?'road estimate':'recorded transfer'}. Recorded transfers include elapsed time between confirmed stops.`;
   Object.assign(travel,allocateAppointmentTravel(incoming,outgoing,Boolean(previous),Boolean(next)));}
 }else travel.note=canceled?'Canceled appointment: no planned attendance.':'Route pin unavailable; enter a service address before estimating travel.';
 const meaningful=(name:string)=>name&&name!=='—'&&!/unassigned|unknown|not recorded|multiple/i.test(name);
 const explicitNames=[job.driver,job.navigator,...(job.additionalCrew||[])].filter(meaningful);
 const fleetCrew=snapshot.fleet.isToday?snapshot.fleet.trucks.find(row=>sameTruck(row.truck,costTruck)):null;
 const fleetNames=fleetCrew?[fleetCrew.driver,fleetCrew.navigator].filter(meaningful):[];
 const conflict=fleetNames.some(name=>snapshot.fleet.trucks.some(row=>!sameTruck(row.truck,costTruck)&&[row.driver,row.navigator].some(other=>employeeKey(other)===employeeKey(name))));
 const planned=readScheduleCrewRoster(date).entries.filter(row=>row.status==='scheduled'&&sameTruck(row.truck,costTruck)).map(row=>row.name);
 const names=[...new Map((explicitNames.length?explicitNames:planned.length?planned:conflict?[]:fleetNames).map(name=>[employeeKey(name),name])).values()];
 const crewSource=explicitNames.length?'Appointment crew':planned.length?'Dated planned roster':conflict?'Conflicting truck crew assignments':closest?'Closest truck crew snapshot':'Assigned truck crew snapshot';

 const crewRates=names.map(name=>{const last=date>chicagoDateKey()?chicagoDateKey():date;for(let days=0;days<14;days++){const day=addDays(last,-days);const correction=appliedPayrollCorrectionForEmployee(day,name);if(correction?.hourlyRate&&correction.hourlyRate>0)return {rate:correction.hourlyRate,date:day};try{const [headers,...rows]=parseCsv(fs.readFileSync(path.join(sourceRoot,'history','junkware',`junkware_employee_rates_${day}.csv`),'utf8'));const found=rows.map(row=>Object.fromEntries(headers.map((h,i)=>[h,row[i]]))).filter(row=>employeeKey(row.normalized_name||row.employee_name||row.name||'')===employeeKey(name));if(found.length===1){const rate=Number(found[0].hourly_rate);const observed=found[0].collected_at;const sourceDate=observed&&Number.isFinite(Date.parse(observed))?chicagoDateKey(new Date(observed)):day;if(rate>0&&Number.isFinite(rate)&&sourceDate>=addDays(last,-14)&&sourceDate<=last)return {rate,date:sourceDate};}}catch{/* Missing dated rate is not zero pay. */}}return null;});
 const sourceCrewHourly=names.length>0&&crewRates.every(Boolean)?crewRates.reduce((sum,row)=>sum+row!.rate,0):null;
 const reference=date<chicagoDateKey()?chicagoClockToDate(addDays(date,1),'12:00 AM')!.getTime()-1:Date.now();
 const truckFuel=readWexRealtimePrice(costTruck,new Date(reference));
 const recentTruckPrice=truckFuel.price!==null&&reference-Date.parse(truckFuel.price.at)<=7*86400000;
 const fleetFuel=!canceled&&!recentTruckPrice&&record.inputs.fuelPrice===null?readWexFleetPlanningPrice(new Date(reference)):null;
 const fuel=fleetFuel?.price?fleetFuel:truckFuel;
 const fuelAssumptions=fleetFuel?.price?[`Provisional fuel price from the latest fleet WEX alert (${fleetFuel.price.truck}); not this appointment's assigned truck.`]:[];
 const priceIsRecent=fuel.price!==null&&reference-Date.parse(fuel.price.at)<=7*86400000;
 const fuelPrice=record.inputs.fuelPrice??(priceIsRecent?fuel.price!.price:null);
 const labor=appointmentCostLabor(record.inputs,sourceCrewHourly,sourceOnsiteMinutes,canceled);
 const crewHourly=labor.crewHourly;
 const attendanceAssumptions=[...routeAssumptions,...fuelAssumptions,...labor.attendanceAssumptions];
 const breakEvenAssumptions=[...routeAssumptions,...fuelAssumptions,...labor.breakEvenAssumptions];
 return {key,record,costTruck,sourceOnsiteMinutes,planningCrewHourly:canceled?null:planningCrewHourly,planningOnsiteMinutes:canceled?null:planningOnsiteMinutes,attendanceAssumptions,breakEvenAssumptions,travel,fuel,priceIsRecent,sourceCrewHourly,crewSource,crewCount:names.length,crewRateDates:[...new Set(crewRates.filter(Boolean).map(row=>row!.date))],fuelPrice,crewHourly,result:calculateAppointmentCost({...record.inputs,onsiteMinutes:labor.onsiteMinutes},travel,fuelPrice,crewHourly),observedAt:snapshot.observedAt};
}

// One source snapshot per board request; bound simultaneous road lookups.
export async function readAppointmentAttendanceCosts(date:string){
 const snapshot=readDesktopSchedule(date);
 const rows:Record<string,AppointmentCostSummary>={};
 const gpsRoutes=new Map<string,TruckGpsRoute>();
 let cursor=0;
 async function worker(){
  while(cursor<snapshot.appointments.length){
   const job=snapshot.appointments[cursor++];
   try{const estimate=await readAppointmentCostEstimate(date,job.recordId,snapshot,gpsRoutes);const {attendance,breakEven,breakEvenBeforeDisposal,missing}=estimate.result;rows[job.recordId]={attendance,breakEven,breakEvenBeforeDisposal,missing,attendanceAssumptions:estimate.attendanceAssumptions,breakEvenAssumptions:estimate.breakEvenAssumptions};}
   catch{rows[job.recordId]={attendance:null,breakEven:null,breakEvenBeforeDisposal:null,missing:['Cost sources unavailable']};}
  }
 }
 await Promise.all([worker(),worker()]);
 return {date,rows};
}
