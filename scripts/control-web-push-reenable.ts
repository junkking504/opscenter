/** Explicit owner authorization only. Never run by startup, API or deployment. */
import { pushLease } from '../lib/web-push-runtime';
import { authorizePushReenable } from '../lib/web-push-reenable';
import { resolveKernelDatabaseConfig } from '../lib/platform/persistence/config';
import { getKernelPool } from '../lib/platform/persistence/pool';
import { allowedSessionIdentity, opsAuthRole } from '../lib/auth';
import { opsRoleCan } from '../lib/ops-roles';
async function main() {
  const args=process.argv.slice(2),value=(name:string)=>{const i=args.indexOf(name);return i>=0?args[i+1]:undefined;};
  const owner=value('--owner')||'',config=resolveKernelDatabaseConfig();
  if(process.env.OPSCENTER_RUNTIME!=='MISSION_CONTROL'||config.status!=='ready'||config.databaseName!=='opscenter_production'||process.env.OPSCENTER_WEB_PUSH_PRIVATE_KEY)throw Error('protected_configuration_required');
  if(!args.includes('--apply')||!args.includes('--handset-confirmed')||!allowedSessionIdentity(owner)||!opsRoleCan(opsAuthRole(owner),'sensitive.write'))throw Error('explicit_owner_authorization_required');
  if(!pushLease('send',undefined,undefined,undefined,true))throw Error('current_reenable_capable_sender_required');
  const result=await authorizePushReenable({owner,requestId:value('--request')||'',fingerprint:value('--fingerprint')||'',reference:value('--approval-reference')||'',handsetConfirmed:true});
  console.log(JSON.stringify(result));
}
main().catch((error)=>{console.error(error instanceof Error&&error.message==='current_reenable_capable_sender_required'?'Start the sender from the deployed recovery-capable release before authorization. No grant changed.':'Phone re-enable failed. Check exact request, fingerprint, expiry and owner authorization. No automatic retry.');process.exitCode=1;}).finally(async()=>{try{await getKernelPool().end();}catch{/* unavailable */}});
