import fs from 'node:fs';
import path from 'node:path';
import type {WaypointTestPricing} from '../../lib/waypoint-test-pricing';
/** Synthetic provider fixture; production reads a private verified price book. */
export const testPricing:WaypointTestPricing={schema:1,source:'JunkWare',verifiedAt:'2026-09-19T12:00:00Z',loadOptions:[{value:'',label:''},{value:'Minimum',label:'Minimum'},{value:'3 (1/2)',label:'3 (1/2)'}],loadPrices:[100,500,700],dryRunFee:'',bedloadOptions:[{value:'',label:''},{value:'1/2',label:'1/2'}],bedloadPrices:[250,400],otherChargeOptions:[{value:'',label:''},{value:'1|75.00',label:'Labor'},{value:'42|3.00|1',label:'Card surcharge'}]};
export function writeTestPricing(root:string){fs.mkdirSync(root,{recursive:true});fs.writeFileSync(path.join(root,'waypoint-test-pricing.json'),JSON.stringify(testPricing));}
