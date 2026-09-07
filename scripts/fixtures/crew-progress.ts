import { buildCrewProgress } from '../../lib/crew-progress';
import type { DesktopAlert, DesktopCommandSnapshot } from '../../desktop-ui/lib/live-contract';

export const now = Date.parse('2026-09-07T15:15:00Z');
export const job = (values: Partial<Parameters<typeof buildCrewProgress>[0]['appointments'][number]> = {}): Parameters<typeof buildCrewProgress>[0]['appointments'][number] => ({
  appointmentId:'101',sourceEstimateAppointmentId:'',sourceDate:'2026-09-07',jkNumber:'JK1000001',appointmentUrl:'',appointmentTime:'8:00 AM – 9:00 AM',bookedAt:'',appointmentStartMinutes:480,appointmentEndMinutes:540,hasScheduledTime:true,
  customerName:'Example customer',customerEmail:'',customerEmailCollected:false,phone:'',address:'',territory:'New Orleans',appointmentType:'Job',status:'Completed',truck:'Truck 2',driver:'Example driver',navigator:'Example navigator',paymentType:'Cash',paymentAmount:450,tipAmount:0,completedAt:'2026-09-07T14:10:00Z',
  closeout:{loadQuantity:1,loadSize:'Half truck',loadPrice:450,bedloadQuantity:0,bedloadSize:'',bedloadPrice:0,otherCharges:[],discount:0,tip:0,total:450,payments:[{method:'Cash',detail:'',amount:450}],balance:0},photos:[],photoAuditAvailable:true,junkItems:[],appointmentNotes:[],cancellationReason:'',...values,
});
export const alert = (id: string, label: string, stamp: string, values: Partial<DesktopAlert> = {}): DesktopAlert => ({
  id,label,timestamp:stamp,detected:new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}).format(new Date(stamp)),domain:'Schedule',priority:'watch',title:'Truck 2 · JK1000001',truck:'Truck 2',detail:'',owner:'Dispatch',source:'Slack',action:'Open record',context:'Review crew progress.',facts:[],href:'/jobs?date=2026-09-07#job-jk1000001',needsAction:false,workflowState:'active',version:0,...values,
});
export function fixtureSnapshot(): DesktopCommandSnapshot {
  const appointments = [job(),job({appointmentId:'102',jkNumber:'JK1000002',status:'Open',appointmentTime:'11:00 AM – 12:00 PM',appointmentStartMinutes:660,appointmentEndMinutes:720,closeout:null,paymentAmount:0,paymentType:'',completedAt:''}),job({appointmentId:'103',jkNumber:'JK1000003',truck:'Truck 3',status:'Open',territory:'Baton Rouge',appointmentTime:'10:00 AM – 11:00 AM',appointmentStartMinutes:600,appointmentEndMinutes:660,closeout:null,paymentAmount:0,paymentType:'',completedAt:''})];
  const visits = [{appointment_id:'101',truck_number:2,match_confidence:'confirmed',first_arrival:'2026-09-07T13:05:00Z',final_departure:'2026-09-07T14:10:00Z'}, {appointment_id:'103',truck_number:3,match_confidence:'confirmed',first_arrival:'2026-09-07T15:05:00Z'}];
  const alerts = [
    alert('arrival-one','Arrival','2026-09-07T13:05:00Z',{facts:[{label:'Arrival',value:'8:05 AM'}]}),
    alert('closed-one','Job Closed','2026-09-07T14:08:00Z',{facts:[{label:'Job total',value:'$450.00'},{label:'Payment',value:'Cash · $450.00'},{label:'Photos',value:'No uploads found'},{label:'On-site time',value:'65 min'}]}),
    alert('departure-one','Departure','2026-09-07T14:10:00Z',{facts:[{label:'Departure',value:'9:10 AM'}]}),
    alert('new-two','New Appointment','2026-09-07T14:30:00Z',{title:'JK1000002 · 11:00 AM – 12:00 PM',facts:[{label:'Time',value:'11:00 AM – 12:00 PM'}],href:'/jobs?date=2026-09-07#job-jk1000002'}),
    alert('arrival-three','Arrival','2026-09-07T15:05:00Z',{title:'Truck 3 · JK1000003',truck:'Truck 3',facts:[{label:'Arrival',value:'10:05 AM'}],href:'/jobs?date=2026-09-07#job-jk1000003'}),
    alert('clock-in','Clock In','2026-09-07T12:30:00Z',{title:'Example driver',truck:undefined,domain:'Krewe',facts:[{label:'Time',value:'7:30 AM'}]}),
  ].reverse();
  return {date:'2026-09-07',generatedAt:new Date(now).toISOString(),actor:{displayName:'Preview operator',role:'manager'},kpis:[],sources:{alerts:true,metrics:true,workflow:true},alerts,
    crewProgress:buildCrewProgress({date:'2026-09-07',appointments,visits,alerts,scheduleCurrent:true,visitsCurrent:true,updatesComplete:true,now})};
}
