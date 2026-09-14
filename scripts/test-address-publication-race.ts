import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { publishAddressEvidence } from '../lib/address-research-store';

const evidence = (latitude: number) => ({ location: { latitude, longitude: -90.07 }, sources: ['https://opscenter.invalid/fixture'], reason: 'Synthetic exact-premise fixture' });
async function main() {
  if (process.argv[2] === '--child') {
    const [root, address, latitude, barrier] = process.argv.slice(3);
    while (!fs.existsSync(path.join(root, 'go'))) await new Promise(resolve => setTimeout(resolve, 10));
    if (barrier === 'conflict') {
      const exists = fs.existsSync;
      fs.existsSync = ((file: fs.PathLike) => {
        const found = exists(file);
        if (!found && String(file).endsWith('.json')) {
          fs.writeFileSync(path.join(root, `ready-${process.pid}`), '1');
          const deadline = Date.now() + 10_000;
          while (!exists(path.join(root, 'publish-go'))) {
            if (Date.now() > deadline) throw new Error('Race barrier timed out');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
          }
        }
        return found;
      }) as typeof fs.existsSync;
    }
    try { publishAddressEvidence(address, evidence(Number(latitude)), root); process.exitCode = 0; }
    catch { process.exitCode = 2; }
    return;
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-address-race-'));
  try {
    const address = '100 Example St, New Orleans, LA 70115';
    const run = (value: string, latitude: number) => new Promise<number | null>((resolve, reject) => {
      const child = spawn(process.execPath, ['--import', 'tsx', fileURLToPath(import.meta.url), '--child', root, value, String(latitude), value === address ? 'conflict' : 'independent'], { stdio: 'ignore' });
      child.on('error', reject); child.on('exit', resolve);
    });
    const contenders = [run(address,29.97),run(address,30.01),run('200 Example St, New Orleans, LA 70115',29.98)];
    fs.writeFileSync(path.join(root,'go'),'1');
    const deadline = Date.now() + 10_000;
    while (fs.readdirSync(root).filter(file => file.startsWith('ready-')).length < 2) {
      if (Date.now() > deadline) throw new Error('Both writers must observe the missing record');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    fs.writeFileSync(path.join(root, 'publish-go'), '1');
    const [a,b,c] = await Promise.all(contenders);
    assert.deepEqual([a,b].sort(),[0,2], 'Exactly one conflicting coordinate proposal can win');
    assert.equal(c,0,'An unrelated address is not lost or blocked');
    const dir=path.join(root,'cache/service-address-reviews');
    const files=fs.readdirSync(dir);
    assert.equal(files.length,2,'No abandoned temporary files');
    const records=files.map(file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')));
    const winner=records.find(row=>row.originalAddress===address)!;
    assert.ok([29.97,30.01].includes(winner.location.latitude));
    const before=JSON.stringify(records);
    publishAddressEvidence(address,evidence(winner.location.latitude),root);
    assert.throws(()=>publishAddressEvidence(address,evidence(winner.location.latitude===29.97?30.01:29.97),root),/conflicts/);
    assert.throws(()=>publishAddressEvidence(address,evidence(45),root),/incomplete/);
    assert.equal(JSON.stringify(files.map(file=>JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')))),before,'Conflicting/rejected proposals preserve verified evidence');
    console.log('Address publication: conflicting processes, independent records, idempotent same-point publication and bounds passed.');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
