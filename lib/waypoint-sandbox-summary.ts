import {CrewPhoneError,type CrewPhoneDay} from './crew-phone';
import type {CrewCurrentJob} from './crew-dispatch';
import {bonusProgress,type WaypointDaySummary,type WaypointCompleted} from './waypoint-day-summary';
import {closeoutChargesSummary} from './closeout-draft-summary';
import {readWaypointTestPricing} from './waypoint-test-pricing';
export type TestCompletion=WaypointCompleted & {truck:string;crew:string[];completedAt:string};
const roster=['Test Driver','Test Navigator','Test Helper'];
export function testCompletion(job:CrewCurrentJob,day:CrewPhoneDay,values:Record<string,unknown>):TestCompletion {
 const amount=(value:unknown)=>{const text=String(value ?? '');if(!/^\d*(\.\d{1,2})?$/.test(text))throw new CrewPhoneError('Enter a valid test amount.');const n=Number(text);if(!Number.isFinite(n) || n>1_000_000)throw new CrewPhoneError('Enter a valid test amount.');return text;};
 const pricing=readWaypointTestPricing();
 const charges=values.otherChargesToAdd ?? [];if(!Array.isArray(charges) || charges.length>50)throw new CrewPhoneError('Check the test charges.');
 const otherCharges=charges.map((row:Record<string,unknown>)=>{
  const option=pricing.otherChargeOptions.find(o=>o.value===row.typeValue);if(!option)throw new CrewPhoneError('Choose a listed test charge.');
  return {typeValue:option.value,label:option.label,quantity:amount(row.quantity || '1'),price:amount(row.price),total:''};
 });
 const tip=amount(values.tip),discount=amount(values.discount);
 const total=closeoutChargesSummary({loadPrice:amount(values.loadPrice),bedloadPrice:amount(values.bedloadPrice),discount,tip,otherCharges,otherChargeOptions:pricing.otherChargeOptions},[]);
 const revenue=Math.round((total.total-Number(tip))*100)/100;
 if(revenue<0)throw new CrewPhoneError('The discount cannot exceed the test charges.');
 const crewIds=[values.driverId,...(Array.isArray(values.navigatorIds)?values.navigatorIds:[])];
 if(crewIds.some(id=>!/^test-[012]$/.test(String(id))) || new Set(crewIds).size!==crewIds.length)throw new CrewPhoneError('Choose the test crew.');
 const crew=crewIds.map(id=>roster[Number(String(id).slice(-1))]).sort();
 if(![day.driver,...day.navigators].every(name=>crew.includes(name)))throw new CrewPhoneError('Keep today’s crew on the test job.');
 return {id:job.assignmentId,reference:job.jkNumber,customer:job.customerName,address:job.address,time:job.appointmentTime,type:values.appointmentType==='Estimate'?'Estimate':'Job',truck:day.truck,crew,revenue:values.appointmentType==='Estimate'?0:revenue,tips:Number(tip),completedAt:new Date().toISOString()};
}
function share(amount:number,crew:string[],name:string){const cents=Math.round(amount*100),index=crew.indexOf(name);return index<0?0:(Math.floor(cents/crew.length)+(index<cents%crew.length?1:0))/100;}
export function testDaySummary(day:CrewPhoneDay,completions:TestCompletion[],legacyCount:number):WaypointDaySummary {
 const completed=completions.filter(job=>job.truck===day.truck);
 const sum=(key:'revenue'|'tips')=>Math.round(completed.reduce((n,job)=>n+(job[key] || 0),0)*100)/100;
 return {date:day.date,truck:day.truck,test:true,observedAt:new Date().toISOString(),stale:false,message:legacyCount?'Earlier test results have no saved amounts. Reset test assignments for a fresh total.':'Simulated results only · credits split equally among the test crew.',revenue:legacyCount?null:sum('revenue'),tips:legacyCount?null:sum('tips'),completed:legacyCount?null:completed,crew:[day.driver,...day.navigators].map(name=>{
   if(legacyCount)return {name,revenue:null,tips:null,bonus:null,progress:null};
   const revenue=Math.round(completions.reduce((n,job)=>n+share(job.revenue || 0,job.crew,name),0)*100)/100;
   const tips=Math.round(completions.reduce((n,job)=>n+share(job.tips || 0,job.crew,name),0)*100)/100;
   const progress=bonusProgress(revenue);return {name,revenue,tips,bonus:progress.bonus,progress};
 })};
}
