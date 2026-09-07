import {calculateLivePay} from './live-pay';
import {calculateWeeklyOvertime} from './overtime';
import type {CrewAmounts} from '../desktop-ui/lib/people-fleet-contract';
import type {HoursWeek} from '../desktop-ui/lib/krewe-hours-contract';

const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function correctedCrewPay(input: {
  date:string; clockIn:string; clockOut:string; hourlyRate:number|null;
  corrected:boolean; isSalary:boolean; amounts:CrewAmounts; week?:HoursWeek;
  sourcePriorHours:number|null;
}): {amounts:CrewAmounts; issue:string; recalculated:boolean} {
  const priorDays = input.week?.days.filter(day=>day.date<input.date);
  const earlierCorrection = Boolean(priorDays?.some(day=>day.corrected));
  if (!input.corrected && !earlierCorrection) return {amounts:input.amounts,issue:'',recalculated:false};
  const amounts = {...input.amounts};
  if (input.corrected) {
    const shift=calculateLivePay({date:input.date,clockIn:input.clockIn,clockOut:input.clockOut,hourlyRate:input.hourlyRate});
    amounts.hours=shift.workedHours;
  }
  // Salaried earnings are not converted into an hourly wage by a clock edit.
  if (input.isSalary) return {amounts,issue:'',recalculated:false};
  const complete = priorDays?.every(day=>day.status==='Recorded' && day.hours!==null);
  const prior = complete ? priorDays!.reduce((sum,day)=>sum+(day.isSalary?0:day.hours!),0)
    : !earlierCorrection ? input.sourcePriorHours : null;
  const unavailable = (issue:string) => ({amounts:{...amounts,regularHours:null,overtimeHours:null,labor:null,totalPay:null},issue,recalculated:false});
  if (prior===null || !Number.isFinite(prior) || prior<0) return unavailable('Correction saved; earlier weekly hours are unavailable.');
  if (amounts.hours===null || !input.hourlyRate || input.hourlyRate<=0) return unavailable('Correction saved; shift hours or hourly rate require review.');
  const [,pay]=calculateWeeklyOvertime([{hours:prior,hourlyRate:input.hourlyRate},{hours:amounts.hours,hourlyRate:input.hourlyRate}]);
  amounts.regularHours=round(pay.regularHours);
  amounts.overtimeHours=round(pay.overtimeHours);
  amounts.labor=round(pay.hourlyLaborCost);
  const components=[amounts.tips,amounts.bonuses,amounts.supplemental];
  amounts.totalPay=components.every(value=>value!==null) ? round(amounts.labor+components.reduce<number>((sum,value)=>sum+value!,0)) : null;
  return {amounts,issue:amounts.totalPay===null?'Corrected hourly pay calculated; tips, bonuses, or supplemental pay need verification.':'',recalculated:true};
}

/** JunkWare rounds displayed regular/OT hours before extending wages. Use its
 * verified shift result when available, rather than a slightly different local
 * extension. Tips/bonuses remain their own source components. */
export function verifiedJunkwareShiftPay(input:{amounts:CrewAmounts;isSalary:boolean;date:string;clockIn:string;clockOut:string;hourlyRate:number|null;latestCorrectionAt:number;sync:{status:string;verifiedAt?:string;after?:{workDate:string;clockIn:string;clockOut:string;hourlyRate:number;hours:number|null;regularHours:number|null;overtimeHours:number|null;labor:number|null}}|null}) {
  const source=input.sync?.after;
  if(input.isSalary||input.sync?.status!=='verified'||!input.sync.verifiedAt||Date.parse(input.sync.verifiedAt)<input.latestCorrectionAt||!source||source.workDate!==input.date||source.clockIn!==input.clockIn||source.clockOut!==input.clockOut||source.hourlyRate!==input.hourlyRate||!source.clockOut||source.labor===null||!Number.isFinite(source.labor))return null;
  const amounts={...input.amounts,hours:source.hours,regularHours:source.regularHours,overtimeHours:source.overtimeHours,labor:source.labor};
  const components=[amounts.tips,amounts.bonuses,amounts.supplemental];
  amounts.totalPay=components.every(value=>value!==null)?round(source.labor+components.reduce<number>((sum,value)=>sum+value!,0)):null;
  return {amounts,issue:amounts.totalPay===null?'JunkWare hourly pay verified; tips, bonuses, or supplemental pay need verification.':'',recalculated:false};
}
