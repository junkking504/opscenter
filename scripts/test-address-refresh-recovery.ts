import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ADDRESS_VERIFICATION_POLICY } from '../lib/desktop-address-verification';

async function main() {
  if (process.argv[2] === '--child') {
    const [, , , root, time, phase] = process.argv;
    Date.now=()=>Number(time);
    let calls=0;
    globalThis.fetch=async(input)=>{
      calls++;
      if (!String(input).includes('census.gov')) return new Response('[]');
      if (phase==='outage') return new Response('Unavailable',{status:503});
      return new Response(JSON.stringify({result:{addressMatches:[{matchedAddress:'100 RECOVERY ST, NEW ORLEANS, LA, 70125',addressComponents:{city:'NEW ORLEANS',state:'LA',zip:'70125'},coordinates:{x:-90.1,y:29.95}}]}}));
    };
    process.on('exit',()=>fs.writeFileSync(path.join(root,'calls.json'),JSON.stringify(calls)));
    process.argv=['node','refresh-schedule-map-inputs.ts','2026-09-17'];
    await import('./refresh-schedule-map-inputs');
    return;
  }
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'address-worker-recovery-'));
  try {
    const history=path.join(root,'history/junkware');fs.mkdirSync(history,{recursive:true});
    fs.writeFileSync(path.join(history,'junkware_live_2026-09-17_summary.csv'),'appt_id,jk_number,address,status\n123456,JK_TEST,100 Recovery St New Orleans LA 70125,Confirmed\n');
    const run=(time:number,phase:string)=>{
      const result=spawnSync(process.execPath,['--import','tsx',fileURLToPath(import.meta.url),'--child',root,String(time),phase],{
        env:{...process.env,OPSBOT_DATA_DIR:root,OPSCENTER_DATA_DIR:root,SERVICE_ADDRESS_CACHE_DIR:path.join(root,'cache/service-address-verifications'),OSM_ADDRESS_CACHE_DIR:path.join(root,'osm')},encoding:'utf8',timeout:10000,
      });
      assert.equal(result.status,0,result.stderr+result.stdout);
      return {state:JSON.parse(fs.readFileSync(path.join(root,'cache/schedule-address-refresh.json'),'utf8')),calls:JSON.parse(fs.readFileSync(path.join(root,'calls.json'),'utf8'))};
    };
    const now=2_000_000_000;
    const failure=run(now,'outage');
    assert.equal(failure.state.checked,1);assert.equal(failure.state.verified,0);assert.equal(failure.calls,2);
    const cooling=run(now+30_000,'recovered');
    assert.equal(cooling.state.checked,0);assert.equal(cooling.calls,0,'Separate worker process respects durable backoff');
    const recovered=run(now+60_000,'recovered');
    assert.equal(recovered.state.checked,1);assert.equal(recovered.state.verified,1);assert.equal(recovered.calls,1,'Real worker retries at one minute and recovers');
    const pins=JSON.parse(fs.readFileSync(path.join(root,'cache/appointment_geocodes.json'),'utf8')).addresses;
    const pin=Object.values(pins)[0] as Record<string,unknown>;
    assert.equal(pin.verification_policy,ADDRESS_VERIFICATION_POLICY);
    assert.equal(pin.matched_address,'100 RECOVERY ST, NEW ORLEANS, LA, 70125');
    assert.equal(pin.house_street_verified,true);
    assert.equal(run(now+120_000,'recovered').calls,0,'Verified evidence survives process restarts without another request');
    console.log('Real address worker: outage, persisted backoff, one-minute recovery, policy-stamped publication and restart reuse passed. Synthetic providers only.');
  } finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
