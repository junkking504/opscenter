import fs from 'node:fs';
import path from 'node:path';
import type { WexExpenseAlert } from './wex-alert-expenses';

export type AlertAttribution = { truck: string | null; at: string | null; status: 'matched' | 'ambiguous' | 'unavailable'; evidence: string };
const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/\bavenue\b/g,'ave').replace(/\bstreet\b/g,'st').replace(/\broad\b/g,'rd').replace(/\bhighway\b/g,'hwy').replace(/\bboulevard\b/g,'blvd').replace(/[^a-z0-9]/g,'');
const epoch = (value: unknown) => typeof value === 'number' ? value : Date.parse(String(value || ''));

/** Email clocks have no zone. Delivery bounds candidate instants across possible clock offsets,
 * but does not verify the zone. Require exactly one dated stationary truck/time stop across all candidates;
 * never assign from a crew/card name or a point merely passing the station. */
export function attributeWexAlert(alert: WexExpenseAlert, root = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR || path.join(process.env.HOME || '', '.openclaw/workspace/opsbot/data')): AlertAttribution {
  const unavailable = (evidence: string): AlertAttribution => ({truck:null,at:null,status:'unavailable',evidence});
  const local = Date.parse(`${alert.date}T${alert.time}Z`), received = Date.parse(alert.receivedAt);
  const times = [-10,-9,-8,-7,-6,-5,-4,-3].map(offset=>local-offset*3600000).filter(at=>received>=at && received-at<=24*3600000);
  if(!times.length)return unavailable('Purchase clock timezone is unconfirmed; delivery is outside the supported one-day window.');
  const street=alert.address.match(/^(\d+)\s+(.+)$/);
  if(!street || !alert.city || !alert.stateCode)return unavailable('Station street address is incomplete.');
  let stops: Array<Record<string,unknown>>;
  try { const payload=JSON.parse(fs.readFileSync(path.join(root,'history/linxup',`linxup_location_${alert.date}.json`),'utf8'));stops=payload.date===alert.date && Array.isArray(payload.stops)?payload.stops:[]; }
  catch { return unavailable('Dated GPS stops are unavailable; truck remains unassigned.'); }
  const candidates=new Map<string,{truck:string;at:number;begin:number;end:number;street:string;nearby:boolean}>();
  for(const at of times)for(const stop of stops){
    const begin=epoch(stop.beginDate),end=epoch(stop.endDate), observed=String(stop.street || '').match(/^(\d+)\s+(.+)$/);
    const truck=String(stop.driverName || stop.firstName || '').match(/^Truck\s*#?\s*(\d+)$/i);
    if(!truck || !observed || !Number.isFinite(begin) || !Number.isFinite(end) || end-begin<60000 || at<begin || at>end)continue;
    if(normalize(street[2])!==normalize(observed[2]) || normalize(alert.city)!==normalize(stop.city) || normalize(alert.stateCode)!==normalize(stop.stateCode))continue;
    // Reverse geocoders can return the adjoining street number on the same
    // station frontage. Keep this narrow and label it as a vicinity inference.
    const delta=Math.abs(Number(street[1])-Number(observed[1]));
    if(delta>2 || delta%2!==0)continue;
    if(alert.postalCode && String(stop.postalCode || '').slice(0,5)!==alert.postalCode.slice(0,5))continue;
    candidates.set(`${Number(truck[1])}@${at}`,{truck:`Truck# ${Number(truck[1])}`,at,begin,end,street:String(stop.street),nearby:delta!==0});
  }
  if(candidates.size!==1)return {truck:null,at:null,status:candidates.size?'ambiguous':'unavailable',evidence:candidates.size?'Multiple truck/time matches across possible email timezones; assignment needs review.':'No unique stationary GPS stop overlaps the inferred purchase time.'};
  const stop=[...candidates.values()][0],truck=stop.truck,at=stop.at;
  return {truck,at:new Date(at).toISOString(),status:'matched',evidence:`GPS stop at ${stop.street}, ${new Date(stop.begin).toISOString()}–${new Date(stop.end).toISOString()}. ${stop.nearby?'Adjacent street number; station vicinity inferred. ':''}Purchase instant inferred from one GPS match across possible email clock offsets; WEX timezone and delivery delay remain unconfirmed.`};
}
