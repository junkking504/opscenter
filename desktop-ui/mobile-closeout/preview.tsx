import { createRoot } from 'react-dom/client';
import MobileCloseoutPreview from './mobile-closeout';
import type { ScheduleAppointment } from '../lib/schedule-contract';

const field = (value: string, label: string, options = [{ value, label }]) => ({ value, label, options });
const sizes = ['', 'Dry Run', 'Bag(s)', 'Minimum', '.5 (1/12)', '1 (1/6)', '1.5 (1/4)', '2 (1/3)', '2.5 (3/8)', '3 (1/2)', '3.5 (5/8)', '4 (2/3)', '4.5 (3/4)', '5 (5/6)', '5.5 (7/8)'];
const hours = Array.from({length:24}, (_,index)=>({value:String(index),label:`${index%12 || 12} ${index>=12?'PM':'AM'}`}));
const minutes = Array.from({length:12}, (_,index)=>({value:String(index*5).padStart(2,'0'),label:String(index*5).padStart(2,'0')}));
const fixture = {
  truck:'Truck 6',truckOptions:[{value:'6',label:'Truck 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),
  driver:{value:'driver',label:'Sample Driver'},drivers:[{value:'driver',label:'Sample Driver'}],navigators:[{value:'navigator',label:'Sample Navigator'}],navigatorOptions:[{value:'',label:'Choose navigator'},{value:'navigator',label:'Sample Navigator'}],
  loadQuantity:'0',loadSize:field('3 (1/2)','3 (1/2)',sizes.map(value=>({value,label:value}))),loadPrices:[40,100,150,200,250,300,350,400,450,500,550,600,650,700],dryRunFee:'75',loadPrice:'400',
  bedloadQuantity:'',bedloadSize:field('','None'),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[{value:'',label:'Choose charge'}],otherCharges:[],discount:'',tip:'',
  howHeard:field('ref','Referral'),jobCategory:field('house','Household'),actualStartHour:field('10','10 AM',hours),actualStartMinute:field('00','00',minutes),actualEndHour:field('11','11 AM',hours),actualEndMinute:field('00','00',minutes),
  paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'400.00',total:'$400.00',
};
const jobs: ScheduleAppointment[] = ['Sample Customer A','Sample Customer B','Sample Customer C'].map((customerName,index)=>({
  recordId:`sample-${index}`,version:'sample',callAhead:'not_called',appointmentId:String(900001+index),jkNumber:`SAMPLE-0${index+1}`,appointmentUrl:'',appointmentTime:['8–10 AM','10 AM–12 PM','1–3 PM'][index],appointmentStartMinutes:480+index*120,appointmentEndMinutes:600+index*120,hasScheduledTime:true,customerName,customerEmail:'',phone:'',address:['100 Sample Lane','200 Example Avenue','300 Demo Court'][index],territory:'Sample territory',appointmentType:'Job',status:index===0?'Completed':'Confirmed',truck:'Truck 6',driver:'Sample Driver',navigator:'Sample Navigator',paymentType:'',paymentAmount:0,tipAmount:0,junkItems:[['Sofa','Mattress'],['Garage cleanout'],['Furniture removal']][index],appointmentNotes:['Sample instructions: use the side entrance. Customer will identify the items to remove.'],cancellationReason:'',location:null,
}));

// Self-contained review artifact. Never forward any request to a real endpoint.
window.fetch = async (input, init) => {
  const url = String(input);
  if (url.startsWith('/api/desktop/schedule/closeout?')) {
    const completed = url.includes('900001');
    return Response.json({closeout:{...fixture,status:completed?field('8','Completed'):fixture.status},sourceVersion:'a'.repeat(64),canWrite:true});
  }
  if (url==='/api/desktop/schedule/operations' && init?.method==='POST') {
    const request = JSON.parse(String(init.body));
    return Response.json({receipt:{requestId:request.requestId,action:request.action,status:'failed',message:'Preview only. No appointment or payment was sent to JunkWare.'}});
  }
  return Response.json({error:'This design preview does not connect to live services.'},{status:400});
};
createRoot(document.getElementById('root')!).render(<MobileCloseoutPreview jobs={jobs} date="2026-09-17"/>);
