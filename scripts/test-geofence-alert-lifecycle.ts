import assert from 'node:assert/strict';
import {mock} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runSlackOpsAlerts} from '../lib/slack-alerts';
import {readGeofenceEntries,geofenceTimelineAlerts,withoutNativeGeofenceDuplicates} from '../lib/linxup-geofence-alerts';

async function main() {
const root=fs.mkdtempSync(path.join(os.tmpdir(),'geofence-lifecycle-'));
const original={...process.env}, originalFetch=globalThis.fetch;
const day='2026-09-20', start=Date.parse(day+'T15:00:00Z');
mock.timers.enable({apis:['Date'],now:start});
const at=(seconds:number)=>new Date(start+seconds*1000).toISOString();
const event=(seconds:number,type='entered',truck='Truck 9')=>({truck_number:truck,geofence_name:'EMR',occurred_at:at(seconds),alert_type:`geofence_${type}`});
const write=(date:string,rows:unknown[])=>{
  const file=path.join(root,'history/linxup/alerts',`linxup_alerts_${date}.json`);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,JSON.stringify({date,alerts:rows,collection_timestamp:new Date().toISOString()}));
};
const stateFile=path.join(root,'state.json');
const requests:{method:string;ts?:string;text?:string;channel:string}[]=[];
let failDelete=false;
globalThis.fetch=(async (url,init)=>{
  const body=JSON.parse(String(init?.body)),method=String(url).split('/').at(-1)!;
  requests.push({method,...body});
  return new Response(JSON.stringify(failDelete && method==='chat.delete' ? {ok:false,error:'ratelimited'} : {ok:true,channel:body.channel,ts:body.ts || `123.${requests.length}`}));
}) as typeof fetch;
process.env.OPSCENTER_DATA_DIR=root;
process.env.SLACK_OPSCENTER_STATE_FILE=stateFile;
process.env.SLACK_OPSCENTER_ALERTS_ENABLED='true';
process.env.SLACK_BOT_TOKEN='synthetic-test-token';
const run=(date=day,dryRun=false)=>runSlackOpsAlerts({date,dryRun,onlyKinds:['geofence_entry','geofence_exit']});
const timeline=(date=day)=>{const source=readGeofenceEntries(date);return geofenceTimelineAlerts(date,source.arrivals,[...source.visits,...source.reviewVisits]);};
try {
  write(day,[]);await run(); // Silent historical baseline.
  write(day,[event(0)]);
  assert.equal(timeline().length,1,'First report is immediately visible');
  assert.match(timeline()[0].facts[0].value,/Pending/);
  assert.equal(readGeofenceEntries(day).trackedVisits.length,0,'Pending entry is not an EMR reconciliation visit');
  assert.equal((await run()).posted.length,1,'Entry posts before five minutes');
  assert.match(requests.at(-1)!.text!,/Visit pending/);
  const entryTs=JSON.parse(fs.readFileSync(stateFile,'utf8')).notificationMessages[Object.keys(JSON.parse(fs.readFileSync(stateFile,'utf8')).notificationMessages)[0]].ts;
  mock.timers.setTime(start+61_000);write(day,[event(0),event(61,'exited')]);
  assert.equal(timeline().length,0,'Drive-by is removed from the operational record');
  await run(day,true);assert.equal(requests.length,1,'Dry-run cannot delete');
  failDelete=true;
  assert.equal((await run()).failures.length,1,'Deletion failure is surfaced');
  assert.equal(Object.keys(JSON.parse(fs.readFileSync(stateFile,'utf8')).notificationMessages).length,1,'Failed retraction retains its receipt for retry');
  const retractionState=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  assert.equal(Object.keys(retractionState.pendingGeofenceRetractions).length,1,'Retraction proof survives runner restarts and source expiry');
  write(day,[]); // Source retention cannot strand an already-proven retraction.
  failDelete=false;await run();
  assert.equal(requests.at(-1)!.method,'chat.delete');assert.equal(requests.at(-1)!.ts,entryTs,'Delete only the owned message');
  const afterDelete=requests.length;await run();assert.equal(requests.length,afterDelete,'Successful deletion is not repeated');
  // Missing/partial history must not resurrect a previously discarded alert.
  write(day,[event(0)]);await run();assert.equal(requests.length,afterDelete);

  const reentry=event(600);
  mock.timers.setTime(start+600_000);write(day,[event(0),event(61,'exited'),reentry]);
  await run();assert.equal(requests.at(-1)!.method,'chat.postMessage','A true return has its own immediate alert');
  const positions=path.join(root,'history/linxup/geofence_positions',day+'.json');fs.mkdirSync(path.dirname(positions),{recursive:true});
  mock.timers.setTime(start+900_000);
  fs.writeFileSync(positions,JSON.stringify({date:day,observations:[event(600),event(750),event(900)]}));
  await run();assert.equal(requests.at(-1)!.method,'chat.update','Five-minute confirmation updates the original alert');
  assert.equal(requests.at(-1)!.text,'Truck 9 at EMR');
  assert.equal(readGeofenceEntries(day).trackedVisits.length,1,'Exactly 300 seconds counts for EMR receipt comparison');
  write(day,[event(0),event(61,'exited'),reentry,event(900,'exited')]);
  await run();assert.equal(requests.at(-1)!.text,'Truck 9 departed EMR');
  assert.equal(timeline().length,1,'Qualified entry and exit become one retained visit');

  // A late native transition must reuse the GPS-owned message.
  mock.timers.setTime(start+1500_000);
  fs.writeFileSync(positions,JSON.stringify({date:day,observations:[event(1500,'entered','Truck 8')]}));
  const gpsOnly=readGeofenceEntries(day);
  assert.equal(withoutNativeGeofenceDuplicates([{rawText:'Truck 8 at EMR\nVisit pending · five minutes onsite required',timestamp:at(1500)}],gpsOnly.rawEntries,gpsOnly.rawNativeVisits,gpsOnly.rawTrackedVisits).length,0,'A GPS-only Slack copy cannot duplicate the native card');
  await run(); const postedBefore=requests.filter(row=>row.method==='chat.postMessage').length;
  write(day,[event(0),event(61,'exited'),reentry,event(900,'exited'),event(1490,'entered','Truck 8')]);
  await run();assert.equal(requests.filter(row=>row.method==='chat.postMessage').length,postedBefore,'Late native entry does not duplicate the GPS alert');

  mock.timers.setTime(start+1551_000);
  write(day,[event(1490,'entered','Truck 8'),event(1551,'exited','Truck 8')]);
  await run();assert.equal(requests.at(-1)!.method,'chat.delete','Retract the original GPS-owned message after the native short stay');
  fs.writeFileSync(positions,JSON.stringify({date:day,observations:[]}));
  write(day,[event(1490,'entered','Truck 8')]);
  const aliasRequests=requests.length;await run();
  assert.equal(requests.length,aliasRequests,'A native-only partial replay cannot resurrect the discarded GPS alias');

  // Confirmed presence survives a later contradictory departure report.
  const cEntry=event(2000,'entered','Truck 6');
  mock.timers.setTime(start+2000_000);write(day,[cEntry]);
  fs.writeFileSync(positions,JSON.stringify({date:day,observations:[]}));
  await run();
  mock.timers.setTime(start+2300_000);
  const onsite=[event(2000,'entered','Truck 6'),event(2150,'entered','Truck 6'),event(2300,'entered','Truck 6')];
  fs.writeFileSync(positions,JSON.stringify({date:day,observations:onsite}));await run();
  const confirmed=readGeofenceEntries(day).trackedVisits.find(visit=>visit.truck==='Truck 6')!;
  assert.ok(confirmed);
  mock.timers.setTime(start+2420_000);
  fs.writeFileSync(positions,JSON.stringify({date:day,observations:[...onsite,{...event(2360,'entered','Truck 6'),geofence_name:'Warehouse'}]}));
  write(day,[cEntry,event(2420,'exited','Truck 6')]);
  // Even an already queued retraction must be canceled by contradictory evidence.
  const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));
  const ownedKey=Object.keys(state.notificationMessages).find(key=>key.endsWith(confirmed.id))!;
  state.pendingGeofenceRetractions[ownedKey]=[ownedKey];
  fs.writeFileSync(stateFile,JSON.stringify(state));
  const deletesBefore=requests.filter(row=>row.method==='chat.delete').length;
  await run();
  assert.equal(requests.filter(row=>row.method==='chat.delete').length,deletesBefore,'A departure conflict cannot delete an established visit');
  assert.ok(readGeofenceEntries(day).trackedVisits.find(visit=>visit.id===confirmed.id)?.conflict,'Confirmed presence remains countable with the conflict flag');
  const conflictCard=timeline().find(row=>row.id===confirmed.id)!;
  assert.equal(conflictCard.needsAction,true);assert.match(conflictCard.title,/needs review/);
  assert.ok(requests.some(row=>row.method==='chat.update' && /GPS reports conflict/.test(row.text || '')),'Owned message surfaces the conflict');
  assert.equal(JSON.parse(fs.readFileSync(stateFile,'utf8')).pendingGeofenceRetractions[ownedKey],undefined);

  // Exit just after Chicago midnight retracts the prior-day entry and its card.
  const overnight={...event(0,'entered','Truck 7'),occurred_at:'2026-09-21T04:59:00Z'};
  mock.timers.setTime(Date.parse(overnight.occurred_at));
  write(day,[overnight]);await run();
  mock.timers.setTime(Date.parse('2026-09-21T05:00:01Z'));
  write('2026-09-21',[{...overnight,alert_type:'geofence_exited',occurred_at:'2026-09-21T05:00:01Z'}]);
  await run('2026-09-21');assert.equal(requests.at(-1)!.method,'chat.delete');
  assert.equal(timeline(day).some(row=>row.truck==='Truck 7'),false,'Yesterday also loses the short overnight visit');
  assert.equal(readGeofenceEntries('2026-09-21').trackedVisits.length,0);
  console.log('PASS immediate provisional alerts, five-minute confirmation, owned-message retraction/retry, late-native aliases, EMR exclusion and midnight');
} finally {
  globalThis.fetch=originalFetch;mock.timers.reset();
  for(const key of ['OPSCENTER_DATA_DIR','SLACK_OPSCENTER_STATE_FILE','SLACK_OPSCENTER_ALERTS_ENABLED','SLACK_BOT_TOKEN']) {
    if(original[key]===undefined)delete process.env[key];else process.env[key]=original[key];
  }
  fs.rmSync(root,{recursive:true,force:true});
}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});
