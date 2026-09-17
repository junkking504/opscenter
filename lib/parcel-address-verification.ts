import { fullFieldStreetAddress, serviceStreetCandidates } from './appointment-partner';
import { normalizeServiceAddress } from './service-address-format';
import type { AddressEvidence } from './address-research-evidence';

export type StopAddressAnchor = { street: string; city: string; zip: string; latitude: number; longitude: number };
const endpoint = 'https://maps.stpgov.org/server/rest/services/Referenced_Layers/2025_Parcels/MapServer/0/query';
const localities: Record<string, string[]> = { SLIDELL:['70458','70460','70461'], MANDEVILLE:['70448','70471'], COVINGTON:['70433','70435'], LACOMBE:['70445'], MADISONVILLE:['70447'], ABITA_SPRINGS:['70420'] };
export function parcelAnchorMatches(address: string, anchor: StopAddressAnchor) {
  if (serviceStreetCandidates(address).length !== 1 || /\b(?:apt|apartment|unit|ste|suite|bldg|building|floor)\b|#/i.test(address)) return false;
  const normalized = normalizeServiceAddress(fullFieldStreetAddress(address)).replace(/ LA (?=\d{5}$)/, ' ');
  return normalized === normalizeServiceAddress(`${anchor.street} ${anchor.city} ${anchor.zip}`)
    && localities[anchor.city.replace(/ /g,'_')]?.includes(anchor.zip)
    && Number.isFinite(anchor.latitude) && Number.isFinite(anchor.longitude)
    && anchor.latitude >= 30 && anchor.latitude <= 30.75 && anchor.longitude >= -90.5 && anchor.longitude <= -89.4;
}
type Feature = {attributes?: {OBJECTID?:number;Physical_Address1?:string;Assessment_Num?:number};geometry?:{rings?:number[][][]}};
export function verifyParcelPayload(address:string, anchor:StopAddressAnchor, payload:unknown, sourceUrl=endpoint):AddressEvidence {
  const unavailable:AddressEvidence={location:null,reason:'No corroborated exact parcel match',sources:[]};
  if(!parcelAnchorMatches(address,anchor))return unavailable;
  const data=payload as {features?:Feature[];exceededTransferLimit?:boolean;spatialReference?:{wkid?:number}};
  if(!data || data.exceededTransferLimit || data.spatialReference?.wkid!==4326 || data.features?.length!==1)return unavailable;
  const row=data.features[0],rings=row.geometry?.rings;
  if(!row.attributes?.OBJECTID || normalizeServiceAddress(row.attributes.Physical_Address1||'')!==normalizeServiceAddress(anchor.street)
    || rings?.length!==1 || rings[0].length<4 || rings[0].length>200)return unavailable;
  const ring=rings[0];
  if(!ring.every(p=>p.length===2 && p.every(Number.isFinite) && p[0]>=-90.5 && p[0]<=-89.4 && p[1]>=30 && p[1]<=30.75))return unavailable;
  if(ring[0][0]!==ring.at(-1)![0] || ring[0][1]!==ring.at(-1)![1])return unavailable;
  const vertices=ring.slice(0,-1),xs=vertices.map(p=>p[0]),ys=vertices.map(p=>p[1]);
  // Small, single-premises parcels only. Large land tracts and multipart parcels
  // require a better entrance location; a map center is not sufficient evidence.
  if(Math.max(...xs)-Math.min(...xs)>0.0015 || Math.max(...ys)-Math.min(...ys)>0.0015)return unavailable;
  const longitude=xs.reduce((a,b)=>a+b,0)/xs.length,latitude=ys.reduce((a,b)=>a+b,0)/ys.length;
  let inside=false;
  for(let i=0,j=vertices.length-1;i<vertices.length;j=i++) {
    const [xi,yi]=vertices[i],[xj,yj]=vertices[j];
    if((yi>latitude)!==(yj>latitude) && longitude<(xj-xi)*(latitude-yi)/(yj-yi)+xi)inside=!inside;
  }
  const metres=Math.hypot((longitude-anchor.longitude)*Math.cos(latitude*Math.PI/180)*111320,(latitude-anchor.latitude)*111320);
  if(!inside || metres>75)return unavailable;
  return {location:{latitude,longitude},matchedAddress:`${anchor.street}, ${anchor.city}, LA ${anchor.zip}`,
    reason:'Exact parish parcel corroborated by the assigned truck’s address-matched GPS stop',
    source:`St. Tammany Parish 2025 parcel ${row.attributes.Assessment_Num}; object ${row.attributes.OBJECTID}`,
    sourceUrl,sources:[sourceUrl],precision:'official-parcel-with-exact-address-stop'};
}
export async function verifyParcelAddress(address:string,anchor:StopAddressAnchor):Promise<AddressEvidence> {
  const unavailable:AddressEvidence={location:null,reason:'Official parcel lookup unavailable',sources:[]};
  if(!parcelAnchorMatches(address,anchor))return unavailable;
  // The street comes from normalized exact-stop evidence, not executable source
  // text. Escape SQL literals and request at most two rows to detect ambiguity.
  const params=new URLSearchParams({where:`UPPER(Physical_Address1) = '${normalizeServiceAddress(anchor.street).replace(/'/g,"''")}'`,
    outFields:'OBJECTID,Assessment_Num,Physical_Address1',outSR:'4326',returnGeometry:'true',resultRecordCount:'2',f:'json'});
  const url=`${endpoint}?${params}`;
  try {
    const response=await fetch(url,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'});
    if(!response.ok)return unavailable;
    const text=await response.text();
    return text.length<=100_000?verifyParcelPayload(address,anchor,JSON.parse(text),url):unavailable;
  }catch{return unavailable;}
}
