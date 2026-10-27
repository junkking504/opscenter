import fs from 'node:fs';
import path from 'node:path';
import type {DesktopSourceHealth} from '../desktop-ui/lib/live-contract';

/** Read-only account-review visibility; never enables a provider or returns credentials. */
export function addressProviderHealth(now=Date.now(),file=process.env.GEOCODIO_FREE_CONFIG_FILE || path.join(process.env.HOME || '', 'Library/Application Support/OpsCenter/geocodio-free-fallback.json')):DesktopSourceHealth {
  const row:DesktopSourceHealth={name:'Address lookup',workspace:'Schedule',action:'View appointments',
    state:'Free fallback unavailable',tone:'warning',observedAt:new Date(now).toISOString(),maxAgeSeconds:180,
    area:'Free geocoder configuration needs review. Other address sources continue.',href:'/desktop?data=live&workspace=Schedule&scheduleView=board'};
  try {
    const c=JSON.parse(fs.readFileSync(file,'utf8'));
    const verified=Date.parse(c.verifiedAt),until=Date.parse(c.validUntil);
    if(c.schema!==1 || c.enabled!==true || c.provider!=='geocodio' || c.maxSpendMicros!==0 || c.noPaymentMethod!==true
      || !Number.isInteger(c.maxRequests) || c.maxRequests<1 || c.maxRequests>2500
      || !Number.isFinite(verified) || verified>now || !Number.isFinite(until) || until-verified>31*86400000
      || typeof c.apiKey!=='string' || !c.apiKey.trim() || /\s/.test(c.apiKey))return row;
    const date=new Date(until).toLocaleDateString('en-US',{timeZone:'America/Chicago',month:'short',day:'numeric',year:'numeric'});
    if(until<=now)return {...row,state:'Free account review expired',area:`Geocodio stopped new lookups when its free-account review expired ${date}. Verify no payment method and the free cutoff before renewing. Other address sources continue.`};
    const soon=until-now<=3*86400000;
    return {...row,state:soon?'Free account review due soon':'Free account review current',tone:soon?'warning':'healthy',
      area:`Geocodio free-account review expires ${date}. ${soon?'Review the account before expiration to keep the fallback available. ':''}Request limits and provider availability are checked separately.`};
  } catch {return row;}
}
