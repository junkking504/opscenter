import assert from "node:assert/strict";
import { searchGlobalIndex,orderSearchDates,scopeSearchResults,jobResult,availableScheduleSearchDates, type GlobalSearchResult } from "../lib/global-search";
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const index: GlobalSearchResult[] = [
  { id: "job:1", type: "job", title: "Ada Customer · JK4069000", subtitle: "Today", source: "JunkWare appointment", href: "/jobs?q=JK4069000", searchText: "Ada Customer JK4069000 5045550100 Truck 9" },
  { id: "job:2", type: "job", title: "Other Customer · JK4099999", subtitle: "Today", source: "JunkWare appointment", href: "/jobs?q=JK4099999", searchText: "Other Customer JK4099999 5045550101 Truck 1" },
  { id: "crew:1", type: "crew", title: "Devin Operator", subtitle: "Clocked in · Truck 9", source: "OpsCenter Krewe snapshot", href: "/crew", searchText: "Devin Operator Truck 9 clocked in" },
  { id: "truck:9", type: "truck", title: "Truck# 9", subtitle: "Live GPS · Devin Operator", source: "Linxup fleet", href: "/fleet?view=daily&section=map&truck=9", searchText: "Truck 9 Devin Operator Louisiana Plate" },
];

assert.deepEqual(searchGlobalIndex(index, "JK4069000").map((result) => result.id), ["job:1"]);
assert.deepEqual(searchGlobalIndex(index, "Devin").map((result) => result.id), ["crew:1", "truck:9"]);
assert.deepEqual(searchGlobalIndex(index, "truck 9").map((result) => result.id), ["truck:9", "job:1", "crew:1"]);
assert.ok(!searchGlobalIndex(index, "truck 9").some((result) => result.id === "job:2"));
assert.equal(searchGlobalIndex(index, "truck 9")[0]?.href, "/fleet?view=daily&section=map&truck=9");
assert.deepEqual(searchGlobalIndex(index, "missing"), []);
assert.deepEqual(searchGlobalIndex(index, "x"), []);

console.log("Global cross-entity search contracts passed.");

const today='2026-09-08';
assert.deepEqual(orderSearchDates(['2026-09-09',today,'2026-08-31','2026-09-07','2026-09-09','2026-02-30','bad'],today),[today,'2026-09-09','2026-09-07','2026-08-31']);
const row={appointmentId:'12345',jkNumber:'JK1000123',customerName:'Synthetic Customer',phone:'(504) 555-0100',address:'100 Example Road',appointmentTime:'9:00–10:00 AM',appointmentType:'Estimate',status:'Confirmed',truck:'Truck 2'};
const dated=[jobResult(row,today)!,jobResult({...row,appointmentId:'12346'},'2026-09-09')!,jobResult(row,'2026-08-31')!,index[2]];
assert.deepEqual(scopeSearchResults(dated,'upcoming',today).map(r=>r.appointmentDate),[today,'2026-09-09',undefined]);
assert.deepEqual(scopeSearchResults(dated,'past',today).map(r=>r.appointmentDate),['2026-08-31',undefined]);
assert.equal(scopeSearchResults(dated,'all',today).length,4);
assert.equal(searchGlobalIndex(dated,'5045550100').length,3);
assert.equal(searchGlobalIndex(dated,'JK1000123').length,3,'A JK number must not collapse dates or appointment identities');
assert.ok(dated[1].subtitle.includes('2026-09-09')&&dated[1].subtitle.includes('Estimate')&&dated[1].subtitle.includes('Truck 2'));
assert.ok(dated[1].href.includes('date=2026-09-09')&&dated[1].href.includes('appointment=12346'));
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'search-dates-test-'));
try{
 const history=path.join(dir,'history','junkware');fs.mkdirSync(path.join(history,'schedule-watchers','352'),{recursive:true});
 for(const file of ['junkware_schedule_requested_2026-09-09.json','junkware_2026-08-31_raw.json','junkware_live_2026-09-08_summary.csv','junkware_2026-09-10_raw.json.backup'])fs.writeFileSync(path.join(history,file),'{}');
 fs.writeFileSync(path.join(history,'schedule-watchers','352','junkware_schedule_fast_2026-09-11.json'),'{}');
 assert.deepEqual(availableScheduleSearchDates(dir).sort(),['2026-08-31','2026-09-08','2026-09-09','2026-09-11']);
}finally{fs.rmSync(dir,{recursive:true,force:true});}
console.log('Cross-date search passed: today-inclusive Upcoming, Past, All, date discovery, distinct identities, phone search and exact dated links.');
