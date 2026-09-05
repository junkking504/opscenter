import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {NextRequest} from 'next/server';
import {readPhotoReview, readPhotoPreview, photoReason, InvalidPhotoReviewFilter} from '../lib/desktop-photo-review';
import {PHOTO_STATES, type PhotoState} from '../desktop-ui/lib/photo-review-contract';
import {authorizeOpsRequest} from '../lib/ops-roles';
import {createAuthSessionCookieValue, opsAuthIdentity} from '../lib/auth';
import {middleware} from '../middleware';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'photo-review-test-'));
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64');
function add(messageId:string,state:PhotoState,values:Record<string,unknown>={}) {
  const id=hash(messageId);
  fs.writeFileSync(path.join(root,state,`${id}.json`),JSON.stringify({messageId,senderPhone:'+15550001111',receivedAt:'2026-09-02T02:15:00Z',mimeType:'image/png',caption:'Before JK1234567',review:{reason:'sender_not_mapped_to_truck'},...values}));
  return id;
}
const read=(query='')=>readPhotoReview(new URLSearchParams(query),root);
const contents=()=>Object.fromEntries(fs.readdirSync(root,{recursive:true}).map(String).sort().flatMap(file=>fs.lstatSync(path.join(root,file)).isFile()?[[file,hash(fs.readFileSync(path.join(root,file)).toString('base64'))]]:[]));
async function main(){
  for(const state of [...PHOTO_STATES,'media'])fs.mkdirSync(path.join(root,state));
  const first=add('synthetic-photo-1','review');
  fs.writeFileSync(path.join(root,'media',`${first}.png`),png);
  for(let i=2;i<=27;i++)add(`synthetic-photo-${i}`,'review',{receivedAt:`2026-09-03T${String(i%24).padStart(2,'0')}:00:00Z`});
  add('synthetic-failed','failed',{receivedAt:'2026-09-04T12:00:00Z',senderPhone:'+15550002222',review:null,error:'fetch failed https://private.invalid/media?token=PRIVATE_TEST_VALUE',caption:'After JK7654321'});
  const before=contents();
  const all=read();
  assert.deepEqual(all.counts,{review:27,failed:1,processing:0,incoming:0});
  assert.equal(all.complete,true);assert.equal(all.total,28);assert.equal(all.records.length,25);assert.equal(all.pages,2);
  assert.equal(all.records[0].id,first);assert.equal(all.records[0].jobDate,'2026-09-01','Received date uses Central time, not UTC.');
  const href=new URL(all.records[0].sourceHref!,'http://localhost');
  assert.equal(href.searchParams.get('date'),'2026-09-01');assert.equal(href.searchParams.get('job'),'JK1234567');assert.equal(href.searchParams.has('appointmentId'),false);
  assert.equal(all.senders.length,2);assert.equal(all.senders[0].count,27);
  assert.equal(read('page=99').page,2);assert.equal(read('page=2').records.length,3);
  assert.equal(read('state=failed').filtered,1);assert.equal(read('reason=sender_not_mapped_to_truck').filtered,27);
  assert.equal(read(`sender=${all.senders[0].key}`).filtered,27);assert.equal(read('q=jk7654321').filtered,1);
  assert.equal(read('q=1111').filtered,27);assert.equal(read('q=2026-09-01').filtered,1);
  assert.equal(read('q=missing').filtered,0);assert.equal(read('state=failed').records[0].reasonLabel,'Media retrieval failed');
  const serialized=JSON.stringify(read('state=failed'));
  for(const privateValue of ['+15550002222','synthetic-failed','private.invalid','PRIVATE_TEST_VALUE','mediaId','phoneNumberId'])assert.equal(serialized.includes(privateValue),false,privateValue);
  assert.equal(all.records[0].previewAvailable,true);assert.deepEqual(readPhotoPreview(first,'review',root)?.bytes,png);
  assert.equal(readPhotoPreview(first,'uploaded',root),null);assert.equal(readPhotoPreview('../'+first,'review',root),null);assert.equal(readPhotoPreview(first,'../review',root),null);
  assert.deepEqual(contents(),before,'Listing, filtering and previewing must leave queue and media contents unchanged.');
  for(const query of ['state=uploaded','page=0','page=1.5','page=Infinity',`q=${'x'.repeat(101)}`])assert.throws(()=>read(query),InvalidPhotoReviewFilter);
  assert.match(photoReason('upload_outcome_uncertain').nextStep,/may already have succeeded/);
  assert.equal(photoReason('photo_exceeds_5_MB').label,'Photo too large');
  assert.match(photoReason('jk_not_on_active_schedule').nextStep,/more than one appointment/);
  const invalidTime=add('missing-time','review',{receivedAt:'invalid',caption:'',review:{reason:'unknown_source'},attempts:'Infinity'});
  assert.equal(read(`q=${invalidTime}`).records[0].sourceHref,null);assert.equal(read(`q=${invalidTime}`).records[0].attempts,0);
  fs.writeFileSync(path.join(root,'review',`${hash('corrupt')}.json`),'{');
  fs.writeFileSync(path.join(root,'review',`${hash('wrong-id')}.json`),JSON.stringify({messageId:'some-other-id'}));
  fs.symlinkSync(path.join(root,'review',`${first}.json`),path.join(root,'review',`${hash('symlink')}.json`));
  assert.equal(read().unreadable,3);assert.equal(read().complete,false);
  fs.rmdirSync(path.join(root,'incoming'));
  assert.deepEqual(read().unavailableStates,['incoming']);assert.equal(read().complete,false);
  fs.writeFileSync(path.join(root,'media',`${first}.png`),'<script>not-an-image</script>');assert.equal(readPhotoPreview(first,'review',root),null);
  fs.unlinkSync(path.join(root,'media',`${first}.png`));
  fs.symlinkSync(path.join(root,'review',`${first}.json`),path.join(root,'media',`${first}.png`));assert.equal(readPhotoPreview(first,'review',root),null);
  fs.unlinkSync(path.join(root,'media',`${first}.png`));
  fs.writeFileSync(path.join(root,'media',`${first}.png`),Buffer.alloc(5*1024*1024+1));assert.equal(readPhotoPreview(first,'review',root),null);
  fs.writeFileSync(path.join(root,'media',`${first}.png`),png);fs.unlinkSync(path.join(root,'review',`${first}.json`));assert.equal(readPhotoPreview(first,'review',root),null,'Preview requires current unresolved queue membership.');
  const missingRoot=path.join(root,'not-created');assert.equal(readPhotoReview(new URLSearchParams(),missingRoot).complete,false);assert.equal(fs.existsSync(missingRoot),false,'Read path cannot initialize missing runtime state.');
  for(const method of ['GET','HEAD','POST']){
    assert.equal(authorizeOpsRequest('operator','/api/desktop/photos',method).allowed,false);
    assert.equal(authorizeOpsRequest('manager','/api/desktop/photos',method).allowed,true);
  }
  process.env.OPS_AUTH_USERNAME='photo-test';process.env.OPS_AUTH_SESSION_SECRET='synthetic-photo-role-test-secret';process.env.OPS_AUTH_ROLE='operator';
  delete process.env.OPS_AUTH_ROLE_BINDINGS;delete process.env.OPS_ACCESS_TEAM_DOMAIN;delete process.env.OPS_ACCESS_AUD;
  const cookie=await createAuthSessionCookieValue(opsAuthIdentity());
  for(const suffix of ['',`?preview=${first}&state=review`]){
    const anonymous=await middleware(new NextRequest(`http://localhost/api/desktop/photos${suffix}`));
    assert.equal(anonymous.status,401);
    const blocked=await middleware(new NextRequest(`http://localhost/api/desktop/photos${suffix}`,{headers:{cookie:`opscenter_email_session=${cookie}`}}));
    assert.equal(blocked.status,403,'Queue and image requests must reject operators before reaching the route.');
  }
  console.log('PASS: photo queue counts, filtering, pagination, Central dates, privacy, no writes, partial reads, guarded previews and manager access.');
}
main().finally(()=>fs.rmSync(root,{recursive:true,force:true})).catch(error=>{console.error(error);process.exitCode=1;});
