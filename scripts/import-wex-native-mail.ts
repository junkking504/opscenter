import fs from 'node:fs';
import {importNativeWex,prepareNativeWex} from '../lib/wex-mail-feed';
const mode=process.argv[2];
if(process.argv.length!==3||!['--dry-run','--apply'].includes(mode))throw Error('Specify exactly --dry-run or --apply; private packet is read from stdin.');
const bytes=fs.readFileSync(0);if(bytes.length>5_000_000)throw Error('Native mail packet too large.');
const packet=JSON.parse(bytes.toString('utf8'));
console.log(JSON.stringify(mode==='--dry-run'?{dryRun:true,...prepareNativeWex(packet).summary}:importNativeWex(packet)));
