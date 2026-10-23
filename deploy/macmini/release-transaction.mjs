import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {pathToFileURL} from 'node:url';
import {DEPLOY_ROOT,SLOT_PORTS,SHA,privateDirectory,readPrivate,atomicPrivate,readSlot,releasePath,inventoryAssets,probeSlot,waitReady,validHealth,sleep} from './origin-state.mjs';

const exec=promisify(execFile);
const CONTROL='/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-control';
const terminalPhases=new Set(['accepted','retired','rolled-back','abandoned']);

export function controlRequest(stateDir,endpoint,input){
  return new Promise((resolve,reject)=>{
    const body=input===undefined?null:JSON.stringify(input);
    const req=http.request({socketPath:path.join(stateDir,'control.sock'),path:endpoint,method:body?'POST':'GET',headers:body?{'content-type':'application/json','content-length':Buffer.byteLength(body)}:{}},res=>{
      let text='';res.on('data',chunk=>{text+=chunk;if(text.length>1024*1024)req.destroy(new Error('Control response limit'));});res.on('error',reject);res.on('end',()=>{try{if(res.statusCode!==200)throw new Error('Control acknowledgement rejected');resolve(JSON.parse(text));}catch(error){reject(error);}});
    });
    const timer=setTimeout(()=>req.destroy(new Error('Control deadline')),25000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);req.end(body);
  });
}

