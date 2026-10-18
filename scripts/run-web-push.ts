import { startPushDispatcher } from '../lib/web-push-dispatcher';
import { pushEnabled } from '../lib/web-push-policy';
async function main(){
  if(!pushEnabled()){console.log('Web Push disabled; no source, database or network access.');return;}
  // Source producer integration remains blocked: overwritten snapshots do not
  // retain every event. Fail closed rather than silently advertise live coverage.
  throw new Error('canonical_producer_integration_required');
}
// Export the prepared listener for explicit in-process integration and local tests.
export { startPushDispatcher };
main().catch(error=>{console.error(error instanceof Error?error.message:'push_dispatcher_failed');process.exitCode=1;});
