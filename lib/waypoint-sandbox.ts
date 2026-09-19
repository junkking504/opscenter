import {testCompletion,testDaySummary,type TestCompletion} from './waypoint-sandbox-summary';
import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CrewPhoneError,type CrewPhone,type CrewPhoneDay} from './crew-phone';
import {chicagoDateKey} from './chicago-date';
import {JUNKWARE_DISPATCH_TRUCKS} from './junkware-trucks';
import {validateTruckInspection,type TruckInspectionReport} from './truck-inspection';
import type {CrewCurrentJob} from './crew-dispatch';
import {sandboxCloseout} from './waypoint-sandbox-closeout';

const roster=['Test Driver','Test Navigator','Test Helper'];
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
type Receipt={requestId:string;assignmentId:string;action:string;status:'verified';dryRun:true;message:string};
type State={schema:1;day:CrewPhoneDay|null;reports:TruckInspectionReport[];completed:string[];receipts:Receipt[];switches:Array<{requestId:string;from:string;to:string;status:'complete';message:string;total:number;moved:number}>;generation:number;completions?:TestCompletion[]};
function location(phone:CrewPhone) {
  if(phone.test!==true || !uuid.test(phone.deviceId))throw new CrewPhoneError('A test phone is required.',403);
  const root=process.env.OPS_CREW_PHONE_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'crew-phones');
  return path.join(root,'sandbox',phone.deviceId,chicagoDateKey());
}
function read(phone:CrewPhone):State {
  try{return JSON.parse(fs.readFileSync(path.join(location(phone),'state.json'),'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {schema:1,day:null,reports:[],completed:[],receipts:[],switches:[],generation:0};}
}
function report(state:State,truck=state.day?.truck){return state.reports.filter(r=>r.truck===truck).at(-1) || null;}
function inspection(state:State,truck=state.day?.truck){const r=report(state,truck);return r?{status:r.status==='stop'?'blocked':'ready',truck:r.truck,requestId:r.requestId,receivedAt:r.receivedAt}:{status:'required'};}
function requireDay(state:State){if(!state.day)throw new CrewPhoneError('Set up your test truck first.',409);return state.day;}
function requireReady(state:State){requireDay(state);if(inspection(state).status!=='ready')throw new CrewPhoneError('Complete the test truck inspection before opening assignments.',409);}
function jobs(phone:CrewPhone,state:State):CrewCurrentJob[]{
  const examples=[['Sofa pickup','101 Practice Lane · Fictional address','8–10 AM',['Sofa','Armchair'],'Ground floor. Practice a small pickup and cash payment.'],['Garage cleanout','202 Demo Drive · Fictional address','10 AM–12 PM',['Boxes','Shelving','Old furniture'],'Practice a larger load, extra crew and before/after photos.'],['Appliance pickup','303 Sample Court · Fictional address','1–3 PM',['Washer','Dryer'],'Appliances are disconnected. Practice charges and a collected card payment.']] as const;
  return examples.map((row,index)=>{const hash=createHash('sha256').update(`${phone.deviceId}:${chicagoDateKey()}:${state.generation}:${index}`).digest('hex');return {assignmentId:`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`,appointmentId:`TEST-${index+1}`,date:chicagoDateKey(),jkNumber:`TEST-00${index+1}`,customerName:`Test ${index+1} · ${row[0]}`,address:row[1],appointmentTime:row[2],junkItems:[...row[3]],appointmentNotes:['Fictional test appointment. Do not travel to this address.',row[4]],driver:state.day?.driver || roster[0],navigator:state.day?.navigators.join(', ') || ''};});
}
function current(phone:CrewPhone,state:State){return jobs(phone,state).find(j=>!state.completed.includes(j.assignmentId)) || null;}
function assigned(phone:CrewPhone,state:State,id:unknown){requireReady(state);const job=current(phone,state);if(!job || job.assignmentId!==id)throw new CrewPhoneError('Use your current test assignment.',409);return job;}
function device(phone:CrewPhone,state:State){const day=requireDay(state);return {deviceId:`test-${phone.deviceId}-${day.truck.replace(/ /g,'-')}`,truck:day.truck,label:'Waypoint test phone',createdAt:day.savedAt,expiresAt:phone.expiresAt};}
function fingerprint(state:State,to:string){return createHash('sha256').update(JSON.stringify([state.day,state.completed,to])).digest('hex');}

/** No provider, dispatch, fleet, payroll or notification dependencies. Every write stays under sandbox/<device>/<day>. */
export function waypointSandbox(phone:CrewPhone,endpoint:string,params=new URLSearchParams(),body?:Record<string,unknown>):unknown {
  const dir=location(phone);fs.mkdirSync(dir,{recursive:true,mode:0o700});
  let lock:number|undefined;
  if(body){try{lock=fs.openSync(path.join(dir,'write.lock'),'wx',0o600);}catch(e){if((e as NodeJS.ErrnoException).code==='EEXIST')throw new CrewPhoneError('Another test action is saving. Refresh and try again.',409);throw e;}}
  try{
    const state=read(phone),result=run(phone,state,endpoint,params,body);
    if(body){const file=path.join(dir,'state.json'),temp=`${file}.${randomUUID()}.tmp`;fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});fs.renameSync(temp,file);}
    return result;
  }finally{if(lock!==undefined){fs.closeSync(lock);fs.unlinkSync(path.join(dir,'write.lock'));}}
}
function run(phone:CrewPhone,state:State,endpoint:string,params:URLSearchParams,body?:Record<string,unknown>):unknown {
  if(endpoint==='day'){
    if(!body)return {test:true,date:chicagoDateKey(),day:state.day,roster,trucks:JUNKWARE_DISPATCH_TRUCKS,phone:{...phone,truck:state.day?.truck || phone.truck},inspection:inspection(state),switch:null};
    if(body.action==='reset-test-assignments'){state.completed=[];state.completions=[];state.receipts=[];state.generation++;return {reset:true};}
    if(body.date!==chicagoDateKey() || !uuid.test(String(body.requestId)) || !JUNKWARE_DISPATCH_TRUCKS.includes(String(body.truck)))throw new CrewPhoneError('Choose today’s test truck.');
    if(state.day?.requestId===body.requestId)return {day:state.day};
    if(body.expectedVersion!==(state.day?.version || 0))throw new CrewPhoneError('Refresh your test setup.',409);
    if(state.day && state.day.truck!==body.truck)throw new CrewPhoneError('Use Switch truck.',409);
    const {driver,responsible,navigators}=body;
    if(typeof driver!=='string' || typeof responsible!=='string' || !Array.isArray(navigators) || navigators.length>2 || [driver,responsible,...navigators].some(n=>!roster.includes(String(n))) || new Set([driver,...navigators]).size!==1+navigators.length)throw new CrewPhoneError('Choose the test crew.');
    state.day={deviceId:phone.deviceId,truck:String(body.truck),date:chicagoDateKey(),version:(state.day?.version || 0)+1,requestId:String(body.requestId),responsible,driver,navigators:navigators as string[],savedAt:new Date().toISOString()};return {day:state.day};
  }
  if(endpoint==='inspection'){
    const day=requireDay(state),d=device(phone,state);
    if(!body){const id=params.get('requestId');return id?{report:state.reports.find(r=>r.requestId===id && r.deviceId===d.deviceId) || null}:{test:true,device:d,trucks:[day.truck],inspectors:[day.responsible],date:day.date,dayVersion:day.version,report:report(state)};}
    if(body.action!=='submit' || body.dayVersion!==day.version)throw new CrewPhoneError('Test truck setup changed. Refresh.',409);
    const input=validateTruckInspection(body.report);
    if(input.truck!==day.truck || chicagoDateKey(new Date(input.startedAt))!==day.date)throw new CrewPhoneError('Inspect today’s selected test truck.',409);
    const prior=state.reports.find(r=>r.requestId===input.requestId);
    if(prior){if(prior.deviceId!==d.deviceId || JSON.stringify(input)!==JSON.stringify(Object.fromEntries(Object.keys(input).map(k=>[k,prior[k as keyof TruckInspectionReport]]))))throw new CrewPhoneError('This test inspection request was already used.',409);return {report:prior};}
    const saved:TruckInspectionReport={...input,version:2,deviceId:d.deviceId,inspectionDate:day.date,receivedAt:new Date().toISOString()};state.reports.push(saved);return {report:saved};
  }
  if(endpoint==='switch-truck'){
    const day=requireDay(state),to=String(body?.to || params.get('truck') || '');
    if(body?.action==='continue'){const saved=state.switches.find(s=>s.requestId===body.requestId);if(!saved)throw new CrewPhoneError('Test switch not found.',404);return {switch:saved};}
    if(body){const prior=state.switches.find(s=>s.requestId===body.requestId);if(prior){if(prior.to!==to)throw new CrewPhoneError('Test switch request was already used.',409);return {switch:prior};}}
    if(!body && !to)return {switch:null};
    if(!JUNKWARE_DISPATCH_TRUCKS.includes(to) || to===day.truck)throw new CrewPhoneError('Choose a different test truck.');
    const count=3-state.completed.length;
    if(!body)return {preview:{from:day.truck,to,count,fingerprint:fingerprint(state,to),inspection:inspection(state,to)}};
    if(body.action!=='confirm' || !uuid.test(String(body.requestId)) || body.fingerprint!==fingerprint(state,to))throw new CrewPhoneError('Review the test switch again.',409);
    const saved={requestId:String(body.requestId),from:day.truck,to,status:'complete' as const,message:'Test assignments moved. No live truck or job was changed.',total:count,moved:count};
    state.switches.push(saved);state.day={...day,truck:to,version:day.version+1,requestId:saved.requestId,savedAt:new Date().toISOString()};return {switch:saved};
  }
  if(endpoint==='current'){requireReady(state);if(params.size)throw new CrewPhoneError('Use the current test assignment.');const job=current(phone,state);return {summary:testDaySummary(state.day!,state.completions || [],state.completed.length-(state.completions?.length || 0)),test:true,state:job?'assigned':'waiting',truck:state.day!.truck,job,observedAt:new Date().toISOString(),message:job?'Fictional test assignment':'All three test assignments are complete.'};}
  if(endpoint==='photos'){if(body)throw new CrewPhoneError('Test photos stay on your phone. Uploads to live jobs are disabled.',403);assigned(phone,state,params.get('assignmentId'));return {photos:[]};}
  if(endpoint==='closeout'){
    const id=body?.assignmentId || params.get('assignmentId'),requestId=body?.requestId || params.get('requestId');
    requireReady(state);
    if(requestId){const receipt=state.receipts.find(r=>r.requestId===requestId);if(receipt){if(receipt.assignmentId!==id)throw new CrewPhoneError('Test receipt belongs to another assignment.',409);return {receipt};}if(!body)throw new CrewPhoneError('Test receipt not found.',404);}
    const job=assigned(phone,state,id),day=state.day!;
    if(!body)return sandboxCloseout(job,day);
    const values=body.values as Record<string,unknown> | undefined;
    if(!uuid.test(String(requestId)) || body.crewVersion!==day.version || body.expectedVersion!==`sandbox:${job.assignmentId}:${day.version}` || !values || values.appointmentId!==job.appointmentId || values.truck!==day.truck || values.serviceDate!==day.date || values.targetStatus!=='8')throw new CrewPhoneError('Reload the test closeout before saving.',409);
    if(values.expectedSourceVersion!==sandboxCloseout(job,day).sourceVersion)throw new CrewPhoneError('Test pricing changed. Reload and review the closeout.',409);
    const completion=testCompletion(job,day,values);
    state.completions=[...(state.completions || []),completion];
    const receipt:Receipt={requestId:String(requestId),assignmentId:job.assignmentId,action:'closeout',status:'verified',dryRun:true,message:'Test complete. No live job, payment, photo or customer message was sent.'};state.receipts.push(receipt);state.completed.push(job.assignmentId);return {receipt};
  }
  throw new CrewPhoneError('This operation is unavailable in test mode.',403);
}
