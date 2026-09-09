import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {truckSlackChannelId} from './slack-truck-channels';
import {chicagoDateKey} from './report-dates';

/** Existing closeout delivery receipts bound completion from above. No network calls. */
export function readTruckCompletionEvidence(date: string, jobs: Array<{appointmentId:string;truck:string}>, dataDir = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data')): Map<string,string> {
  const read = (file:string) => {try {return JSON.parse(fs.readFileSync(file,'utf8'));} catch {return null;}};
  const main = read(path.join(dataDir,'slack','ops_alert_state.json'))?.closeoutMessages || {};
  const result = new Map<string,string>();
  for (const job of jobs) {
    if (!/^\d{1,12}$/.test(job.appointmentId)) continue;
    const channel = truckSlackChannelId(job.truck,'');
    if (!channel) continue;
    const key = `job_closed:${date}:appt-${job.appointmentId}`;
    const fast = read(path.join(dataDir,'slack','closeout-receipts',`${createHash('sha256').update(key).digest('hex')}.json`));
    const stamps = [main[key],fast].filter(receipt=>receipt?.channelId===channel && /^\d{10}\.\d{1,6}$/.test(String(receipt.ts)))
      .map(receipt=>Number(receipt.ts)*1000).filter(stamp=>Number.isFinite(stamp) && stamp<=Date.now() && chicagoDateKey(new Date(stamp))===date);
    if (stamps.length) result.set(job.appointmentId,new Date(Math.min(...stamps)).toISOString());
  }
  return result;
}
