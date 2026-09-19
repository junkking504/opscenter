import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {CrewPhoneError} from './crew-phone';
type Option={value:string;label:string};
export type WaypointTestPricing={schema:1;source:'JunkWare';verifiedAt:string;loadOptions:Option[];loadPrices:number[];dryRunFee:string;bedloadOptions:Option[];bedloadPrices:number[];otherChargeOptions:Option[]};
/** Sanitized, explicitly captured price book. No customer/job data or provider reads in the sandbox. */
export function readWaypointTestPricing(){
 const file=process.env.OPS_WAYPOINT_TEST_PRICING_FILE || path.join(process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.cwd(),'data'),'waypoint-test-pricing.json');
 let value:WaypointTestPricing;
 try{value=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw new CrewPhoneError('Test pricing is unavailable. Ask the office to refresh the JunkWare price book.',503);}
 const options=(rows:Option[])=>Array.isArray(rows) && rows.length>1 && rows.length<200 && rows.every(r=>r && typeof r.value==='string' && typeof r.label==='string') && new Set(rows.map(r=>r.value)).size===rows.length;
 const rates=(rows:number[])=>Array.isArray(rows) && rows.length>0 && rows.every(n=>Number.isFinite(n) && n>=0);
 if(value.schema!==1 || value.source!=='JunkWare' || !Number.isFinite(Date.parse(value.verifiedAt)) || !options(value.loadOptions) || !options(value.bedloadOptions) || !options(value.otherChargeOptions) || !rates(value.loadPrices) || !rates(value.bedloadPrices) || value.loadPrices.length!==value.loadOptions.filter(o=>o.value!=='Dry Run').length || value.bedloadPrices.length!==value.bedloadOptions.length || typeof value.dryRunFee!=='string')throw new CrewPhoneError('The test price book needs office review.',503);
 const version=createHash('sha256').update(JSON.stringify(value)).digest('hex');
 return {...value,version};
}
