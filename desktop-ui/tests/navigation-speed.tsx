import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import LiveCommand from '../live-command';
import {WorkspaceBoundary} from '../workspace-boundary';
import {installMaintenanceTelemetry} from '../lib/maintenance-telemetry';
import {clearWorkspaceCache} from '../lib/workspace-cache';
import {fixtureSnapshot} from '../../scripts/fixtures/crew-progress';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

const date='2026-09-11';
let fail=false;
let broken=false;
let revision=1;
const command=fixtureSnapshot(); command.date=date;
// A hung Command request must not block Fleet or remove authenticated navigation.
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);
 if(init?.method && init.method!=='GET') return Response.json({error:'Synthetic fixture: no writes'}, {status:403});
 if(url.pathname==='/api/desktop/command') return new Promise((_resolve,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('aborted','AbortError')),{once:true});});
 if(url.pathname==='/api/desktop/fleet') {
   await new Promise(resolve=>setTimeout(resolve,1200));
   init?.signal?.throwIfAborted();
   if(fail)return Response.json({error:'Synthetic Fleet offline'},{status:503});
   return Response.json({date,report:url.searchParams.get('view'),sourceUpdatedAt:'2026-09-11T12:00:00Z',sourceAvailable:true,canWrite:false,trucks:broken?null:[],issues:[],maintenance:[],reportRows:[],reportCoverageDays:0,warnings:[`Synthetic Fleet revision ${revision}. No operational data.`]});
 }
 return Response.json({error:'Source disabled in synthetic check'},{status:503});
};
class NoEvents { addEventListener(){} close(){} }
window.EventSource=NoEvents as unknown as typeof EventSource;
installMaintenanceTelemetry();
function Controls(){const[,update]=useState(0);return <div style={{position:'fixed',top:0,right:0,zIndex:20000,background:'white',padding:8}}><strong>Synthetic navigation check</strong><button onClick={()=>{fail=!fail;update(n=>n+1);}}>Source: {fail?'offline':'online'}</button><button onClick={()=>{revision++;update(n=>n+1);}}>Advance source: {revision}</button><button onClick={()=>clearWorkspaceCache()}>Invalidate cache</button><button onClick={()=>{broken=true;fail=false;clearWorkspaceCache();update(n=>n+1);}}>Break workspace</button></div>;}
createRoot(document.getElementById('controls')!).render(<Controls/>);
createRoot(document.getElementById('root')!).render(<WorkspaceBoundary><LiveCommand bootstrap={{date,actor:{displayName:'Test operator',role:'Operator'}}}/></WorkspaceBoundary>);
