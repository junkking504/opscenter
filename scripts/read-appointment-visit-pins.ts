// Read the same cached coordinates displayed by Schedule. No provider requests.
import fs from 'node:fs';
import path from 'node:path';
import {planningLocation} from '../lib/planning-geocodes';
import {readAddressMapFallback} from '../lib/address-map-fallback';
import {appointmentVisitPin} from '../lib/appointment-visit-pin';
const addresses: string[]=JSON.parse(fs.readFileSync(0,'utf8'));
if(!Array.isArray(addresses)||!addresses.every(value=>typeof value==='string'))throw new Error('Invalid visit address input');
const root=process.env.OPSCENTER_DATA_DIR||process.env.OPSBOT_DATA_DIR||path.join(process.env.HOME||'','.openclaw/workspace/opsbot/data');
let geocodes:Record<string,Record<string,unknown>>={};
try {geocodes=JSON.parse(fs.readFileSync(path.join(root,'cache/appointment_geocodes.json'),'utf8')).addresses||{};} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
process.stdout.write(JSON.stringify(Object.fromEntries([...new Set(addresses)].map(address=>{
  const location=planningLocation(address,geocodes);
  const pin=appointmentVisitPin({location,mapFallback:location?null:readAddressMapFallback(address)});
  return [address,pin?{...pin,sourceAddress:address,sourceKind:location?'verified_location':'map_fallback'}:null];
}))));
