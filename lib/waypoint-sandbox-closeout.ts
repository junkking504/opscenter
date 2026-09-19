import {readWaypointTestPricing} from './waypoint-test-pricing';
import {automaticSizePrice} from './closeout-load-price';
import type {CrewCurrentJob} from './crew-dispatch';
import type {CrewPhoneDay} from './crew-phone';
const field = (value: string, label: string, options = [{ value, label }]) => ({ value, label, options });
const hours = Array.from({length:24}, (_,index)=>({value:String(index),label:`${index%12 || 12} ${index>=12?'PM':'AM'}`}));
const minutes = Array.from({length:12}, (_,index)=>({value:String(index*5).padStart(2,'0'),label:String(index*5).padStart(2,'0')}));
const fixture = {
  truck:'Truck 6',truckOptions:[{value:'6',label:'Truck 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),
  driver:{value:'driver',label:'Sample Driver'},drivers:[{value:'driver',label:'Sample Driver'}],navigators:[{value:'navigator',label:'Sample Navigator'}],navigatorOptions:[{value:'',label:'Choose navigator'},{value:'navigator',label:'Sample Navigator'},{value:'extra',label:'Extra Crew'}],
  bedloadQuantity:'',bedloadPrice:'',otherCharges:[],discount:'',tip:'',
  howHeard:field('ref','Referral'),jobCategory:field('house','Household'),actualStartHour:field('10','10 AM',hours),actualStartMinute:field('00','00',minutes),actualEndHour:field('11','11 AM',hours),actualEndMinute:field('00','00',minutes),
  paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],
};

export function sandboxCloseout(job:CrewCurrentJob,day:CrewPhoneDay){
 const pricing=readWaypointTestPricing();
 const size=pricing.loadOptions.find(o=>o.value==='3 (1/2)') || pricing.loadOptions[0];
 const loadPrice=automaticSizePrice(size.value,'0',pricing.loadOptions,pricing.loadPrices,'load',pricing.dryRunFee);
 const options=['Test Driver','Test Navigator','Test Helper'].map((label,index)=>({value:`test-${index}`,label}));
 const driver=options.find(o=>o.label===day.driver)!;
 const navigators=day.navigators.map(name=>options.find(o=>o.label===name)!);
 const closeout={...fixture,loadQuantity:'0',loadSize:{...size,options:pricing.loadOptions},loadPrices:pricing.loadPrices,dryRunFee:pricing.dryRunFee,loadPrice,bedloadSize:{...pricing.bedloadOptions[0],options:pricing.bedloadOptions},bedloadPrices:pricing.bedloadPrices,otherChargeOptions:pricing.otherChargeOptions,balance:loadPrice,total:`$${loadPrice}`,truck:day.truck,truckOptions:[{value:day.truck.replace('Truck ',''),label:day.truck}],driver,drivers:options,navigators,navigatorOptions:options,photoEvidence:{appointmentId:job.appointmentId,urls:[],count:0}};
 return {test:true,dryRun:true,canWrite:true,crewVersion:day.version,crewDefaults:{version:day.version,driver,navigators},jobVersion:`sandbox:${job.assignmentId}:${day.version}`,sourceVersion:`sandbox:${job.assignmentId}:${day.version}:${pricing.version}`,closeout,pendingReceipt:null};
}
