import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const phone={deviceId:'fixture-phone',truck:'Truck 1'},day={date:'2026-10-16',version:1};
const scoped={state:'assigned',truck:'Truck 1',job:null,jobs:[{appointmentId:'101',assignmentId:'own',status:'Confirmed'}],updateToken:'scoped'};
const expanded={...scoped,jobs:[...scoped.jobs,{appointmentId:'202',readOnly:true}],updateToken:'expanded',visibility:'all-trucks'};
let approved=false,test=false,ready=true,visibleReads=0,dispatchCalls=0,backgroundCalls=0;
const mocks:Record<string,unknown>={
 '@/lib/crew-phone-http':{
  requireCrewPhone:()=>({...phone,test}),requireCrewReady:()=>{if(!ready)throw Error('Inspection required');return phone;},
  crewPhoneResponse:Response.json,crewPhoneFailure:()=>Response.json({error:'blocked'},{status:403}),
 },
 '@/lib/crew-phone-day':{requireCrewDay:()=>day},
 '@/lib/crew-appointment-visibility':{crewCanBrowseAllTrucks:()=>approved},
 '@/lib/crew-assigned-day':{crewAssignedDay:()=>scoped,crewVisibleDay:(p:unknown,d:unknown,allowed:unknown)=>{assert.equal(p,phone);assert.equal(d,day.date);assert.equal(allowed,true);visibleReads++;return expanded;}},
 '@/lib/crew-schedule-dispatch':{ensureCrewScheduleDispatch:(_t:unknown,_d:unknown,p:unknown)=>{assert.equal(p,scoped,'Dispatch must never receive expanded browsing');dispatchCalls++;return false;}},
 '@/lib/waypoint-day-summary-source':{readWaypointDay:()=>({truck:phone.truck})},
 '@/lib/waypoint-sandbox':{waypointSandbox:()=>({test:true})},
 '@/lib/crew-dispatch-store':{readCrewDispatch:()=>({current:null}),matchingCrewCompletion:()=>false},
 '@/lib/crew-dispatch-service':{crewCurrentPayload:()=>{throw Error('Unexpected recovery');}},
 '@/lib/crew-dispatch-sources':{crewDispatchSources:{}},
 '@/lib/crew-closeout-service':{warmCrewCloseout:()=>{throw Error('Unexpected closeout');}},
 '@/lib/release-after':{trackedAfter:()=>{backgroundCalls++;}},
 '@/lib/crew-phone':{CrewPhoneError:Error},
};
function route(name:string){
 const exports:Record<string,unknown>={};
 const source=fs.readFileSync(`app/api/crew-jobs/${name}/route.ts`,'utf8');
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled,{exports,require:(id:string)=>{assert.ok(id in mocks,id);return mocks[id];},Response,URL,Date,Map,Promise});
 return exports.GET as (request:Request)=>Promise<Response>;
}
async function main(){
 for(const name of ['current','updates']){
  const get=route(name),request=new Request(`https://example.invalid/api/crew-jobs/${name}`);
  approved=false;assert.equal((await (await get(request)).json()).updateToken,'scoped');
  approved=true;assert.equal((await (await get(request)).json()).updateToken,'expanded');
  ready=false;assert.equal((await get(request)).status,403);ready=true;
  const prior=visibleReads;test=true;assert.equal((await get(request)).status,200);assert.equal(visibleReads,prior,'Sandbox never reaches visibility policy projection');test=false;
 }
 assert.equal(visibleReads,2);assert.equal(dispatchCalls,4);assert.equal(backgroundCalls,0);
 assert.equal((await route('current')(new Request('https://example.invalid/api/crew-jobs/current?truck=2'))).status,403);
 console.log('PASS: current/updates API policy gating, truck-only dispatch, sandbox/inspection isolation, and client truck override rejection. No provider or live state access.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
