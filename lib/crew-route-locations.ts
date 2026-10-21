import fs from 'node:fs';
import path from 'node:path';
import {planningLocation} from './planning-geocodes';
import {readAddressMapFallback} from './address-map-fallback';
import type {CrewMapLocation} from './crew-dispatch';

/** Read saved evidence only, after the caller has filtered authorized appointments. */
export function readCrewRouteLocations(addresses:string[]):Map<string,CrewMapLocation|null> {
 let pins:Record<string,Record<string,unknown>>={};
 try {
  const root=process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
  const saved=JSON.parse(fs.readFileSync(path.join(root,'cache/appointment_geocodes.json'),'utf8'));
  if(saved.addresses && typeof saved.addresses==='object')pins=saved.addresses;
 } catch { /* Keep the appointment visible when the cache is unavailable. */ }
 return new Map<string,CrewMapLocation|null>([...new Set(addresses)].map((address):[string,CrewMapLocation|null]=>{
  try {
   const verified=planningLocation(address,pins);
   if(verified)return [address,{...verified,approximate:false}];
   const fallback=readAddressMapFallback(address);
   return [address,fallback?{...fallback.location,approximate:true,detail:fallback.detail}:null];
  } catch { return [address,null]; }
 }));
}