export class ReleaseTransaction {
  constructor({root,stateDir,ports=SLOT_PORTS,hooks,ownerPid,observationMs=300000,intervalMs=5000}){
    Object.assign(this,{root,stateDir,ports,hooks,ownerPid,observationMs,intervalMs});
    this.journalFile=path.join(stateDir,'transaction.json');privateDirectory(stateDir);
  }
  journal(){return fs.existsSync(this.journalFile)?readPrivate(this.journalFile):null;}
  save(value,phase){const next={...value,ownerPid:this.ownerPid,workerPid:process.pid,phase,updatedAt:new Date().toISOString()};atomicPrivate(this.journalFile,next);this.hooks.phase?.(phase);return next;}
  slot(id){return readSlot(this.stateDir,id,{root:this.root,ports:this.ports});}
  async status(){
    const until=Date.now()+30000;
    do{
      const value=await this.hooks.control('/status');
      if(value.version!==1||!value.ledgerHealthy||!SHA.test(value.active?.sha))throw new Error('Proxy accounting unavailable');
      if(!value.activating)return value;
      await sleep(100);
    }while(Date.now()<until);
    throw new Error('Previous activation acknowledgement still pending');
  }
  async safeToStop(slot){
    const status=await this.status();if(status.active.sha===slot.sha)return false;
    const count=status.slots.find(row=>row.sha===slot.sha);
    if(count&&count.inFlight!==0)return false;
    if(!await this.hooks.running(slot))return true;
    const health=await this.hooks.probe(slot,{strict:false,assets:false});
    // A new instance proves the previous process is gone; a live instance is
    // still stopped only through native graceful shutdown below. That shutdown
    // waits for HTTP requests lost from proxy accounting as well as after work.
    return health.release.pending===0;
  }
  async retire(slot){
    try{
      const pinned=this.slot(slot.id);if(pinned.sha!==slot.sha)return false;slot=pinned;
      await this.hooks.control('/retire-streams',{sha:slot.sha});
      if(!await this.safeToStop(slot))return false;
      const status=await this.status();
      const proven={...slot,retirementProof:{generation:status.active.generation,checkedAt:new Date().toISOString()}};
      atomicPrivate(path.join(this.stateDir,`slot-${slot.id}.json`),proven);
      await this.hooks.stop(slot);
      if(await this.hooks.running(slot))return false;
      const processStoppedAt=new Date().toISOString();
      atomicPrivate(path.join(this.stateDir,`slot-${slot.id}.json`),{...proven,launchBlocked:true,retirementProof:{...proven.retirementProof,processStoppedAt},retiredAt:processStoppedAt});
      await this.hooks.control('/confirm-retired',{sha:slot.sha});return true;
    }catch{return false;}
  }
  remember(slot){
    const file=path.join(this.stateDir,'retained.json');
    const previous=fs.existsSync(file)?readPrivate(file):{version:1,releases:[]};
    if(previous.version!==1||!Array.isArray(previous.releases))throw new Error('Retained asset ledger invalid');
    atomicPrivate(file,{version:1,releases:[slot,...previous.releases.filter(row=>row.sha!==slot.sha)].slice(0,3)});
  }
  receipt(journal){
    const file=path.join(this.stateDir,'history.json');const previous=fs.existsSync(file)?readPrivate(file):{version:1,receipts:[]};
    if(previous.version!==1||!Array.isArray(previous.receipts))throw new Error('Cutover history invalid');
    if(previous.receipts.some(row=>row.sha===journal.sha&&row.generation===journal.generation&&row.phase===journal.phase))return;
    atomicPrivate(file,{version:1,receipts:[...previous.receipts,{sha:journal.sha,previousSha:journal.previous.sha,generation:journal.generation,phase:journal.phase,startedAt:journal.startedAt,switchedAt:journal.switchedAt,acceptedAt:journal.acceptedAt,updatedAt:journal.updatedAt,publicBlips:journal.publicBlips||[]}].slice(-100)});
  }
  async switchTo(slot,journal,phase){
    const current=await this.status();const generation=current.active.generation+1;
    journal=this.save({...journal,generation},`${phase}-intent`);
    atomicPrivate(path.join(this.stateDir,'active.json'),{version:1,generation,slot:slot.id,sha:slot.sha});
    journal=this.save(journal,`${phase}-manifest`);
    const ack=await this.hooks.control('/activate',{generation,sha:slot.sha});
    if(ack.active?.generation!==generation||ack.active.sha!==slot.sha||!ack.ledgerHealthy)throw new Error('Proxy acknowledged an unexpected generation');
    return this.save(journal,`${phase}-acknowledged`);
  }
  async recover(){
    let journal=this.journal();if(!journal)return;
    if(journal.version!==1||!SHA.test(journal.sha)||!journal.previous||!journal.candidate)throw new Error('Activation journal invalid');
    if(journal.servicePid){try{process.kill(journal.servicePid,0);throw new Error('Singleton lifecycle worker remains live');}catch(error){if(error.code!=='ESRCH')throw error;}}
    // Re-validate every path before any service or filesystem action.
    const primaryPin=this.slot(['accepted','retired'].includes(journal.phase)?journal.candidate.id:journal.previous.id);
    if(primaryPin.sha!==(['accepted','retired'].includes(journal.phase)?journal.sha:journal.previous.sha))throw new Error('Journal primary pin no longer matches');
    if(!['pin-intent','rolled-back','abandoned'].includes(journal.phase)){
      const pinned=this.slot(journal.candidate.id);if(pinned.sha!==journal.sha)throw new Error('Journal candidate pin no longer matches');
    }
    if(terminalPhases.has(journal.phase)){
      if(['accepted','retired'].includes(journal.phase)){
        const status=await this.status();if(status.active.sha!==journal.sha||this.hooks.linkSha()!==journal.sha)throw new Error('Accepted release identity needs reconciliation');
        this.remember(primaryPin);this.receipt(journal);
        if(journal.phase!=='retired'&&await this.retire(journal.previous))this.save(journal,'retired');
      }
      return;
    }
    await this.rollback(journal);
  }
  async rollback(journal=this.journal()){
    if(!journal||terminalPhases.has(journal.phase))return;
    const previous=this.slot(journal.previous.id);
    if(previous.sha!==journal.previous.sha)throw new Error('Rollback pin changed');
    await this.hooks.ready(previous);
    const status=await this.status();
    if(status.active.sha!==previous.sha)journal=await this.switchTo(previous,journal,'rollback');
    else atomicPrivate(path.join(this.stateDir,'active.json'),{version:1,generation:status.active.generation,slot:previous.id,sha:previous.sha});
    const changed=this.hooks.linkSha()!==previous.sha;
    this.hooks.link(previous);
    journal=this.save(journal,'rollback-linked');
    // Restart all singleton owners even if a crash happened halfway through.
    if(changed||journal.switchedAt)await this.hooks.services(previous);
    journal=this.save(journal,'rolled-back');
    await this.retire(journal.candidate);this.receipt(journal);
  }
  async deploy(sha){
    if(!SHA.test(sha))throw new Error('Invalid deployment SHA');
    await this.recover();
    const status=await this.status(),previous=this.slot(status.active.slot);
    if(previous.sha!==status.active.sha||this.hooks.linkSha()!==previous.sha)throw new Error('Active link and traffic disagree');
    if(previous.sha===sha)throw new Error('Release is already active');
    const id=previous.id==='a'?'b':'a';
    if(fs.existsSync(path.join(this.stateDir,`slot-${id}.json`))){
      const old=this.slot(id);if(!await this.retire(old))throw new Error('Inactive slot still has unresolved work; deployment deferred');
    }
    const release=releasePath(this.root,sha),identity=await this.hooks.expected(release);
    let candidate={version:1,id,sha,release,port:this.ports[id],...identity,assets:inventoryAssets(release)};
    let journal=this.save({version:1,ownerPid:this.ownerPid,sha,previous,candidate,startedAt:new Date().toISOString()},'pin-intent');
    atomicPrivate(path.join(this.stateDir,`slot-${id}.json`),candidate);
    journal=this.save(journal,'prepared');
    try{
      await this.hooks.start(candidate);const health=await this.hooks.ready(candidate);
      candidate={...candidate,instance:health.release.instance};atomicPrivate(path.join(this.stateDir,`slot-${id}.json`),candidate);
      journal=this.save({...journal,candidate},'warmed');
      await this.hooks.lineage(sha,previous.sha);
      candidate={...candidate,servedAt:new Date().toISOString()};atomicPrivate(path.join(this.stateDir,`slot-${id}.json`),candidate);
      journal=this.save({...journal,candidate},'traffic-intent');
      journal=await this.switchTo(candidate,journal,'switch');
      journal=this.save({...journal,switchedAt:new Date().toISOString()},'switched');
      this.hooks.link(candidate);journal=this.save(journal,'linked');
      await this.hooks.services(candidate);journal=this.save(journal,'services');
      await this.hooks.ready(candidate);
      let publicFailures=0;
      const samplePublic=async()=>{
        try{await this.hooks.publicProbe(candidate);publicFailures=0;}
        catch{
          publicFailures++;
          journal=this.save({...journal,publicBlips:[...(journal.publicBlips||[]),{at:new Date().toISOString(),consecutive:publicFailures}].slice(-20)},journal.phase);
          if(publicFailures>=3)throw new Error('Public readiness failed three consecutive checks');
        }
      };
      do{await samplePublic();if(publicFailures)await sleep(this.intervalMs);}while(publicFailures);
      journal=this.save(journal,'observing');
      const until=Date.now()+this.observationMs;let nextPublic=0;
      while(Date.now()<until){
        await this.hooks.probe(candidate,{strict:false,assets:false});
        if(Date.now()>=nextPublic){await samplePublic();nextPublic=Date.now()+30000;}
        await sleep(Math.min(this.intervalMs,Math.max(0,until-Date.now())));
      }
      journal=this.save({...journal,acceptedAt:new Date().toISOString()},'accepted');
      this.remember(candidate);this.receipt(journal);
      if(await this.retire(previous))journal=this.save(journal,'retired');
      return {sha,generation:journal.generation,retirement:journal.phase==='retired'?'complete':'deferred'};
    }catch(error){
      // A simulated/real hard crash leaves the durable journal for next start.
      if(!error.simulatedCrash)await this.rollback(this.journal());
      throw error;
    }
  }
}

