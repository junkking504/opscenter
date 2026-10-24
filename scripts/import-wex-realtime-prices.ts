import fs from 'node:fs';
import {importWexRealtimePrices,prepareWexRealtimePrices} from '../lib/wex-realtime-prices';
const [file,...flags]=process.argv.slice(2);
if(!file||file.startsWith('--')||flags.some(flag=>flag!=='--dry-run'&&!/^--expected-sha256=(?:missing|[a-f0-9]{64})$/.test(flag)))throw new Error('Supply a private Outlook WEX JSON array, optionally --dry-run or --expected-sha256=<preflight hash>.');
const messages=JSON.parse(fs.readFileSync(file,'utf8'));
if(flags.includes('--dry-run')){
 const plan=prepareWexRealtimePrices(messages);
 console.log(JSON.stringify({...plan.summary,sourceSha256:plan.sourceSha256,dryRun:true}));
}else{
 const expected=flags.find(flag=>flag.startsWith('--expected-sha256='))?.split('=')[1];
 console.log(JSON.stringify(importWexRealtimePrices(messages,undefined,undefined,expected)));
}
