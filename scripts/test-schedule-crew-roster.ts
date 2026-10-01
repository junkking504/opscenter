import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {readScheduleCrewRoster,saveScheduleCrewRoster,morningCrewRoster} from '../lib/schedule-crew-roster';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'crew-roster-test-'));process.env.OPS_CREW_ROSTER_DIR=dir;
try{
 assert.equal(readScheduleCrewRoster('2026-10-02').savedAt,null);
 const entries=[{name:'Crew A',status:'scheduled',truck:'Truck 1',startTime:'07:30'},{name:'Crew B',status:'off',truck:'',startTime:''}];
 const saved=saveScheduleCrewRoster('2026-10-02',0,entries,'test',['Crew A','Crew B']);assert.equal(saved.version,1);assert.equal(saved.actor,'test');assert.deepEqual(readScheduleCrewRoster('2026-10-02'),saved);
 assert.equal(readScheduleCrewRoster('2026-10-01').version,0);assert.equal(morningCrewRoster('2026-10-02').entries.length,1);
 assert.throws(()=>saveScheduleCrewRoster('2026-10-02',0,entries,'test',['Crew A','Crew B']),/changed/);
 assert.throws(()=>saveScheduleCrewRoster('2026-10-03',0,[entries[0],entries[0]],'test',['Crew A']),/once/);
 assert.throws(()=>saveScheduleCrewRoster('2026-10-03',0,[{...entries[0],startTime:''}],'test',['Crew A']),/start time/);
 assert.throws(()=>readScheduleCrewRoster('../escape'),/valid/);assert.throws(()=>readScheduleCrewRoster('2026-02-30'),/valid/);
 assert.throws(()=>saveScheduleCrewRoster('2026-10-03',0,[{...entries[0],truck:'Truck 99'}],'test',['Crew A']),/truck/);
 const unassigned=saveScheduleCrewRoster('2026-10-03',0,[{...entries[0],truck:''}],'test',['Crew A']);assert.equal(unassigned.entries[0].truck,'');
 console.log('Crew roster persistence, date isolation, attendance, conflicts and validation passed.');
}finally{fs.rmSync(dir,{recursive:true,force:true});}