export function recoverDeadActivationLock(root){
  const lock=path.join(root,'.deploy-lock'),ownerFile=path.join(lock,'owner');
  const info=fs.lstatSync(lock),ownerInfo=fs.lstatSync(ownerFile);
  if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==process.getuid()||!ownerInfo.isFile()||ownerInfo.isSymbolicLink()||ownerInfo.uid!==process.getuid()||ownerInfo.size>4096)throw new Error('Deployment lock identity unavailable');
  const matches=[...fs.readFileSync(ownerFile,'utf8').matchAll(/^pid=([1-9][0-9]*)$/gm)];if(matches.length!==1)throw new Error('Deployment lock PID invalid');
  const pid=Number(matches[0][1]);try{process.kill(pid,0);throw new Error('Deployment owner still live');}catch(error){if(error.code!=='ESRCH')throw error;}
  const journals=['transaction.json','bootstrap.json'].map(name=>path.join(root,'.release-slots',name)).filter(file=>fs.existsSync(file)).map(readPrivate);
  const journal=journals.find(value=>value.ownerPid===pid);
  if(!journal)throw new Error('Only a journaled activation owner can reclaim this dead lock');
  for(const child of [journal.workerPid,journal.servicePid].filter(Number.isSafeInteger)){
    try{process.kill(child,0);throw new Error('Activation child still live; lock retained');}catch(error){if(error.code!=='ESRCH')throw error;}
  }
  const current=fs.lstatSync(lock);if(current.ino!==info.ino||current.dev!==info.dev)throw new Error('Deployment lock changed');
  fs.renameSync(lock,path.join(root,`.deploy-lock.recovered-${Date.now()}-${pid}`)); // Preserve crash evidence.
}

