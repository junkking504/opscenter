import { fetchSlackDailyDigest } from '../lib/slack-digest';
import assert from 'node:assert/strict';
import { streamlineOperationalAlerts, requiresAlertAttention } from '../lib/streamlined-operational-alerts';
import { toOperationalAlert, type OperationalAlert } from '../lib/operational-alert-presentation';
import { consolidateConfirmedVisitAlerts } from '../lib/confirmed-visit-alerts';
import { appointmentOnsiteTime } from '../lib/appointment-onsite-time';
import { job,alert,now } from './fixtures/crew-progress';
const day='2026-09-07';
const make=(id:string,label:string,time:string,values:Parameters<typeof alert>[3]={})=>({...alert(id,label,time,values),next:'Recorded'}) as OperationalAlert;
const completed=job({bookedAt:'2026-09-06T18:00:00Z',photos:[{url:'https://example.invalid/photo.jpg',category:'Before',fileName:'photo.jpg'}]});
const sources=[
  make('opening','New Appointment','2026-09-07T05:00:02Z'),
  make('fresh','New Appointment','2026-09-07T14:00:00Z'),
  make('done','Job Completed','2026-09-07T14:08:00Z',{facts:[{label:'Payment',value:'Cash · $450.00'}]}),
  make('duration','Duration','2026-09-07T14:10:00Z',{sourceMessageIds:['arrival','departure'],facts:[{label:'Duration',value:'65 min'}]}),
  make('photos','Photos Uploaded','2026-09-07T14:11:00Z'),
  make('clock-a','Clock In','2026-09-07T13:00:00Z',{title:'Example A',facts:[{label:'Clock in',value:'8:00 AM'}]}),
  make('clock-b','Clock In','2026-09-07T13:02:00Z',{title:'Example B',facts:[{label:'Clock in',value:'8:02 AM'}]}),
];
const result=streamlineOperationalAlerts(sources,[completed],day);
const done=result.find(row=>row.id==='done')!;
assert.equal(result.filter(row=>row.label==='Job Completed').length,1);
assert.deepEqual(done.sourceMessageIds,['done','duration','arrival','departure','photos','appointment-closeout:2026-09-07:101']);
assert.equal(done.photos?.length,1);
assert.equal(done.facts.find(f=>f.label==='Duration')?.value,'65 min');
assert.equal(result.filter(row=>row.label==='Krewe Summary').length,1);
assert.deepEqual(result.find(row=>row.label==='Krewe Summary')?.facts,[{label:'Example A',value:'8:00 AM'},{label:'Example B',value:'8:02 AM'}]);
assert.equal(result.find(row=>row.id==='opening')?.label,'Schedule Summary');
assert.equal(result.find(row=>row.id==='fresh')?.label,'New Appointment');
assert.equal(streamlineOperationalAlerts(sources,[{...completed,bookedAt:''}],day).find(row=>row.id==='opening')?.label,'New Appointment','Unknown booking dates remain visible');
const ambiguous=streamlineOperationalAlerts(sources,[completed,{...completed,appointmentId:'other',appointmentType:'Estimate'}],day);
assert.ok(ambiguous.some(row=>row.id==='duration'),'Ambiguous appointment retains duration');
const multiple=streamlineOperationalAlerts([...sources,make('second-visit','Duration','2026-09-07T14:14:00Z')],[completed],day);
assert.equal(multiple.filter(row=>row.label==='Duration').length,0,'Closed appointment folds every visit');
assert.ok(multiple.find(row=>row.id==='done')?.sourceMessageIds?.includes('second-visit'));
const lifecycle=streamlineOperationalAlerts([make('arrived','Arrival','2026-09-07T13:05:00Z'),make('departed','Departure','2026-09-07T14:10:00Z'),sources[2]],[completed],day);
assert.equal(lifecycle.length,1,'Closed job folds Arrival and Departure');
assert.deepEqual(new Set(lifecycle[0].sourceMessageIds),new Set(['done','arrived','departed','appointment-closeout:2026-09-07:101']));
const openLifecycle=streamlineOperationalAlerts([make('arrived','Arrival','2026-09-07T13:05:00Z'),make('departed','Departure','2026-09-07T14:10:00Z')],[{...completed,status:'Open'}],day);
assert.equal(openLifecycle.length,2,'Open appointment retains visit alerts');
const estimateLifecycle=streamlineOperationalAlerts([make('arrived','Arrival','2026-09-07T13:05:00Z'),make('departed','Departure','2026-09-07T14:10:00Z'),make('estimate-done','Estimate Completed','2026-09-07T14:12:00Z')],[{...completed,status:'Estimate Closed',appointmentType:'Estimate'}],day);
assert.equal(estimateLifecycle.length,1,'Completed estimate folds visit alerts');
const wrongAppointment=streamlineOperationalAlerts([sources[2],make('wrong-id','Departure','2026-09-07T14:10:00Z',{href:'/desktop?workspace=Schedule&appointment=1010'})],[completed],day);
assert.ok(wrongAppointment.some(row=>row.id==='wrong-id'),'Explicit different appointment is never folded');
const actualTruck=streamlineOperationalAlerts([sources[2],make('other-truck','Departure','2026-09-07T14:10:00Z',{truck:'Truck 9',href:'/desktop?workspace=Schedule&appointment=101'})],[completed],day);
assert.ok(actualTruck[0].sourceMessageIds?.includes('other-truck'),'Exact appointment visit survives an assignment change');
const visit={appointment_id:'101',jk_number:'JK1000001',truck_number:2,match_confidence:'confirmed',visit_count:1,visit_intervals:[{arrival:'2026-09-07T13:05:00Z',departure:'2026-09-07T14:10:00Z',departure_confirmed:false}]};
assert.equal(appointmentOnsiteTime(completed,[visit],now).minutes,null,'Unconfirmed exit never becomes final duration');
assert.equal(consolidateConfirmedVisitAlerts([make('d','Departure','2026-09-07T14:10:00Z',{facts:[{label:'Departure',value:'9:10 AM'}]})],[visit],now)[0].label,'Departure');
for(const state of ['acknowledged','resolved']) assert.equal(requiresAlertAttention({needsAction:true,workflowState:state}),false);
assert.equal(requiresAlertAttention({needsAction:false,workflowState:'active'}),false);
assert.equal(requiresAlertAttention({needsAction:false,workflowState:'in-control'}),true);
assert.equal(requiresAlertAttention({needsAction:true,workflowState:'active'}),true);
const recovery=toOperationalAlert({id:'incident',channel:'#data',timestamp:'2026-09-07T14:10:00Z',rawText:':white_check_mark: *Resolved*\n*Incident:* JunkWare stale\n*Recovered:* Sep 7, 2026, 9:10 AM CT',text:'',threadReply:false});
assert.equal(recovery.needsAction,false);assert.equal(recovery.resolved,true);
assert.ok(recovery.facts.some(f=>f.label==='Recovered'));
console.log('Streamlined alerts passed: day baseline, current additions, summaries, completion evidence, ambiguous visits, source aliases and attention counts.');

