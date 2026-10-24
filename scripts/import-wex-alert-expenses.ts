import fs from 'node:fs';
import {prepareWexAlertExpenses,importWexAlertExpenses} from '../lib/wex-alert-expenses';
const [file,mode]=process.argv.slice(2);
if(!file||process.argv.length!==4||!mode||mode!=='--dry-run'&&!/^--expected-sha256=(missing|[a-f0-9]{64})$/.test(mode))throw Error('Supply private Outlook WEX JSON and exactly --dry-run or --expected-sha256=<preflight hash>.');
const messages=JSON.parse(fs.readFileSync(file,'utf8'));
if(mode==='--dry-run'){const plan=prepareWexAlertExpenses(messages);console.log(JSON.stringify({...plan.summary,sourceSha256:plan.sourceSha256,dryRun:true}));}
else console.log(JSON.stringify(importWexAlertExpenses(messages,mode.slice('--expected-sha256='.length))));
