import type { AppointmentOnsiteTime } from './appointment-onsite-time';

type Option = {value:string;label:string};
type TimeField = {value:string;options:Option[]};
export type CloseoutTimeKey = 'actualStartHour' | 'actualStartMinute' | 'actualEndHour' | 'actualEndMinute';
type Times = Record<CloseoutTimeKey, TimeField>;
const truckKey = (value:string) => value.match(/\d+/)?.[0]?.replace(/^0+/, '') || '';

/** Only confirmed visit timestamps for this assigned truck and operating day are suggestions. */
export function closeoutGpsTimes(time: AppointmentOnsiteTime | undefined, visitTruck:string, selectedTruck:string, date:string, fields:Times): Partial<Record<CloseoutTimeKey,string>> {
  if (!time || !truckKey(visitTruck) || truckKey(visitTruck)!==truckKey(selectedTruck)) return {};
  const result:Partial<Record<CloseoutTimeKey,string>>={};
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  for (const [stamp,hourKey,minuteKey] of [[time.arrival,'actualStartHour','actualStartMinute'],[time.departure,'actualEndHour','actualEndMinute']] as const) {
    if (!stamp || !Number.isFinite(Date.parse(stamp)) || Date.parse(stamp)>Date.now()) continue;
    if (hourKey==='actualEndHour' && (!time.arrival || !Number.isFinite(Date.parse(time.arrival)) || Date.parse(stamp)<=Date.parse(time.arrival))) continue;
    const parts=Object.fromEntries(formatter.formatToParts(new Date(stamp)).map(part=>[part.type,part.value]));
    if (`${parts.year}-${parts.month}-${parts.day}`!==date) continue;
    const minutes=Number(parts.hour)*60+Number(parts.minute);
    const choices=fields[hourKey].options.filter(option=>option.value!=='' && /^\d+$/.test(option.value)).flatMap(hour=>fields[minuteKey].options.filter(option=>option.value!=='' && /^\d+$/.test(option.value)).map(minute=>({hour:hour.value,minute:minute.value,distance:Math.abs(Number(hour.value)*60+Number(minute.value)-minutes)})));
    choices.sort((a,b)=>a.distance-b.distance);
    if (choices[0] && choices[0].distance<=5) { result[hourKey]=choices[0].hour;result[minuteKey]=choices[0].minute; }
  }
  return result;
}

const cents=(value:string) => Math.round(Number(value.replace(/[$,\s]/g,''))*100);
type Charge={label:string;quantity:string;price:string;total:string;typeValue?:string};
export function closeoutChargesSummary(draft:{loadPrice:string;bedloadPrice:string;discount:string;tip:string;otherCharges:Charge[];otherChargeOptions:Option[]},pending:Charge[]) {
  let subtotal=cents(draft.loadPrice)+cents(draft.bedloadPrice);
  let percentage=0;
  for (const charge of [...draft.otherCharges,...pending]) {
    const type=charge.typeValue || draft.otherChargeOptions.find(option=>option.label.trim().toLowerCase()===charge.label.trim().toLowerCase())?.value || '';
    if(type.split('|')[2]==='1') percentage+=Number(type.split('|')[1])*Number(charge.quantity || '1');
    else subtotal+=charge.total ? cents(charge.total) : Math.round(cents(charge.price)*Number(charge.quantity || '1'));
  }
  const discount=cents(draft.discount),tip=cents(draft.tip);
  subtotal+=Math.round(Math.max(0,subtotal-discount)*percentage/100);
  return {subtotal:subtotal/100,total:(subtotal-discount+tip)/100,estimated:percentage!==0};
}
