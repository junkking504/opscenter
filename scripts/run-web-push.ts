import { pushEnabled } from '../lib/web-push-policy';
import { readPushBatches } from '../lib/web-push-events';
import { runPushWorker } from '../lib/web-push-worker';
async function main() {
  if(!pushEnabled()){console.log('Web Push disabled; no source, database or network access.');return;}
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  console.log(await runPushWorker(await readPushBatches(date)));
}
main().catch(()=>{console.error('Web Push stopped. Review private receipts; no automatic retry.');process.exitCode=1;});
