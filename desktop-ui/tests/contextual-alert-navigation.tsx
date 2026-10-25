import {createRoot} from 'react-dom/client';
import L from 'leaflet';
import LiveCommand from '../live-command';
import {alert,fixtureSnapshot,job} from '../../scripts/fixtures/crew-progress';
import {currentOperatingDay} from '../lib/operating-day';
import '../app/globals.css';
import '../desktop-presentation.css';
import '../live-responsive.css';
import '../workspace-density.css';
const params=new URLSearchParams(location.search),date=params.get('date')||currentOperatingDay(),mode=params.get('case')||sessionStorage.getItem('alert-fixture-case')||'fresh';
sessionStorage.setItem('alert-fixture-case',mode);
const stamp=new Date().toISOString();
const snapshot=fixtureSnapshot();snapshot.date=date;
snapshot.alerts=[alert('geo','Geofence',stamp,{domain:'Fleet',truck:'Truck 9',title:'Truck 9 departed NOHQ',detail:'Location update',facts:[{label:'Onsite',value:'19h 28m · Synthetic visit'},{label:'Visit verification',value:'Exact arrival time is unavailable.'}],href:'/desktop?workspace=Fleet&date='+date+'&truck=9'}),alert('appointment','New Appointment',stamp,{title:'JK1000001 · Example customer',href:'/jobs?date='+date+'&appointment=101'}),alert('unknown','Source Warning',stamp,{truck:undefined,title:'Update history incomplete',href:'/?commandView=monitor',facts:[{label:'Warning',value:'Current coverage is unknown.'}]})];
if(snapshot.crewProgress){snapshot.crewProgress.jobs=[];snapshot.crewProgress.updatesComplete=false;snapshot.crewProgress.updateHistoryReasons=['Synthetic source coverage is incomplete.'];}
const truck=(n:number)=>({truck:'Truck '+n,latitude:30+n/100,longitude:-90-n/100,lastGpsUpdate:mode==='stale'?'2020-01-01T00:00:00Z':stamp,ignition:'OFF',operationalStatus:'Parked',lastKnownAddress:'Synthetic location '+n});
const trucks=mode==='missing'?[]:[truck(19),{...truck(9),...(mode==='no-gps'?{latitude:null,longitude:null}: {})}];
L.Map.addInitHook(function(this:L.Map){(window as unknown as {qaMap:L.Map}).qaMap=this;});
window.fetch=async(input,init)=>{
 if(init?.method&&init.method!=='GET')return Response.json({error:'Writes disabled in fixture'},{status:403});
 const url=new URL(String(input),location.origin);
 if(url.pathname==='/api/desktop/command')return Response.json(snapshot);
 if(url.pathname==='/api/desktop/schedule'){
  if(mode==='delay')await new Promise(resolve=>setTimeout(resolve,1200));
  const day=url.searchParams.get('date')||date;
  return Response.json({date:day,observedAt:stamp,sourceRequest:{state:'ready'},appointments:mode==='missing-job'?[]:[{...job(),sourceDate:day,recordId:day+':appointment:101',location:null,version:'a'.repeat(64),callAhead:'not_called'}],fleet:{isToday:day===currentOperatingDay(),lastUpdatedAt:stamp,trucks}});
 }
 if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date,legs:[],closest:[],appointmentId:null});
 if(url.pathname==='/api/push/notification')return Response.json({title:'Truck #9',body:'Departed NOHQ · Synthetic notification',occurredAt:stamp,path:'/desktop?workspace=Schedule&scheduleView=board&date='+date+'&truck=Truck+9&focus=truck'});
 return Response.json({error:'Source disabled in synthetic fixture'},{status:503});
};
createRoot(document.getElementById('root')!).render(<LiveCommand/>);
