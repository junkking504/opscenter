import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'source-data-agents-'));
process.env.OPSBOT_DATA_DIR=root;
process.env.OPSCENTER_DATA_DIR=root;

const chicagoDateKey=(value=new Date())=>{
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(value);
  const fields=Object.fromEntries(parts.map(part=>[part.type,part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
};
const writeSnapshot=(coverageThrough:string)=>{
  const directory=path.join(root,'integrations','wex-fuel');fs.mkdirSync(directory,{recursive:true});
  const now=new Date().toISOString();
  fs.writeFileSync(path.join(directory,'posted-transactions.json'),JSON.stringify({schemaVersion:2,source:'WEXOnline posted transaction CSV',importedAt:now,sourceFile:'Transactions.csv',sourceFileModifiedAt:now,coverageFrom:coverageThrough,coverageThrough,transactionCount:0,transactions:[]}));
};

async function main() {
try {
  const today=chicagoDateKey();writeSnapshot(today);
  const {readDesktopSourceHealth}=await import('../lib/desktop-source-health');
  let wex=readDesktopSourceHealth(true).find(source=>source.name==='WEX');
  assert(wex);assert.equal(wex.tone,'healthy');assert.equal(wex.state,'Posted export covers today');assert.match(wex.area,/not a live portal read/);
  assert.equal(readDesktopSourceHealth(false).some(source=>source.name==='WEX'),false,'WEX health remains finance-authorized');
  const prior=new Date(`${today}T12:00:00Z`);prior.setUTCDate(prior.getUTCDate()-1);writeSnapshot(prior.toISOString().slice(0,10));
  wex=readDesktopSourceHealth(true).find(source=>source.name==='WEX');
  assert(wex);assert.equal(wex.tone,'warning');assert.match(wex.state,/Coverage through/);
  console.log('Source data agents passed: existing WEX snapshot ownership, explicit retained coverage, finance boundary and no collector activity.');
} finally {fs.rmSync(root,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
