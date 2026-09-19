/** Revenue tiers from OpsBot process_daily_metrics.py, effective 2026-07-13.
 * Highest tier only; revenue is the individual's credited share, not truck sales. */
export const REVENUE_BONUS_TIERS = [[1000,20],[1250,40],[1500,60],[1750,75],[2000,100],[2250,125],[2500,150],[2750,175],[3000,200],[3250,250],[3500,300],[3750,350],[4000,400]] as const;
export function bonusProgress(revenue:number) {
  const cents=Math.round(Math.max(0,revenue)*100);
  const earned=REVENUE_BONUS_TIERS.filter(([threshold])=>cents>=threshold*100).at(-1);
  const next=REVENUE_BONUS_TIERS.find(([threshold])=>cents<threshold*100);
  return {bonus:earned?.[1] || 0,next:next?{revenue:next[0],bonus:next[1],remaining:(next[0]*100-cents)/100}:null};
}
export type WaypointCompleted={id:string;reference:string;customer:string;address:string;time:string;revenue:number|null;tips:number|null;type:string};
export type WaypointCrewProgress={name:string;revenue:number|null;tips:number|null;bonus:number|null;progress:ReturnType<typeof bonusProgress>|null};
export type WaypointDaySummary={date:string;truck:string;test:boolean;observedAt:string|null;stale:boolean;message?:string;revenue:number|null;tips:number|null;crew:WaypointCrewProgress[];completed:WaypointCompleted[]|null};
export const truckKey=(value:unknown)=>String(value || '').match(/(?:truck\s*#?\s*)?(\d+)/i)?.[1]?.replace(/^0+/,'') || '';
export const moneyValue=(value:unknown):number|null=>{
  if(value===null || value===undefined || String(value).trim()==='')return null;
  const n=Number(String(value).replace(/[$,\s]/g,''));return Number.isFinite(n)?Math.round(n*100)/100:null;
};
export function mapsDirections(address:string){return address.trim() && !/^(—|-|unknown|unavailable)$|address (unavailable|pending)|verification pending/i.test(address)?`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`:null;}
