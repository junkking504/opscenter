import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const blocked=/(?:maps|routes|roads|tile)\.googleapis\.com|@googlemaps\/|load_opscenter_keychain_secret\s+GOOGLE_MAPS/;
const violations=[];
function scan(dir){
 for(const item of fs.readdirSync(dir,{withFileTypes:true})){
  if(['node_modules','.next','.git'].includes(item.name))continue;
  const file=path.join(dir,item.name);
  if(item.isDirectory())scan(file);
  else if(/\.(?:ts|tsx|js|mjs|py|sh)$/.test(item.name) && item.name!=='test-no-google-map-billing.mjs' && blocked.test(fs.readFileSync(file,'utf8')))violations.push(file);
 }
}
for(const dir of ['app','lib','components','desktop-ui','scripts','deploy'])scan(dir);
assert.deepEqual(violations,[],'Billable Google Maps API integration found. Plain Google Maps address/directions links are allowed.');
console.log('No billable Google Maps APIs in app, collectors or deployment wrappers; plain address links remain allowed.');
