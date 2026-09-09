import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSourceEstimates, sourceEstimateFromRow } from '../lib/schedule-source-estimate';

const photo = {url:'https://junkware.junk-king.com/system/aspnet/local/media/2026-08/example-123-before.jpg'};
const row = {appt_id:'123',job_id:'JK100',appointment_type:'Estimate',appointment_date:'2026-08-18',collection_timestamp:'2026-08-18T18:00:00Z',closeout:{total:'$1,200.00',loadQuantity:'1',loadSize:'Full truck'},photos:[photo,photo,{url:'https://untrusted.example/photo.jpg'}]};
assert.equal(sourceEstimateFromRow(row,'2026-08-18')?.total,1200);
assert.equal(sourceEstimateFromRow(row,'2026-08-18')?.photos.length,1);
assert.equal(sourceEstimateFromRow({...row,closeout:{total:''}},'2026-08-18')?.total,null);
assert.equal(sourceEstimateFromRow({...row,closeout:{total:'$0.00'}},'2026-08-18')?.total,0);
assert.equal(sourceEstimateFromRow({...row,appointment_type:'Job'},'2026-08-18'),null);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'source-estimate-test-'));
try {
  const history=path.join(dir,'history/junkware');fs.mkdirSync(history,{recursive:true});
  const file=path.join(history,'junkware_2026-08-18_raw.json');
  fs.writeFileSync(file,JSON.stringify({appointments:[row]}));
  const quotes=readSourceEstimates(['123','999'],'2026-09-09',dir);
  assert.equal(quotes.get('123')?.jkNumber,'JK100');assert.equal(quotes.has('999'),false);
  assert.equal(readSourceEstimates(['JK100'],'2026-09-09',dir).size,0,'JK identity cannot link estimates');
  assert.equal(readSourceEstimates(['123'],'2026-08-17',dir).size,0,'future estimates not inherited');
  fs.writeFileSync(file,JSON.stringify({appointments:[{...row,closeout:{total:'$1,350.00'}}]}));
  assert.equal(readSourceEstimates(['123'],'2026-09-09',dir).get('123')?.total,1350,'archive refresh invalidates cache');
  fs.writeFileSync(file,'invalid');
  assert.equal(readSourceEstimates(['123'],'2026-09-09',dir).size,0,'unreadable archive cannot reuse stale quote');
} finally { fs.rmSync(dir,{recursive:true,force:true}); }
console.log('Source estimate: exact ID, cross-date quote/photos, safe media, unavailable/zero, refreshed archive PASS');
