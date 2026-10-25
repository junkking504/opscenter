import {createRoot} from 'react-dom/client';
import LiveCommand from '../live-command';
import {OPS_THEME_BOOTSTRAP} from '../../lib/ops-theme';
import {fixtureSnapshot,job,alert} from '../../scripts/fixtures/crew-progress';
import '../app/globals.css';
import '../desktop-presentation.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../approved-workbench.css';
const date='2026-10-13',stamp=new Date().toISOString(),params=new URLSearchParams(location.search);
const snapshot=fixtureSnapshot();snapshot.date=date;snapshot.actor.role=params.get('role')==='operator'?'Operator':'Manager';
snapshot.kpis=[['Revenue','$8,512.34','Includes assumed daily costs'],['Today’s jobs','6','4 jobs · 2 estimates'],['Labor','$1,842.10','Goal: under 16%'],['Dump + Fuel','$1,234.56','Includes $47.00 assumed dump cost'],['Net','-$1,234.56','After recorded and assumed daily costs'],['RPH','$160.00','4 labor hours · 1 crew · 1 excluded'],['AJS','$320.00','2 completed jobs · Gross job values']].map(([label,value,detail])=>({label,value,detail,progress:100,tone:'healthy' as const}));
snapshot.alerts=[alert('synthetic-warning','Source Warning',stamp,{title:'Synthetic coverage warning',detail:'Current source coverage is incomplete.',href:'',facts:[{label:'Coverage',value:'Unknown'}]})];snapshot.crewProgress=undefined;
const qa={reads:[] as string[],writes:[] as string[]};(window as unknown as {gestureQa:typeof qa}).gestureQa=qa;
window.fetch=async(input,init)=>{
 const url=new URL(String(input),location.origin);
 if(init?.method && !['GET','HEAD'].includes(init.method)){qa.writes.push(url.pathname);throw Error('Operational writes forbidden in integrated gesture fixture');}
 qa.reads.push(url.pathname+url.search);
 if(url.pathname==='/api/desktop/command')return Response.json(snapshot);
 if(url.pathname==='/api/desktop/schedule'){
  const day=url.searchParams.get('date')||date;
  const appointments=[{...job({status:'Confirmed',closeout:null,completedAt:'',paymentAmount:0,paymentType:''}),sourceDate:day,recordId:day+':appointment:101',location:null,version:'a'.repeat(64),callAhead:'not_called'}];
  return Response.json({date:day,observedAt:stamp,...(url.searchParams.has('displayOnly')?{}:{sourceRequest:{state:'loading',message:'Synthetic source request remains pending'}}),assignmentRecoveryNotices:[{requestId:'synthetic',recordId:day+':appointment:101',message:'Synthetic assignment verification warning'}],appointments,fleet:{isToday:false,lastUpdatedAt:null,trucks:[]}});
 }
 if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date,legs:[],closest:[],appointmentId:null});
 return Response.json({error:'Source unavailable in synthetic gesture fixture'},{status:503});
};
class NoEvents{addEventListener(){}removeEventListener(){}close(){}}
window.EventSource=NoEvents as unknown as typeof EventSource;
const themeScript=document.createElement('script');themeScript.textContent=OPS_THEME_BOOTSTRAP;document.head.append(themeScript);
const root=createRoot(document.getElementById('root')!);root.render(<LiveCommand/>);import.meta.hot?.dispose(()=>root.unmount());
