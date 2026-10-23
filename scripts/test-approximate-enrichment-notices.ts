// Synthetic matcher snapshots only; pure message builders, no publisher or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
async function main() {
const root=fs.mkdtempSync(path.join(os.tmpdir(),'enrichment-notices-'));
process.env.OPSCENTER_DATA_DIR=root; process.env.OPSBOT_DATA_DIR=root;
process.env.SLACK_OPS_DISPATCH_CHANNEL_ID='C_TEST';
try {
  const {buildTruckArrivalSlackNotifications:arrivals,buildTruckDepartureSlackNotifications:departures}=await import('../lib/slack-alerts');
  const {stages,departed}=JSON.parse(fs.readFileSync(0,'utf8'));
  const delivered=new Set<string>();
  let pendingArrivals=0;
  for (const row of [...stages,departed,departed]) {
    const messages=arrivals('2026-09-08',[row]);
    assert.equal(messages.length,1);
    assert.match(messages[0].plainText!,/Map pin.*Approximate/);
    for (const message of messages) {
      if (!delivered.has(message.fingerprint)) pendingArrivals++;
      delivered.add(message.fingerprint);
    }
  }
  assert.equal(pendingArrivals,1,'Sequential enrichment must produce one arrival identity');
  assert.ok(stages.every((row: Record<string,unknown>)=>departures('2026-09-08',[row]).length===0));
  const closed=departures('2026-09-08',[departed,departed]);
  assert.equal(closed.length,1);
  assert.equal(closed[0].fingerprint,departures('2026-09-08',[departed])[0].fingerprint);
  const shifted={...departed,visit_intervals:departed.visit_intervals.map((interval: Record<string,unknown>)=>({...interval,arrival:'2026-09-08T15:02:00Z'}))};
  const oldDeparture=departures('2026-09-08',[shifted])[0].fingerprint;
  assert.equal(departures('2026-09-08',[departed],[oldDeparture])[0].fingerprint,oldDeparture,'Correction reuses an already-delivered departure for overlapping source evidence');
  for (const unrelated of [oldDeparture.replace(':101:',':102:'),oldDeparture.replace(':truck-3:',':truck-4:'),oldDeparture.replace('15:02:00Z','15:00:00Z'),oldDeparture.replace('15:02:00Z','15:01:30Z')]) {
    assert.equal(departures('2026-09-08',[departed],[unrelated])[0].fingerprint,closed[0].fingerprint,'Do not alias different stops, trucks, visits or inferred timestamps');
  }
  const verified={...departed,visit_pin:null};
  assert.equal(departures('2026-09-08',[verified],[oldDeparture])[0].fingerprint,closed[0].fingerprint,'Verified-pin identities unchanged');
  const returned={...departed,visit_intervals:[{arrival:'2026-09-08T15:15:00Z',departure:'2026-09-08T15:16:00Z',departure_confirmed:true,source_timestamps:['2026-09-08T15:15:00Z','2026-09-08T15:16:00Z']}]};
  assert.notEqual(departures('2026-09-08',[returned],[oldDeparture])[0].fingerprint,oldDeparture,'A later return visit gets its own departure');
  // Restoring the original source-backed start reuses its existing receipt.
  assert.ok(delivered.has(arrivals('2026-09-08',[stages[0]])[0].fingerprint));
  console.log('PASS sequential enrichment: one arrival notice identity, no premature departure, one corroborated departure identity; no sends.');
} finally {fs.rmSync(root,{recursive:true,force:true});}

}
main().catch(error=>{console.error(error);process.exitCode=1;});
