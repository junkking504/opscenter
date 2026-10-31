import '../../components/astryx/layers.css';
import {createRoot} from 'react-dom/client';
import LiveCommand from '../live-command';
import {WorkspaceBoundary} from '../workspace-boundary';
import {cachedCommandSnapshot} from '../lib/command-loading';
import {installMaintenanceTelemetry} from '../lib/maintenance-telemetry';
import {fixtureSnapshot} from '../../scripts/fixtures/crew-progress';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

const date=new URL(location.href).searchParams.get('date') || '2026-10-30';
const errors=new URL(location.href).searchParams.get('fail')==='1';
let pending=0;
const delay=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);
 if(url.pathname==='/api/desktop/maintenance')return Response.json({accepted:true});
 if(init?.method==='HEAD')return new Response(null,{status:200});
 if(init?.method && init.method!=='GET')return Response.json({error:'Synthetic fixture: writes disabled'},{status:403});
 if(url.pathname==='/api/desktop/command') {
   const selected=url.searchParams.get('date')!;
   const summary=url.searchParams.get('part')==='summary';
   pending++; await delay(summary ? 120 : selected.endsWith('29') ? 7000 : 3000);pending--;
   init?.signal?.throwIfAborted();
   if(!summary && errors)return Response.json({error:'Synthetic history offline'},{status:503});
   const snapshot={...fixtureSnapshot(),date:selected,actor:{displayName:'Test operator',role:'Manager'},generatedAt:new Date().toISOString()};
   const revenue=Number(selected.slice(-2))*100;
   snapshot.kpis=[{label:'Revenue',value:`$${revenue.toLocaleString('en-US')}.00`,detail:`Saved ${selected}`,progress:50,tone:'healthy',goal:5000},{label:'Today’s jobs',value:'3',detail:`Saved ${selected}`,progress:50,tone:'healthy'}];
   if(summary)return Response.json({...snapshot,updatesLoading:true,alerts:[],crewProgress:undefined,sources:{metrics:true,alerts:false,workflow:false}});
   return Response.json(snapshot);
 }
 if(url.pathname==='/api/desktop/fleet')return Response.json({date:url.searchParams.get('date'),sourceAvailable:true,canWrite:false,trucks:[],issues:[],maintenance:[],reportRows:[],warnings:['Synthetic Fleet view']});
 return Response.json({error:'Source disabled in synthetic check'},{status:503});
};
class NoEvents {addEventListener(){} close(){}}
window.EventSource=NoEvents as unknown as typeof EventSource;
installMaintenanceTelemetry();
let started=performance.now(), measurement='';
document.addEventListener('click',event=>{if((event.target as Element).closest('.viewing-day-controls')){started=performance.now();measurement='';}},true);
new MutationObserver(()=>{
 const selected=new URL(location.href).searchParams.get('date') || date;
 const revenue=`$${(Number(selected.slice(-2))*100).toLocaleString('en-US')}.00`;
 if(!measurement && document.getElementById('root')?.textContent?.includes(revenue))measurement=`${selected}: figures visible in ${Math.round(performance.now()-started)} ms`;
 const text=`Synthetic data only · ${measurement || 'Loading figures'} · pending reads ${pending} · cached start day ${Boolean(cachedCommandSnapshot(date))}`;
 const output=document.getElementById('timing')!;
 if(output.textContent!==text)output.textContent=text;
}).observe(document.getElementById('root')!,{childList:true,subtree:true,characterData:true});
createRoot(document.getElementById('root')!).render(<WorkspaceBoundary><LiveCommand bootstrap={{date,actor:{displayName:'Test operator',role:'Manager'}}}/></WorkspaceBoundary>);

import '../driving-scores.css';
import '../opscenter-brand.css';
import '../approved-workbench.css';
import '../theme.css';
