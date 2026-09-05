import { execFileSync } from 'node:child_process';
import { drainLinxupPushes, linxupDataRoot } from '../lib/linxup-push-queue';

const root=linxupDataRoot();
const result=drainLinxupPushes(root,(file,receivedAt)=>{
  const output=execFileSync(process.execPath,['--import','tsx','scripts/ingest-linxup-push.ts','--payload-file',file,'--received-at',receivedAt],{
    cwd:process.cwd(),env:{...process.env,OPSCENTER_DATA_DIR:root},stdio:['ignore','pipe','pipe'],timeout:10_000,
  });
  const parsed=JSON.parse(output.toString());
  if(!parsed.normalized || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.serviceDate)) throw new Error('Normalization did not complete');
  return parsed.serviceDate as string;
});
if(result.failed) console.error(`LinxUp queue: ${result.failed} entries retained for retry.`);
console.log(process.argv.includes('--dates')?result.dates.join('\n'):JSON.stringify(result));
