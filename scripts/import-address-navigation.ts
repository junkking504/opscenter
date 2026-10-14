import fs from 'node:fs';
import path from 'node:path';
import {publishReviewedNavigation} from '../lib/reviewed-address-navigation';
const args=process.argv.slice(2),files=args.filter(v=>!v.startsWith('--'));
const roots=args.filter(v=>v.startsWith('--directory='));
const root=roots[0]?.slice('--directory='.length);
if(files.length!==1 || roots.length!==1 || !root || !path.isAbsolute(root)
  || args.some(v=>v.startsWith('--') && v!=='--apply' && !v.startsWith('--directory='))) {
  throw Error('Usage: import-address-navigation.ts RECORD --directory=/absolute/data/root [--apply]. Defaults to dry-run.');
}
console.log(JSON.stringify(publishReviewedNavigation(JSON.parse(fs.readFileSync(files[0],'utf8')),root,args.includes('--apply')),null,2));
