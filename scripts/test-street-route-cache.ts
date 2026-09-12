import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadStreetProgress,saveStreetProgress} from '../lib/street-route-cache';
import {gpsSourceVersion,readStreetRoute} from '../lib/desktop-street-route';
import type {TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';

async function main(){
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'street-route-cache-'));
 try {
  const points=[0,1,2].map(i=>({timestamp:`2026-09-12T13:0${i}:00Z`,latitude:30+i*.001,longitude:-90}));
  const source:TruckGpsRoute={date:'2026-09-12',truck:'Truck 81',status:'available',observedAt:null,coveredThrough:null,points,paths:[points],gaps:0,rejected:0,trips:[{id:'one',number:1,departure:points[0].timestamp,arrival:points[2].timestamp,from:{...points[0],address:'PRIVATE CUSTOMER ADDRESS'},to:{...points[2],address:'PRIVATE CUSTOMER ADDRESS'}}]};
  const result={sourceVersion:gpsSourceVersion(source),status:'available' as const,paths:[0,1].map(sourceEdge=>({sourceEdge,kind:'matched' as const,points:points.slice(sourceEdge,sourceEdge+2)})),unmatched:0,nextEdge:2};
  const retryAt=Date.now()+60_000;
  saveStreetProgress(directory,{source,result,retryAt});
  const file=path.join(directory,fs.readdirSync(directory)[0]);
  assert.equal(fs.statSync(file).mode&0o777,0o600);
  assert(!fs.readFileSync(file,'utf8').includes('PRIVATE CUSTOMER ADDRESS'),'Cache excludes trip addresses');
  assert.deepEqual(loadStreetProgress(directory,source.date,source.truck)?.result,result);
  assert.equal(loadStreetProgress(directory,source.date,'Truck 82'),undefined);
  let calls=0;const send=async()=>{calls++;return null;};
  const restored=await readStreetRoute(source,send,directory);
  assert.equal(restored.status,'available');assert.equal(restored.paths.length,2);
  assert.equal(calls,0,'First read after restart restores geometry without calling a provider');
  const corrected={...source,points:points.map((p,i)=>i===0?{...p,latitude:31}:p)};
  const changed=await readStreetRoute(corrected,send,directory);
  assert.deepEqual(changed.paths.map(p=>p.sourceEdge),[1],'Source corrections invalidate saved geometry');
  for(let i=0;i<10;i++)await readStreetRoute(corrected,send,directory);
  assert.equal(calls,0,'Faster local polling and source changes cannot bypass the saved retry delay');
  const valid=fs.readFileSync(file,'utf8');
  fs.writeFileSync(file,valid.replace('checksum','invalidChecksum'));
  assert.equal(loadStreetProgress(directory,source.date,source.truck),undefined,'Corrupt cache is ignored');
  fs.writeFileSync(file,valid);fs.utimesSync(file,new Date(0),new Date(0));
  assert.equal(loadStreetProgress(directory,source.date,source.truck),undefined,'Expired geometry is ignored');
  for(let i=0;i<35;i++)saveStreetProgress(directory,{source:{...source,truck:`Truck ${100+i}`},result,retryAt});
  assert.equal(fs.readdirSync(directory).filter(f=>f.endsWith('.json')).length,32,'Cache has a bounded file count');
  assert.equal(fs.readdirSync(directory).filter(f=>f.endsWith('.tmp')).length,0,'Atomic writes leave no temporary files');
  console.log('Street cache passed: restart reuse, no extra provider requests, source correction, permissions, privacy, corruption, expiry and bounded retention.');
 }finally{fs.rmSync(directory,{recursive:true,force:true});}
}
void main();
