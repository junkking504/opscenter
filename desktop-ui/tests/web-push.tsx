import { createRoot } from 'react-dom/client';
import { PushSettings } from '../components/push-settings';
import { CrewProgressAlerts } from '../components/crew-progress-alerts';
import { alert,fixtureSnapshot } from '../../scripts/fixtures/crew-progress';
import '../desktop-presentation.css';
const snapshot=fixtureSnapshot(true);
snapshot.alerts=[
 alert('geofence','Geofence','2026-10-18T13:59:00Z',{title:'Truck 8 departed NOHQ',truck:'Truck 8',facts:[{label:'Time on site',value:'59m'},{label:'Onsite',value:'59m | 8:00 AM – 8:59 AM'}]}),
 alert('krewe','Krewe Summary','2026-10-18T13:40:00Z',{title:'Krewe Summary',truck:undefined,updatedAt:'2026-10-18T13:49:00Z',facts:[{label:'Example Driver',value:'08:46 AM'},{label:'Example Navigator',value:'08:37 AM'}]}),
 alert('schedule','Schedule Summary','2026-10-18T11:01:00Z',{title:'Schedule Summary',truck:undefined,facts:[{label:'Appointments',value:'3'}]})
];
snapshot.crewProgress!.updatesComplete=false;snapshot.crewProgress!.updateHistoryReasons=['LinxUp alert history is missing; coverage is unknown.'];
createRoot(document.getElementById('root')!).render(<main className="ops-app" style={{fontFamily:'system-ui',maxWidth:1100,margin:'20px auto'}}><h1>Local synthetic preview</h1><CrewProgressAlerts live={{snapshot,pendingAlertId:null,error:'',onDateChange:()=>{},onAlertAction:async()=>{}}} openAlert={()=>{}} openControl={()=>{}}/><PushSettings/></main>);
