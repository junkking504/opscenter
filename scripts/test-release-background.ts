import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {registerBackground,releaseBackground,closeReadOnlyStreamsOnStop,beginReleaseStop} from '../lib/release-background';

async function main(){
  const callbacks:Array<()=>Promise<void>>=[];
  const register=(callback:()=>Promise<void>)=>{callbacks.push(callback);};
  let finish!:()=>void;const pending=new Promise<void>(resolve=>{finish=resolve;});
  registerBackground(register,()=>pending);
  assert.equal(releaseBackground().pending,1,'count starts at registration before response settles');
  const work=callbacks.shift()!();assert.equal(releaseBackground().pending,1);finish();await work;assert.equal(releaseBackground().pending,0);
  registerBackground(register,()=>{throw new Error('Synthetic callback rejection');});await assert.rejects(callbacks.shift()!());assert.equal(releaseBackground().pending,0);
  assert.throws(()=>registerBackground(()=>{throw new Error('Synthetic registration failure');},()=>{}));assert.equal(releaseBackground().pending,0);
  registerBackground(register,()=>registerBackground(register,async()=>{}));await callbacks.shift()!();assert.equal(releaseBackground().pending,1);await callbacks.shift()!();assert.equal(releaseBackground().pending,0);
  let closed=0;const remove=closeReadOnlyStreamsOnStop(()=>{closed++;});remove();closeReadOnlyStreamsOnStop(()=>{closed++;});beginReleaseStop();assert.equal(closed,1);assert.equal(releaseBackground().stopping,true);closeReadOnlyStreamsOnStop(()=>{closed++;});assert.equal(closed,2);
  const scan=(directory:string):string[]=>fs.readdirSync(directory,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?scan(path.join(directory,entry.name)):[path.join(directory,entry.name)]);
  for(const file of scan('app/api').filter(file=>file.endsWith('.ts'))){const text=fs.readFileSync(file,'utf8');assert.doesNotMatch(text,/import\s*\{[^}]*\bafter\b[^}]*\}\s*from\s*['"]next\/server/,'Uncounted post-response callback: '+file);}
  console.log('Release background: registration, success, rejection, nested work and read-only stream shutdown passed.');
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
