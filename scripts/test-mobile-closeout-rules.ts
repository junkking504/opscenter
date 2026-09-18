import assert from 'node:assert/strict';
import type { Page } from '@playwright/test';
import { closeoutPhotoEvidence, closeoutPhotoCount, requireCloseoutPhotos } from '../lib/closeout-photo-policy';
import { nextCrewJobUnlocked, projectCrewAssignment, type CrewCompletionReceipt } from '../lib/crew-job-release';
import { applyCloseout } from './sync-junkware-job-closeout';

async function main() {
  const id='900002';
  const photo=`https://junkware.junk-king.com/system/aspnet/local/media/before-${id}-sample.jpg`;
  const evidence=closeoutPhotoEvidence(id,[photo,`${photo}?v=1`]);
  assert.equal(closeoutPhotoCount(evidence,id),1,'Duplicate URLs count once');
  const rejected=[
    'blob:local-selection', 'data:image/png;base64,abcd',
    photo.replace('900002','900003'), photo.replace('https:','http:'),
    photo.replace('junkware.junk-king.com','example.com'),
    photo.replace('/media/','/media/%2e%2e/'),
    photo.replace('https://','https://user:password@'), `${photo}#unverified`,
    photo.replace('.jpg','.pdf'),
  ];
  for(const value of rejected) assert.equal(closeoutPhotoCount(closeoutPhotoEvidence(id,[value]),id),0,value);
  for(const source of [{}, {photoCount:3}, {photoEvidence:{appointmentId:id,urls:[]}}, {photoEvidence:{appointmentId:'900003',urls:[photo]}}]) {
    assert.throws(()=>requireCloseoutPhotos(source,'8',id),/Upload at least one/);
  }
  requireCloseoutPhotos({},'1',id);
  requireCloseoutPhotos({photoEvidence:evidence},'8',id);

  const release={currentAppointmentId:id,nextAppointmentId:'900003',nextReleased:true};
  const records=[{appointmentId:id,customer:'Current'}, {appointmentId:'900003',customer:'Hidden future customer',address:'Hidden future address'}];
  const verified: CrewCompletionReceipt={action:'closeout',status:'verified',sourceResult:{appointmentId:id,closeout:{status:{value:'8'},photoEvidence:evidence}}};
  const locked: Array<CrewCompletionReceipt|null>=[null,
    ...['pending','uncertain','failed','reconciled'].map(status=>({...verified,status})),
    {...verified,action:'cancel'}, {...verified,action:'classify'},
    {...verified,sourceResult:{...verified.sourceResult,appointmentId:'900001'}},
    {...verified,sourceResult:{...verified.sourceResult,closeout:{status:{value:'1'},photoEvidence:evidence}}},
    {...verified,sourceResult:{...verified.sourceResult,closeout:{status:{value:'8'}}}},
  ];
  for(const receipt of locked) {
    assert.equal(nextCrewJobUnlocked(release,receipt),false);
    const payload=projectCrewAssignment(release,receipt,records);
    assert.equal(payload.appointment?.appointmentId,id);
    assert.equal(JSON.stringify(payload).includes('Hidden future'),false,'Hidden appointment data never crosses the projection');
  }
  assert.equal(nextCrewJobUnlocked(release,verified),true);
  assert.equal(projectCrewAssignment(release,verified,records).appointment?.appointmentId,'900003');
  assert.deepEqual(projectCrewAssignment({...release,nextReleased:false},verified,records),{appointment:null,state:'waiting'});
  assert.equal(projectCrewAssignment(release,null,[]).state,'unavailable','Missing current source must not advance the queue');
  assert.equal(projectCrewAssignment(release,null,[records[0],records[0],records[1]]).state,'unavailable','Ambiguous current source must not advance');
  assert.deepEqual(projectCrewAssignment({currentAppointmentId:null,nextAppointmentId:null,nextReleased:false},null,records),{appointment:null,state:'waiting'});

  // Exercise the real write adapter without starting a browser. Missing photos
  // must stop before even locating a mutation control, for direct callers too.
  let touched=false;
  const page=new Proxy({}, {get(){touched=true;throw new Error('Source mutation reached');}}) as Page;
  const input={targetStatus:'8' as const,driverId:'d',navigatorIds:[],loadQuantity:'0',loadSize:'',loadPrice:'400',bedloadQuantity:'',bedloadSize:'',bedloadPrice:'',otherChargesToAdd:[],discount:'',tip:'',jobCategoryId:'',actualStartHour:'10',actualStartMinute:'00',actualEndHour:'11',actualEndMinute:'00'};
  await assert.rejects(applyCloseout(page,input,{status:{value:'1'},photoEvidence:closeoutPhotoEvidence(id,[])}),/Upload at least one/);
  assert.equal(touched,false,'No source controls touched without photos');
  await assert.rejects(applyCloseout(page,input,{status:{value:'1'},photoEvidence:evidence}),/Source mutation reached/);
  assert.equal(touched,true,'Verified source photos allow existing write validation to proceed');
  console.log('PASS: exact-appointment photo requirement, write-adapter preflight, verified completion gate, dispatch release gate, no future-data projection, unavailable-source handling. No browser or live writes.');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
