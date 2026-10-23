import fs from 'node:fs';
import {importWexRealtimePrices} from '../lib/wex-realtime-prices';
if(!process.argv[2])throw new Error('Supply the private JSON array of Outlook WEX messages.');
console.log(importWexRealtimePrices(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))));
