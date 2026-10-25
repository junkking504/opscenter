import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {reviewedAddressIdentity} from './reviewed-service-address';
import {normalizeServiceAddress} from './service-address-format';
import {serviceStreetCandidates} from './appointment-partner';
import type {AddressMapFallback} from './address-map-fallback';

/** Navigation evidence is deliberately separate from verified premises. */
export type ReviewedAddressNavigation = {
  schema: 1;
  status: 'approximate';
  originalAddress: string;
  matchedAddress: string;
  location: {latitude:number; longitude:number};
  source: string;
  sourceUrl: string;
  reviewedBy: string;
  reviewedAt: string;
  visitEligible: false;
};
const rootDirectory=()=>process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data');
const identity=(address:string)=>normalizeServiceAddress(reviewedAddressIdentity(address));
export const reviewedNavigationFile=(address:string,root=rootDirectory())=>path.join(root,'cache/service-address-navigation',createHash('sha256').update(identity(address)).digest('hex')+'.json');

export function validateReviewedNavigation(value:unknown,now=Date.now()):ReviewedAddressNavigation {
  if(!value || typeof value!=='object')throw Error('Navigation review must be an object');
  const row=value as ReviewedAddressNavigation;
  if(row.schema!==1 || row.status!=='approximate' || row.visitEligible!==false
    || ![row.originalAddress,row.matchedAddress,row.source,row.sourceUrl,row.reviewedBy,row.reviewedAt].every(v=>typeof v==='string' && v.trim().length>0))throw Error('Incomplete approximate navigation review');
  const original=identity(row.originalAddress),matched=identity(row.matchedAddress);
  const sourceZip=original.match(/ (\d{5})$/)?.[1],matchedZip=matched.match(/ (\d{5})$/)?.[1];
  // Full-field scope retains house suffix, unit, road direction and locality.
  // Only the observed ZIP discrepancy may differ; never broaden to premises.
  if(!/^\d+[A-Z]? /.test(original) || serviceStreetCandidates(row.originalAddress).length!==1
    || !sourceZip || !matchedZip || sourceZip.slice(0,3)!==matchedZip.slice(0,3)
    || original.replace(/ \d{5}$/,'')!==matched.replace(/ \d{5}$/,''))throw Error('Navigation review changes the service address');
  const point=row.location;
  if(!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)
    || point.latitude<29 || point.latitude>31.3 || point.longitude< -93 || point.longitude> -89.4)throw Error('Invalid navigation coordinates');
  const url=new URL(row.sourceUrl);
  if(url.protocol!=='https:' || url.username || url.password)throw Error('Navigation source must be an HTTPS evidence URL');
  const reviewed=Date.parse(row.reviewedAt);
  if(!Number.isFinite(reviewed) || reviewed>now)throw Error('Invalid navigation review time');
  return row;
}

export function readReviewedAddressNavigation(address:string,root=rootDirectory(),now=Date.now()):AddressMapFallback|null {
  try {
    const row=validateReviewedNavigation(JSON.parse(fs.readFileSync(reviewedNavigationFile(address,root),'utf8')),now);
    if(identity(row.originalAddress)!==identity(address))return null;
    return {location:row.location,matchedAddress:row.matchedAddress,source:row.source,sourceUrl:row.sourceUrl,
      stale:false,visitEligible:false,navigationReviewed:true,
      detail:'Reviewed approximate address location; entrance unconfirmed. Source address preserved.'};
  } catch {return null;}
}

/** Dry-run by default; atomic create-if-absent, never overwrite another review. */
export function publishReviewedNavigation(value:unknown,root:string,apply=false) {
  const row=validateReviewedNavigation(value),file=reviewedNavigationFile(row.originalAddress,root);
  const checkExisting=()=>{
    if(!isDeepStrictEqual(JSON.parse(fs.readFileSync(file,'utf8')),row))throw Error('Existing navigation review conflicts; no overwrite');
  };
  if(fs.existsSync(file)){checkExisting();return {status:'unchanged',file};}
  if(!apply)return {status:'would-create',file};
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temporary=file+'.'+randomUUID()+'.tmp';
  const fd=fs.openSync(temporary,'wx',0o600);
  try {fs.writeFileSync(fd,JSON.stringify(row,null,2)+'\n');fs.fsyncSync(fd);} finally {fs.closeSync(fd);}
  try {
    try {fs.linkSync(temporary,file);} catch(error) {if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
    checkExisting();
  } finally {fs.unlinkSync(temporary);}
  return {status:'created',file};
}
