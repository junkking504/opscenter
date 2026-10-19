/** Local operator only. Never invoked by web requests, startup or deployment. */
import { controlPushTrial, readPushTrial, type TrialAction } from '../lib/web-push-trial';
import { resolveKernelDatabaseConfig } from '../lib/platform/persistence/config';
import { getKernelPool } from '../lib/platform/persistence/pool';
import { allowedSessionIdentity, opsAuthRole } from '../lib/auth';
import { opsRoleCan } from '../lib/ops-roles';
async function main() {
 const args=process.argv.slice(2),action=args.shift();
 const value=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
 const owner=value('--owner')||'';
 if(!['status','prepare','approve','revoke','start','stop'].includes(action||''))throw new Error('Use status, prepare, approve, revoke, start or stop. Mutations require --apply and --approval-reference.');
 const config=resolveKernelDatabaseConfig();
 if(process.env.OPSCENTER_RUNTIME!=='MISSION_CONTROL'||config.status!=='ready'||config.databaseName!=='opscenter_production')throw new Error('Explicit Mission Control production configuration is required.');
 if(process.env.OPSCENTER_WEB_PUSH_PRIVATE_KEY)throw new Error('Operator controls do not require signing secrets; use an environment without them.');
 if(action==='status'){if(!owner)throw new Error('--owner is required');console.log(JSON.stringify(await readPushTrial(owner)));return;}
 if(!args.includes('--apply')||!value('--approval-reference'))throw new Error('Explicit --apply and --approval-reference required; authorization must be obtained separately.');
 if(['prepare','approve','revoke'].includes(action!)&&(!allowedSessionIdentity(owner)||!opsRoleCan(opsAuthRole(owner),'sensitive.write')))throw new Error('Verified eligible owner identity required.');
 const input:TrialAction=action==='prepare'?{action,owner}:action==='approve'?{action,owner,deviceId:value('--device')||'',fingerprint:value('--fingerprint')||'',expiresInMinutes:Number(value('--expires-minutes'))}:action==='revoke'?{action,owner,deviceId:value('--device')||''}:{action:action as 'start'|'stop'};
 await controlPushTrial(input,value('--approval-reference')!);
 console.log(`Trial ${action} recorded. This command does not enable capture, sending or services.`);
}
main().catch(()=>{console.error('Trial control failed. Verify command, authorization and protected runtime configuration; no automatic retry.');process.exitCode=1;}).finally(async()=>{try{await getKernelPool().end();}catch{/* no configured pool */}});
