/** One-time, separately reviewed migration. Never force-stop uncertain work. */
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {DEPLOY_ROOT,SLOT_PORTS,privateDirectory,atomicPrivate,readPrivate,readSlot,inventoryAssets,releasePath,waitReady,probeSlot,sleep} from './origin-state.mjs';
import {productionHooks,controlRequest,recoverDeadActivationLock} from './release-transaction.mjs';
const exec=promisify(execFile);
export function outsideDispatch(date=new Date()){
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',hour:'2-digit',hourCycle:'h23'}).format(date));
  return hour>=18||hour<7;
}
export class Bootstrap {
  constructor({root,stateDir,hooks,ownerPid,ports=SLOT_PORTS}){Object.assign(this,{root,stateDir,hooks,ownerPid,ports});this.file=path.join(stateDir,'bootstrap.json');}
  read(){return fs.existsSync(this.file)?readPrivate(this.file):null;}
  save(j,phase){const next={...j,version:1,ownerPid:this.ownerPid,workerPid:process.pid,phase,updatedAt:new Date().toISOString()};atomicPrivate(this.file,next);this.hooks.phase?.(phase);return next;}
  async prepare(){
    if(this.read())throw new Error('Bootstrap already journaled; inspect or roll back before another preparation');
    const sha=this.hooks.linkSha(),release=releasePath(this.root,sha);
    await this.hooks.lineage(sha,sha);
    const legacy=await this.hooks.legacyIdentity();
    let j=this.save({sha,legacy,startedAt:new Date().toISOString()},'preparing');
    await this.hooks.installPlists();
    let slot={version:1,id:'a',port:this.ports.a,sha,release,...await this.hooks.expected(release),assets:inventoryAssets(release)};
    atomicPrivate(path.join(this.stateDir,'slot-a.json'),slot);
    await this.hooks.start(slot);const health=await this.hooks.ready(slot);
    slot={...slot,instance:health.release.instance};atomicPrivate(path.join(this.stateDir,'slot-a.json'),slot);
    atomicPrivate(path.join(this.stateDir,'retained.json'),{version:1,releases:await this.hooks.retainedAssets?.(slot)||[slot]});
    j=this.save({...j,slot},'prepared');return j;
  }
  async activate(){
    if(!this.hooks.outsideDispatch())throw new Error('First proxy bootstrap is restricted to after 18:00 or before 07:00 Central');
    let j=this.read();if(j?.phase!=='prepared')throw new Error('Bootstrap is not prepared');
    await this.hooks.lineage(j.sha,j.sha);await this.hooks.ready(j.slot);
    await this.hooks.assertLegacy(j.legacy);
    try{
      j=this.save(j,'legacy-stop-intent');await this.hooks.stopLegacy(j.legacy);
      await this.hooks.portFree();j=this.save(j,'listener-free');
      const slot={...j.slot,servedAt:new Date().toISOString()};atomicPrivate(path.join(this.stateDir,'slot-a.json'),slot);
      atomicPrivate(path.join(this.stateDir,'active.json'),{version:1,generation:1,slot:'a',sha:j.sha});
      j=this.save({...j,slot},'proxy-start-intent');await this.hooks.startProxy();
      const status=await this.hooks.proxyStatus();
      if(status.active?.sha!==j.sha||status.active.generation!==1||!status.ledgerHealthy)throw new Error('Bootstrap proxy identity rejected');
      await this.hooks.publicProbe(slot);j=this.save(j,'verified');
      atomicPrivate(path.join(this.stateDir,'enabled.json'),{version:1,enabled:true,bootstrapSha:j.sha});
      j=this.save(j,'complete');await this.hooks.unloadDeadLegacy(j.legacy);return j;
    }catch(error){await this.rollback();throw error;}
  }
  async rollback(){
    let j=this.read();if(!j)throw new Error('No bootstrap journal');
    if(this.hooks.linkSha()!==j.sha)throw new Error('Bootstrap rollback cannot undo a later deployment');
    if(j.phase==='rolled-back')return j;
    // Keep the warmed slot alive while a submitted proxy request finishes.
    j=this.save(j,'rollback-intent');
    await this.hooks.stopProxy(j.sha);await this.hooks.portFreeOrLegacy(j.legacy);
    await this.hooks.restoreLegacy(j.legacy);
    await this.hooks.verifyLegacy(j.sha);
    atomicPrivate(path.join(this.stateDir,'enabled.json'),{version:1,enabled:false,bootstrapSha:j.sha});
    j=this.save(j,'rolled-back');
    // Cleanup can be deferred. The manifest/process remain retention references.
    try{await this.hooks.retirePreparedSlot(j.slot||readSlot(this.stateDir,'a',{root:this.root,ports:this.ports}));}catch{}
    return j;
  }
}