function requireOwner(ownerPid){
  if(!Number.isSafeInteger(ownerPid)||ownerPid<2||process.env.HOME!=='/Users/missioncontrol')throw new Error('Invalid controller owner');
  const owner=fs.readFileSync(path.join(DEPLOY_ROOT,'.deploy-lock/owner'),'utf8');
  if(!owner.split('\n').includes(`pid=${ownerPid}`))throw new Error('Global deployment lock not owned');process.kill(ownerPid,0);
}
export function slotProcessOwner(stateDir,id){
  if(!['a','b'].includes(id))throw new Error('Invalid slot owner lookup');
  privateDirectory(stateDir);
  let fd;try{fd=fs.openSync(path.join(stateDir,`slot-${id}.lock`),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
  try{
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==process.getuid()||stat.nlink!==1||(stat.mode&0o077)!==0||stat.size>4096)throw new Error('Slot lock ownership invalid');
    const text=fs.readFileSync(fd,'utf8'),match=text.match(/^pid=([1-9][0-9]*)\nsha=([a-f0-9]{40})\n$/);
    if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])<2)throw new Error('Slot lock identity invalid');
    let alive=true;try{process.kill(Number(match[1]),0);}catch(error){if(error.code!=='ESRCH')throw error;alive=false;}
    const held=execFileSync('/usr/bin/python3',['-c',`import fcntl
try:
 fcntl.flock(3,fcntl.LOCK_EX|fcntl.LOCK_NB)
 print('free')
 fcntl.flock(3,fcntl.LOCK_UN)
except BlockingIOError:print('held')`],{stdio:['ignore','pipe','pipe',fd],encoding:'utf8',timeout:5000}).trim()==='held';
    if(alive&&!held)throw new Error('Live slot PID does not hold its lock; identity unverified');
    if(!alive&&held)throw new Error('Slot lock remains held by an unverified owner');
    return {pid:Number(match[1]),sha:match[2],alive,held};
  }finally{fs.closeSync(fd);}
}
export async function productionHooks(ownerPid){
  requireOwner(ownerPid);
  const stateDir=path.join(DEPLOY_ROOT,'.release-slots'),target=id=>`gui/${process.getuid()}/com.openclaw.opscenter.slot-${id}`;
  const command=async(args,timeout=25000)=>exec('/bin/launchctl',args,{timeout,maxBuffer:1024*1024});
  const inspect=async slot=>{try{return(await command(['print',target(slot.id)])).stdout;}catch(error){if(error.code===113)return '';throw error;}};
  const labelPid=info=>Number(info.match(/^\s*pid = ([1-9][0-9]*)\s*$/m)?.[1]||0);
  const running=async slot=>{
    const pid=labelPid(await inspect(slot)),owner=slotProcessOwner(stateDir,slot.id);
    if(!pid&&!owner&&slot.servedAt&&!slot.retiredAt)throw new Error('Served slot has no process ownership evidence');
    return Boolean(pid||owner?.alive);
  };
  return {
    control:(endpoint,input)=>controlRequest(stateDir,endpoint,input),probe:probeSlot,ready:slot=>waitReady(slot),running,
    linkSha:()=>path.basename(fs.realpathSync(path.join(DEPLOY_ROOT,'opscenter'))),
    link(slot){releasePath(DEPLOY_ROOT,slot.sha);const temporary=path.join(DEPLOY_ROOT,`.opscenter-slot-${process.pid}`);if(fs.existsSync(temporary))throw new Error('Activation temporary path exists');fs.symlinkSync(slot.release,temporary);fs.renameSync(temporary,path.join(DEPLOY_ROOT,'opscenter'));const fd=fs.openSync(DEPLOY_ROOT,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}},
    async expected(release){
      // Existing protected configuration, parsed without eval or printing secrets.
      const output=await exec('/usr/bin/python3',['-c',"import sys;sys.path.insert(0,sys.argv[1]);import importlib.util;from pathlib import Path;s=importlib.util.spec_from_file_location('isolation',Path(sys.argv[1])/'verify-kernel-isolation.py');m=importlib.util.module_from_spec(s);s.loader.exec_module(m);e=m.read_environment(m.CONFIG_DIR/'production.env');assert e.get('OPSCENTER_KERNEL_ENABLED')=='1';print(m.database_name(e,'OPSCENTER_MISSION_CONTROL_DATABASE_URL'))",CONTROL],{timeout:5000});
      const migration=fs.readdirSync(path.join(release,'lib/platform/persistence/migrations')).filter(name=>/^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort().at(-1);
      return {database:output.stdout.trim(),migration};
    },
    async start(slot){
      if(await inspect(slot))throw new Error('Candidate label remains loaded');
      await command(['enable',target(slot.id)]);
      await command(['bootstrap',`gui/${process.getuid()}`,path.join('/Users/missioncontrol/Library/LaunchAgents',`com.openclaw.opscenter.slot-${slot.id}.plist`)]);
    },
    async stop(slot){
      const info=await inspect(slot),owner=slotProcessOwner(stateDir,slot.id);
      if(owner?.alive&&(owner.pid!==labelPid(info)||owner.sha!==slot.sha))throw new Error('Unexpected or orphaned slot process; no signal sent');
      if(!info){if(slot.servedAt&&!slot.retiredAt&&!owner)throw new Error('Slot exit is unverified');return;}
      const match=info.match(/^\s*pid = ([1-9][0-9]*)\s*$/m);
      const pinned=readSlot(stateDir,slot.id);if(pinned.sha!==slot.sha)throw new Error('Slot pin changed before stop');
      atomicPrivate(path.join(stateDir,`slot-${slot.id}.json`),{...pinned,launchBlocked:true});
      await command(['disable',target(slot.id)]);
      if(match){
        const pid=Number(match[1]);process.kill(pid,'SIGTERM');
        const deadline=Date.now()+20000;let alive=true;
        while(alive&&Date.now()<deadline){try{process.kill(pid,0);await sleep(250);}catch(error){if(error.code!=='ESRCH')throw error;alive=false;}}
        if(alive)throw new Error('Slot is still gracefully draining; no forced stop');
      }
      if(slotProcessOwner(stateDir,slot.id)?.alive)throw new Error('Slot process remains or changed; no forced stop');
      const until=Date.now()+5000;
      while(labelPid(await inspect(slot))&&Date.now()<until)await sleep(100);
      if(labelPid(await inspect(slot)))throw new Error('Slot guard wrapper remains active; cleanup deferred');
      // A future launch is blocked before secrets/server startup. bootout is
      // deliberately never used on a business-serving PID on this macOS host.
      if(await inspect(slot))await command(['bootout',target(slot.id)]);
    },
    async services(slot){
      await new Promise((resolve,reject)=>{
        const child=execFile('/bin/zsh',[path.join(CONTROL,'release-services.sh'),slot.release,String(ownerPid)],{maxBuffer:4*1024*1024,env:process.env},error=>error?reject(error):resolve());
        try{
          const file=path.join(stateDir,'transaction.json');const journal=readPrivate(file);
          atomicPrivate(file,{...journal,servicePid:child.pid});
          child.stdin.end('start-owned-services\n');
        }catch(error){child.stdin.end();reject(error);}
      });
    },
    async lineage(sha,previous){
      const git=async args=>(await exec('/usr/bin/git',['-C',path.join(DEPLOY_ROOT,'repository'),...args],{timeout:30000})).stdout.trim();
      await git(['fetch','origin']);if(await git(['rev-parse','origin/production'])!==sha)throw new Error('Production moved during warmup');
      const active=path.basename(fs.realpathSync(path.join(DEPLOY_ROOT,'opscenter')));if(active!==previous)throw new Error('Active release changed during warmup');
      await git(['merge-base','--is-ancestor',active,sha]);
    },
    async publicProbe(slot){
      const result=await new Promise((resolve,reject)=>{
        const req=https.get('https://ops.junk-king.app/api/health?readiness=primary',res=>{let body='';res.on('data',chunk=>{body+=chunk;if(body.length>1024*1024)req.destroy(new Error('Public health response limit'));});res.on('error',reject);res.on('end',()=>{try{resolve({status:res.statusCode,health:JSON.parse(body)});}catch(error){reject(error);}});});
        const timer=setTimeout(()=>req.destroy(new Error('Public readiness deadline')),15000);req.on('close',()=>clearTimeout(timer));req.on('error',reject);
      });
      if(result.status!==200||!validHealth(result.health,slot,false))throw new Error('Public release readiness rejected');
    },
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(fs.realpathSync(process.argv[1])).href){
  if(process.argv[2]==='--help'){console.log('OpsCenter release-transaction CLI');process.exit(0);}
  const [operation,value,owner]=process.argv.slice(2);
  if(operation==='recover-lock'){recoverDeadActivationLock(DEPLOY_ROOT);}
  else{
    const enabled=readPrivate(path.join(DEPLOY_ROOT,'.release-slots/enabled.json'));
    if(enabled.version!==1||enabled.enabled!==true)throw new Error('Slot deployment mode is not enabled');
    const ownerPid=Number(owner);const hooks=await productionHooks(ownerPid);
    const transaction=new ReleaseTransaction({root:DEPLOY_ROOT,stateDir:path.join(DEPLOY_ROOT,'.release-slots'),hooks,ownerPid});
    if(operation==='recover'){await transaction.recover();console.log('Activation journal reconciled.');}
    else if(operation==='deploy'){console.log(JSON.stringify(await transaction.deploy(value)));}
    else throw new Error('Unknown transaction operation');
  }
}
