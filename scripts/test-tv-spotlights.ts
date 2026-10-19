import assert from 'node:assert/strict';
import { fixtureSnapshot } from './fixtures/crew-progress';
import { tvTruckStandings, tvPersonalRecords } from '../desktop-ui/lib/tv-spotlights';
import { curatedTvCards } from '../lib/tv-spotlights';
import type { DesktopKreweSnapshot } from '../desktop-ui/lib/people-fleet-contract';

const snapshot = fixtureSnapshot();
const completed = snapshot.crewProgress!.jobs.find(job => job.completion.total)!;
completed.status = 'Completed Duration: 65 min(s)';
completed.completion.total = '$450.00';
assert.deepEqual(tvTruckStandings(snapshot).map(row => [row.jobs,row.revenue,row.average]), [[1,450,450]]);
snapshot.crewProgress!.jobs.push(completed);
assert.equal(tvTruckStandings(snapshot)[0].jobs,1,'Duplicate source job cannot add revenue');
delete completed.completion.total;
assert.equal(tvTruckStandings(snapshot)[0].revenue,null,'Missing prices do not become zero');
snapshot.crewProgress!.scheduleCurrent=false;
assert.deepEqual(tvTruckStandings(snapshot),[],'Stale schedule cannot establish standings');

const history = {date:'2026-10-19',start:'2026-10-01',missingDates:[],members:[{id:'a',name:'Example teammate',days:[{date:'2026-10-18',revenue:100},{date:'2026-10-19',revenue:200}]}]} as unknown as DesktopKreweSnapshot;
assert.equal(tvPersonalRecords(history,'2026-10-19').length,1);
history.missingDates.push('2026-10-01');
assert.equal(tvPersonalRecords(history,'2026-10-19').length,0);
history.missingDates=[];
history.members[0].days[0].revenue=null;
assert.equal(tvPersonalRecords(history,'2026-10-19').length,0,'Unknown baseline cannot establish a record');
assert.equal(tvPersonalRecords(history,'2026-10-20').length,0);

const celebration={kind:'birthday',title:'Happy birthday!',body:'A great teammate.',start:'2026-10-19',end:'2026-10-19'};
assert.equal(curatedTvCards([celebration],'2026-10-19').length,1);
assert.equal(curatedTvCards([celebration],'2026-10-20').length,0,'Expired celebrations disappear');
assert.equal(curatedTvCards([{...celebration,start:'2026-02-30'}],'2026-10-19').length,0);
const before='https://junkware.junk-king.com/system/aspnet/local/media/2026-09/test-4075431-unique-before.jpg';
const paired=curatedTvCards([{...celebration,kind:'win',appointmentId:'4075431',before,after:before.replace('before','after')}],'2026-10-19')[0];
assert.ok(paired.before&&paired.after);
assert.equal(curatedTvCards([{...celebration,before:'https://evil.example/a.jpg',after:before}],'2026-10-19')[0].before,undefined);
console.log('The Huddle: completed-job authority, missing values, deduplication, personal-record coverage and dated curated-media validation passed.');