async function realHooks(ownerPid,stateDir){
  const base=await productionHooks(ownerPid),domain=`gui/${process.getuid()}`;
  const old='com.openclaw.opscenter',proxy='com.openclaw.opscenter.origin-proxy';
  const launchRoot='/Users/missioncontrol/Library/LaunchAgents';
  const command=async args=>exec('/bin/launchctl',args,{timeout:25000,maxBuffer:1024*1024});
  const inspect=async label=>{try{return(await command(['print',`${domain}/${label}`])).stdout;}catch(error){if(error.code===113)return '';throw error;}};
  const pid=text=>Number(text.match(/^\s*pid = ([1-9][0-9]*)\s*$/m)?.[1]||0);
  const alive=number=>{if(!number)return false;try{process.kill(number,0);return true;}catch(error){if(error.code==='ESRCH')return false;throw error;}};
  const waitFor=async(test,label,timeout=120000)=>{const end=Date.now()+timeout;do{if(await test())return;await sleep(250);}while(Date.now()<end);throw new Error(label+' remains busy; no forced stop');};
  const listeners=async()=>{try{return(await exec('/usr/sbin/lsof',['-nP','-t','-a','-iTCP:3000','-sTCP:LISTEN'],{timeout:5000})).stdout.trim().split('\n').filter(Boolean).map(Number);}catch(error){if(error.code===1&&!error.stdout)return [];throw error;}};
  const portFree=()=>waitFor(async()=>!(await listeners()).length,'Port 3000',15000);
  return {...base,outsideDispatch,portFree,
    async retainedAssets(slot){
      const history='/Users/missioncontrol/Library/Application Support/OpsCenter/deployment-history.tsv';
      const records=fs.readFileSync(history,'utf8').trim().split('\n').reverse(),releases=[slot];
      for(const line of records){
        for(const sha of line.split('\t').slice(1,3)){
          if(releases.some(row=>row.sha===sha)||! /^[a-f0-9]{40}$/.test(sha))continue;
          try{const release=releasePath(DEPLOY_ROOT,sha);releases.push({...slot,sha,release,assets:inventoryAssets(release)});}catch{continue;}
          if(releases.length===3)return releases;
        }
      }
      return releases;
    },
    async legacyIdentity(){const current=pid(await inspect(old));const owner=await listeners();if(!current||owner.length!==1||owner[0]!==current)throw new Error('Legacy listener identity unavailable');return {pid:current,label:old};},
    async assertLegacy(identity){if(pid(await inspect(old))!==identity.pid||(await listeners()).join()!==String(identity.pid))throw new Error('Legacy process changed since preparation');},
    async installPlists(){
      const source=path.join(path.dirname(fileURLToPath(import.meta.url)),'production-launchd');
      const backup=path.join(stateDir,'launchd-backup');fs.mkdirSync(backup,{mode:0o700});privateDirectory(backup);
      const legacyFile=path.join(launchRoot,old+'.plist');
      const legacyStat=fs.lstatSync(legacyFile);if(!legacyStat.isFile()||legacyStat.isSymbolicLink()||legacyStat.uid!==process.getuid())throw new Error('Legacy plist identity unavailable');
      fs.copyFileSync(legacyFile,path.join(backup,old+'.plist'),fs.constants.COPYFILE_EXCL);fs.chmodSync(path.join(backup,old+'.plist'),0o600);
      for(const label of ['com.openclaw.opscenter.slot-a','com.openclaw.opscenter.slot-b',proxy]){
        const destination=path.join(launchRoot,label+'.plist');if(fs.existsSync(destination)||await inspect(label))throw new Error('New launch label already exists');
        await command(['disable',`${domain}/${label}`]);
        const bytes=fs.readFileSync(path.join(source,label+'.plist'));const fd=fs.openSync(destination,'wx',0o644);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      }
    },
    async stopLegacy(identity){await command(['disable',`${domain}/${old}`]);process.kill(identity.pid,'SIGTERM');},
    async unloadDeadLegacy(identity){if(!alive(identity.pid)&&await inspect(old))await command(['bootout',`${domain}/${old}`]);},
    async startProxy(){await command(['enable',`${domain}/${proxy}`]);await command(['bootstrap',domain,path.join(launchRoot,proxy+'.plist')]);await waitFor(async()=>{try{return (await controlRequest(stateDir,'/status')).ledgerHealthy;}catch{return false;}},'Proxy readiness',30000);},
    proxyStatus:()=>controlRequest(stateDir,'/status'),
    async stopProxy(sha){
      const info=await inspect(proxy);if(!info)return;
      const current=pid(info);if(current){const status=await controlRequest(stateDir,'/status');if(status.active?.sha!==sha)throw new Error('Proxy serves a later release');}
      await command(['disable',`${domain}/${proxy}`]);if(current)process.kill(current,'SIGTERM');
      // Graceful proxy exits only after HTTP, submitted work, and tracked after work.
      // Releasing :3000 is enough to restore the legacy listener in the meantime.
    },
    async portFreeOrLegacy(identity){await waitFor(async()=>{const rows=await listeners();return !rows.length||rows.join()===String(identity.pid);},'Port 3000 handback',15000);},
    async restoreLegacy(identity){
      const current=pid(await inspect(old));
      if(current===identity.pid&&(await listeners()).join()===String(identity.pid)){await command(['enable',`${domain}/${old}`]);return;}
      await waitFor(()=>!alive(identity.pid),'Original app drain');
      if(await inspect(old))await command(['bootout',`${domain}/${old}`]);
      const file=path.join(launchRoot,old+'.plist'),backup=path.join(stateDir,'launchd-backup',old+'.plist');
      if(!fs.readFileSync(file).equals(fs.readFileSync(backup)))throw new Error('Legacy plist differs from backed-up setup');
      await command(['enable',`${domain}/${old}`]);await command(['bootstrap',domain,file]);
    },
    async verifyLegacy(sha){const release=releasePath(DEPLOY_ROOT,sha), slot={sha,release,port:3000,...await base.expected(release)};await waitReady(slot);await base.publicProbe(slot);},
    async retirePreparedSlot(slot){
      const proxyPid=pid(await inspect(proxy));if(alive(proxyPid))throw new Error('Proxy still draining');
      const health=await probeSlot(slot,{strict:false,assets:false});if(health.release.pending!==0||health.release.instance!==slot.instance)throw new Error('Slot still has work');
      await base.stop(slot);atomicPrivate(path.join(stateDir,`slot-${slot.id}.json`),{...slot,retiredAt:new Date().toISOString()});
      if(await inspect(proxy))await command(['bootout',`${domain}/${proxy}`]);
    },
  };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const operation=process.argv[2];if(!['prepare','activate','rollback'].includes(operation))throw new Error('Use prepare, activate or rollback');
  if(process.env.HOME!=='/Users/missioncontrol')throw new Error('Mission Control only');
  const lock=path.join(DEPLOY_ROOT,'.deploy-lock');
  if(fs.existsSync(lock))recoverDeadActivationLock(DEPLOY_ROOT);
  fs.mkdirSync(lock,{mode:0o700});
  fs.writeFileSync(path.join(lock,'owner'),`pid=${process.pid}\noperation=proxy-bootstrap\n`,{flag:'wx',mode:0o600});
  try{
    const stateDir=path.join(DEPLOY_ROOT,'.release-slots');if(!fs.existsSync(stateDir))fs.mkdirSync(stateDir,{mode:0o700});privateDirectory(stateDir);
    const bootstrap=new Bootstrap({root:DEPLOY_ROOT,stateDir,hooks:await realHooks(process.pid,stateDir),ownerPid:process.pid});
    const result=await bootstrap[operation]();console.log(JSON.stringify({phase:result.phase,sha:result.sha,updatedAt:result.updatedAt}));
  }finally{fs.unlinkSync(path.join(lock,'owner'));fs.rmdirSync(lock);}
}
