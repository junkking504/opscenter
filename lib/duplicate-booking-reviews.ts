import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { duplicateBookings, type DuplicatePair, type DuplicateDecision } from '../desktop-ui/lib/duplicate-bookings';
import type { ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

const digest = (text:string) => createHash('sha256').update(text).digest('hex');
export const duplicateFingerprint = (pair:DuplicatePair) => digest(pair.signature);
const directory = () => process.env.OPSCENTER_DUPLICATE_REVIEWS_DIR || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'duplicate-booking-reviews');
const fileFor = (date:string,pair:DuplicatePair) => path.join(directory(),digest(date+pair.key)+'.json');
type Saved = DuplicateDecision & { fingerprint:string };
function read(file:string): Saved|null {
  try {
    const value=JSON.parse(fs.readFileSync(file,'utf8')) as Saved;
    if(!['keep_both','review'].includes(value.state)||!value.revision||!value.fingerprint||!value.actor||!value.at)throw Error('Invalid review record');
    return value;
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT')return null; throw error; }
}
export function readDuplicateReviews(date:string,jobs:ScheduleAppointment[]) {
  return duplicateBookings(jobs).map(pair=>{
    const fingerprint=duplicateFingerprint(pair), saved=read(fileFor(date,pair));
    return {key:pair.key,signature:pair.signature,fingerprint,decision:saved?.fingerprint===fingerprint ? {state:saved.state,actor:saved.actor,at:saved.at,revision:saved.revision}:null};
  });
}
export class DuplicateReviewConflict extends Error {}
export function saveDuplicateReview(input:{date:string;key:string;fingerprint:string;state:'keep_both'|'review';expectedRevision:string|null}, actor:string, current:()=>ScheduleAppointment[]) {
  const lock=path.join(directory(),digest(input.date+input.key)+'.lock');
  fs.mkdirSync(directory(),{recursive:true});
  let descriptor:number;
  try { descriptor=fs.openSync(lock,'wx',0o600); }
  catch(error) { if((error as NodeJS.ErrnoException).code==='EEXIST')throw new DuplicateReviewConflict('Another review is being saved. Refresh and try again.'); throw error; }
  try {
    const pair=duplicateBookings(current()).find(pair=>pair.key===input.key);
    if(!pair || duplicateFingerprint(pair)!==input.fingerprint)throw new DuplicateReviewConflict('The appointments changed. Review the current details before deciding.');
    const file=fileFor(input.date,pair),previous=read(file);
    const revision=previous?.fingerprint===input.fingerprint ? previous.revision : null;
    if(revision!==input.expectedRevision)throw new DuplicateReviewConflict('Another operator updated this review. Refresh before deciding.');
    const saved:Saved={fingerprint:input.fingerprint,state:input.state,actor,at:new Date().toISOString(),revision:randomUUID()};
    const temp=file+'.'+randomUUID()+'.tmp';
    try { fs.writeFileSync(temp,JSON.stringify(saved),{mode:0o600}); fs.renameSync(temp,file); }
    finally { if(fs.existsSync(temp))fs.unlinkSync(temp); }
    const verified=read(file);
    if(verified?.revision!==saved.revision)throw Error('Review read-back failed');
    return {key:input.key,signature:pair.signature,fingerprint:input.fingerprint,decision:{state:saved.state,actor:saved.actor,at:saved.at,revision:saved.revision}};
  } finally { fs.closeSync(descriptor);fs.unlinkSync(lock); }
}
