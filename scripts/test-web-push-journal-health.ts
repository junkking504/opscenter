import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { readPushJournalHealth, PUSH_QUEUE_LIMITS } from '../lib/web-push-journal-health';
import { pushDevicesGET } from '../lib/web-push-api';

async function main(){
 const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'push-health-'));
 const root=path.join(temporary,'journal');
 const write=async(name:string,body='{}')=>{const file=path.join(root,name);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,body);};
 try {
  assert.equal((await readPushJournalHealth('')).configured,false);
  for(const absent of ['relative',root]){const health=await readPushJournalHealth(absent);assert.equal(health.status,'unknown');assert.ok(health.capacity.every(group=>group.remainingFiles===null));}
  assert.equal(await fs.stat(root).then(()=>true,()=>false),false,'health cannot provision a journal');
  await fs.mkdir(root);let health=await readPushJournalHealth(root);
  assert.equal(health.retention.status,'unknown');assert.ok(health.capacity.every(group=>group.files===0&&group.remainingBytes===128*1024*1024));
  await write('ready/a.json','123');await write('quarantine/b.json','12345');await write('pending/c.json','1234567');await write('pending/d.prepared','1');await write('pending-quarantine/e.json','12');await write('uncertain/f.json','1234');
  await write('ready/ignored.tmp','not counted');await write('archive/old.json','not admission capacity');
  await write('retention-audit.json',JSON.stringify({unscopableRetained:4}));
  await fs.utimes(path.join(root,'retention-audit.json'),new Date('2020-01-01Z'),new Date('2020-01-01Z'));
  health=await readPushJournalHealth(root);
  assert.deepEqual(health.capacity.map(g=>[g.key,g.files,g.bytes,g.remainingFiles,g.remainingBytes]),[['ready',2,8,9998,134217720],['pending',3,10,9997,134217718],['uncertain',1,4,9999,134217724]]);
  assert.equal(health.retention.unscopableRetained,4);assert.equal(health.retention.scannedAt,'2020-01-01T00:00:00.000Z','last scan age is not replaced by request time');
  assert.notEqual(health.sampledAt,health.retention.scannedAt);
  await fs.utimes(path.join(root,'retention-audit.json'),new Date('2100-01-01Z'),new Date('2100-01-01Z'));assert.equal((await readPushJournalHealth(root)).retention.status,'unknown','future scan time is not credible');
  for(const audit of ['{','{}','null','{"unscopableRetained":-1}','{"unscopableRetained":1.5}','{"unscopableRetained":"4"}','x'.repeat(65537)]){
   await write('retention-audit.json',audit);assert.equal((await readPushJournalHealth(root)).retention.status,'unknown');
  }
  await fs.unlink(path.join(root,'retention-audit.json'));await fs.symlink(path.join(root,'ready/a.json'),path.join(root,'retention-audit.json'));assert.equal((await readPushJournalHealth(root)).retention.status,'unknown');
  await fs.symlink(path.join(root,'pending/c.json'),path.join(root,'uncertain/link.json'));
  health=await readPushJournalHealth(root);assert.equal(health.capacity[2].status,'unknown');assert.equal(health.capacity[0].status,'observed');
  assert.doesNotMatch(JSON.stringify(health),new RegExp(temporary),'no local paths or contents in response');
  await fs.unlink(path.join(root,'uncertain/link.json'));
  const large=await fs.open(path.join(root,'uncertain/large.json'),'w');await large.truncate(PUSH_QUEUE_LIMITS.bytes);await large.close();
  health=await readPushJournalHealth(root);assert.equal(health.capacity[2].bytes,134217732);assert.equal(health.capacity[2].remainingBytes,0,'over-limit usage is visible, remaining never negative');
  await fs.unlink(path.join(root,'uncertain/large.json'));
  // A producer publishes while health scans: partial totals must be unknown.
  const original=fs.opendir;let changed=false;
  fs.opendir=(async(...args:Parameters<typeof fs.opendir>)=>{
   if(String(args[0])===path.join(root,'ready')&&!changed){changed=true;await write('ready/new.json');}
   return original(...args);
  }) as typeof fs.opendir;
  try {assert.equal((await readPushJournalHealth(root)).capacity[0].status,'unknown');}finally{fs.opendir=original;}
  // Excess unexpected names are bounded without declaring partial spare space.
  fs.opendir=(async(...args:Parameters<typeof fs.opendir>)=>String(args[0])===path.join(root,'ready')
   ?{async *[Symbol.asyncIterator](){for(let i=0;i<20003;i++)yield {name:'ignored.tmp'};}}
   :original(...args)) as typeof fs.opendir;
  try {assert.equal((await readPushJournalHealth(root)).capacity[0].status,'unknown');}finally{fs.opendir=original;}
  // Actual file-count admission boundary, including shared quarantine usage.
  await fs.mkdir(path.join(root,'ready'),{recursive:true});
  for(let start=0;start<10000;start+=100)await Promise.all(Array.from({length:100},(_,n)=>fs.writeFile(path.join(root,'ready',`count-${start+n}.json`),'')));
  health=await readPushJournalHealth(root);assert.equal(health.capacity[0].files,10003);assert.equal(health.capacity[0].remainingFiles,0);
  await fs.symlink(root,path.join(temporary,'link'));assert.equal((await readPushJournalHealth(path.join(temporary,'link'))).status,'unknown');
  // Match actual producer limits and grouping, not a guessed queue quota.
  const producer=await fs.readFile('scripts/opscenter_push_journal.py','utf8');assert.match(producer,/MAX_ENTRIES = 10000/);assert.match(producer,/MAX_BYTES = 128 \* 1024 \* 1024/);
  const actor={email:'owner',role:'manager' as const,expiresAt:new Date(Date.now()+86400000)};let reads=0;
  const service={enabled:()=>false,publicKey:()=>undefined,origin:()=>undefined,list:async()=>[],manage:async()=>'',journal:async()=>{reads++;return readPushJournalHealth(root);}};
  assert.equal((await pushDevicesGET(null,service)).status,401);assert.equal((await pushDevicesGET({...actor,role:'operator'},service)).status,403);assert.equal(reads,0,'unauthorized callers never scan');
  const response=await pushDevicesGET(actor,service);assert.match(response.headers.get('Cache-Control')!,/no-store/);assert.equal((await response.json()).journal.configured,true);
  const down=await (await pushDevicesGET(actor,{...service,list:async()=>{throw new Error('private SQL');}})).json();assert.equal(down.storage,'unavailable');assert.equal(down.journal.capacity[0].status,'observed','DB outage cannot hide independent queue evidence');assert.doesNotMatch(JSON.stringify(down),/private SQL/);
  console.log('Journal health passed: grouped admission headroom, retained-scan timestamp, absent/corrupt/oversize/symlink unknowns, concurrent changes, bounded scans, authorization and DB outage isolation. Synthetic local files only; no runtime capacity measurement.');
 }finally{await fs.rm(temporary,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
