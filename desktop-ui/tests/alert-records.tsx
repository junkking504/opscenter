import {createRoot} from 'react-dom/client';
import LiveCommand from '../live-command';
import {fixtureSnapshot,job} from '../../scripts/fixtures/crew-progress';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';

// Full Command -> Schedule navigation, with every operational request intercepted.
// The matching job and an estimate deliberately share a JK reference.
const date=new URLSearchParams(location.search).get('date') || '2026-09-06';
const snapshot=fixtureSnapshot();
snapshot.date=date;
snapshot.alerts=snapshot.alerts.filter(alert=>alert.id==='closed-one');
snapshot.crewProgress!.jobs=snapshot.crewProgress!.jobs.map(job=>({...job,href:job.href.replaceAll('2026-09-07',date)}));
let reads=0;
window.fetch=async(input,init)=>{
  const url=new URL(String(input),location.origin);
  if(init?.method && init.method!=='GET') return Response.json({error:'Writes are disabled in the navigation fixture.'},{status:403});
  if(url.pathname==='/api/desktop/command') return Response.json(snapshot);
  if(url.pathname==='/api/desktop/schedule') {
    const sourceDate=url.searchParams.get('date') || date;
    const loading=sourceDate===date && reads++===0;
    const appointments=[job(),job({appointmentId:'201',appointmentType:'Estimate',customerName:'Example estimate',status:'Closed'})].map(job=>({...job,recordId:`${sourceDate}:appointment:${job.appointmentId}`,sourceDate,version:'a'.repeat(64),callAhead:'not_called',location:null}));
    return Response.json({date:sourceDate,observedAt:'2026-09-07T21:00:00Z',sourceRequest:{state:loading?'loading':'ready',message:loading?'Checking source appointments…':''},appointments:loading?[]:appointments,fleet:{isToday:false,lastUpdatedAt:null,trucks:[]}});
  }
  if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date:url.searchParams.get('date'),legs:[],closest:[],appointmentId:null});
  return Response.json({error:'This source is not enabled in the isolated navigation fixture.'},{status:503});
};
const root=createRoot(document.getElementById('root')!);
root.render(<LiveCommand/>);
import.meta.hot?.dispose(()=>root.unmount());
