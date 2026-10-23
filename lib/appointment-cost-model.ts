export type CostInputs = {
 mpg:number; overhead:number; crewHourly:number|null; onsiteMinutes:number|null;
 disposal:number|null; extraCosts:number; revenueFeePercent:number; marginPercent:number;
 fuelPrice:number|null; warehouse:'NOHQ'|'BRHQ';
};
export const defaultCostInputs:CostInputs={mpg:10,overhead:109,crewHourly:null,onsiteMinutes:null,disposal:null,extraCosts:0,revenueFeePercent:0,marginPercent:0,fuelPrice:null,warehouse:'NOHQ'};
export type CostTravel={miles:number|null;minutes:number|null;inbound:string;outbound:string;note:string;approximate:boolean};
export type FuelPriceEvidence={price:number;at:string;source:string;sourceUrl:string;trackingNumber:string;truck:string|null;amount:number;gallons:number};
export type CostRecord={version:number;inputs:CostInputs;actor:string|null;savedAt:string|null};
export function validCostInputs(value:unknown):value is CostInputs {
 if(!value||typeof value!=='object')return false;
 const v=value as CostInputs;
 const numeric=(n:unknown,min:number,max:number,nullable=false)=>nullable&&n===null||typeof n==='number'&&Number.isFinite(n)&&n>=min&&n<=max;
 return numeric(v.mpg,1,100)&&numeric(v.overhead,0,100000)&&numeric(v.crewHourly,0.01,10000,true)&&numeric(v.onsiteMinutes,0,10080,true)&&numeric(v.disposal,0,100000,true)&&numeric(v.extraCosts,0,100000)&&numeric(v.revenueFeePercent,0,99)&&numeric(v.marginPercent,0,99)&&v.marginPercent+v.revenueFeePercent<100&&numeric(v.fuelPrice,0.01,100,true)&&['NOHQ','BRHQ'].includes(v.warehouse);
}
const nonnegative=(v:number|null):v is number=>v!==null&&Number.isFinite(v)&&v>=0;
export function calculateAppointmentCost(inputs:CostInputs,travel:CostTravel,fuelPrice:number|null,crewHourly:number|null){
 const missing:string[]=[];
 if(!validCostInputs(inputs))return {fuel:null,travelLabor:null,onsiteLabor:null,attendance:null,total:null,breakEven:null,breakEvenBeforeDisposal:null,minimumCharge:null,targetCharge:null,missing:['Valid cost assumptions']};
 const fuel=nonnegative(travel.miles)&&fuelPrice!==null&&fuelPrice>0&&Number.isFinite(fuelPrice)?travel.miles/inputs.mpg*fuelPrice:null;
 const rate=crewHourly!==null&&crewHourly>0&&Number.isFinite(crewHourly)?crewHourly:null;
 const travelLabor=nonnegative(travel.minutes)&&rate!==null?travel.minutes/60*rate:null;
 const onsiteLabor=inputs.onsiteMinutes!==null&&rate!==null?inputs.onsiteMinutes/60*rate:null;
 if(!nonnegative(travel.miles))missing.push('Route miles');
 if(fuelPrice===null||!Number.isFinite(fuelPrice)||fuelPrice<=0)missing.push('Current fuel price');
 if(!nonnegative(travel.minutes))missing.push('Travel time');
 if(rate===null)missing.push('Crew hourly cost');
 if(onsiteLabor===null)missing.push('On-site labor minutes');
 if(inputs.disposal===null)missing.push('Disposal cost (enter 0 if none)');
 const attendance=fuel!==null&&travelLabor!==null?fuel+travelLabor+inputs.overhead:null;
 const total=attendance!==null&&onsiteLabor!==null&&inputs.disposal!==null?attendance+onsiteLabor+inputs.disposal+inputs.extraCosts:null;
 const breakEvenBeforeDisposal=attendance!==null&&onsiteLabor!==null?(attendance+onsiteLabor+inputs.extraCosts)/(1-inputs.revenueFeePercent/100):null;
 const breakEven=total!==null?total/(1-inputs.revenueFeePercent/100):null;
 // Small tolerance prevents floating-point noise from adding an extra dollar.
 const minimumCharge=breakEven!==null?Math.floor(breakEven+1e-8)+1:null;
 const targetCharge=total!==null&&minimumCharge!==null?Math.max(minimumCharge,Math.ceil(total/(1-(inputs.revenueFeePercent+inputs.marginPercent)/100)-1e-8)):null;
 return {fuel,travelLabor,onsiteLabor,attendance,total,breakEven,breakEvenBeforeDisposal,minimumCharge,targetCharge,missing};
}

export function allocateAppointmentTravel(incoming:{miles:number;minutes:number},outgoing:{miles:number;minutes:number},hasPrevious:boolean,hasNext:boolean){
 const inboundShare=hasPrevious?0.5:1,outboundShare=hasNext?0.5:1;
 return {miles:incoming.miles*inboundShare+outgoing.miles*outboundShare,minutes:incoming.minutes*inboundShare+outgoing.minutes*outboundShare};
}

export const defaultCostWarehouse=(territory:string):CostInputs['warehouse']=>/^(BR|Baton Rouge)$/i.test(territory)?'BRHQ':'NOHQ';

export type AppointmentCostSummary={attendance:number|null;breakEven:number|null;breakEvenBeforeDisposal:number|null;missing:string[];unavailableReason?:string;attendanceAssumptions?:string[];breakEvenAssumptions?:string[]};

// Provisional planning defaults, replaced automatically by source values or saved overrides.
export const planningCrewHourly=40;
export const planningOnsiteMinutes=30;
export function appointmentCostLabor(inputs:CostInputs,sourceCrew:number|null,sourceMinutes:number|null,canceled=false){
 const crewHourly=inputs.crewHourly??sourceCrew??(canceled?null:planningCrewHourly);
 const onsiteMinutes=inputs.onsiteMinutes??sourceMinutes??(canceled?null:planningOnsiteMinutes);
 const attendanceAssumptions=inputs.crewHourly===null&&sourceCrew===null&&!canceled?['Provisional two-person crew: $40/hour combined ($20 each).']:[];
 const breakEvenAssumptions=[...attendanceAssumptions,...(inputs.onsiteMinutes===null&&sourceMinutes===null&&!canceled?['Provisional on-site work: 30 minutes.']:[])];
 return {crewHourly,onsiteMinutes,attendanceAssumptions,breakEvenAssumptions};
}