async function checkRecovery() {
  const root={ts:'1788793200.000001',user:'BOT',text:'*JunkWare unavailable*\n*Source:* JunkWare schedule',reply_count:2};
  const reply={ts:'1788793500.000001',thread_ts:root.ts,user:'BOT',text:':white_check_mark: *Resolved in OpsCenter*'};
  const unrelated={ts:'1788793600.000001',thread_ts:root.ts,user:'OPERATOR',text:'Dispatch confirmed route'};
  const digest=await fetchSlackDailyDigest('2026-09-07',{token:'xoxb-fixture',channelIds:['TEST'],appointments:[],completedRows:[],fetchImpl:async input=>Response.json({ok:true,messages:String(input).includes('conversations.history')?[root]:[root,reply,unrelated]})});
  assert.equal(digest.messages.length,2,'Only the exact same-author recovery is folded into its parent');
  const incident=digest.messages.find(item=>item.id===`TEST:${root.ts}`)!;
  assert.equal(incident.resolved,true);
  assert.ok(incident.sourceMessageIds?.includes(`TEST:${reply.ts}`));
  assert.match(incident.rawText,/JunkWare unavailable[\s\S]*Recovered:/);
}
void checkRecovery().catch(error=>{console.error(error);process.exitCode=1;});

const confirmed={...visit,visit_intervals:[{...visit.visit_intervals[0],departure_confirmed:true}]};
assert.equal(consolidateConfirmedVisitAlerts([make('revised-arrival','Arrival','2026-09-07T13:35:00Z',{facts:[{label:'Arrival',value:'8:35 AM'}]})],[confirmed],now)[0].label,'Duration','Revised arrival inside one confirmed visit merges');
assert.equal(consolidateConfirmedVisitAlerts([make('return-arrival','Arrival','2026-09-07T14:14:00Z',{facts:[{label:'Arrival',value:'9:14 AM'}]})],[confirmed],now)[0].label,'Arrival','A later return stays visible');
const unlabeledPhotos=streamlineOperationalAlerts(sources.map(source=>source.id==='photos'?{...source,truck:undefined}:source),[completed],day);
assert.ok(!unlabeledPhotos.some(source=>source.id==='photos'),'A verified photo with a unique appointment remains linkable without a legacy truck label');

const sourceCloseout=streamlineOperationalAlerts([make('departure-only','Departure','2026-09-07T14:10:00Z')],[completed],day);
assert.equal(sourceCloseout.length,1,'JunkWare closeout folds visits before Slack publication');
assert.equal(sourceCloseout[0].label,'Job Completed');
assert.equal(sourceCloseout[0].source,'JunkWare');
assert.ok(sourceCloseout[0].sourceMessageIds?.includes('departure-only'));
