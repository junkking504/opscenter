import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CrewProgressAlerts} from '../components/crew-progress-alerts';
import {alert,fixtureSnapshot} from '../../scripts/fixtures/crew-progress';

function Fixture() {
  const [snapshot,setSnapshot] = useState(fixtureSnapshot);
  const [opened,setOpened] = useState('');
  return <main style={{maxWidth:1280,margin:'20px auto',padding:'0 16px'}}>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,fontSize:13,alignItems:'center'}}><strong>Local design preview · synthetic records</strong><span>No live operational actions</span><button onClick={() => setSnapshot(old => ({...old,sources:{...old.sources,workflow:false},crewProgress:{...old.crewProgress!,scheduleCurrent:false,visitsCurrent:false,updatesComplete:false}}))}>Simulate disconnected sources</button><button onClick={() => setSnapshot(old => ({...old,crewProgress:{...old.crewProgress!,updatesComplete:false}}))}>Simulate partial history</button><button onClick={() => setSnapshot(old => ({...old,alerts:[...old.alerts,alert('unindexed','Truck Unloaded','2026-09-07T09:25:00-05:00',{title:'Truck 2',domain:'Fleet',href:'/fleet'}),alert('timeless','Inspection','2026-09-07T14:00:00Z',{timestamp:'',detected:'Time unavailable',title:'Truck 3',truck:'Truck 3',domain:'Fleet',href:'/fleet'})]}))}>Simulate unindexed updates</button><button onClick={() => setSnapshot(old => ({...old,alerts:[...old.alerts,alert('linxup-geofence-warehouse','Geofence Entry','2026-09-07T09:25:00-05:00',{source:'LinxUp',title:'Truck 2 · Junk King warehouse',truck:'Truck 2',domain:'Fleet',facts:[{label:'Location',value:'Junk King warehouse'},{label:'Entered',value:'9:25 AM'},{label:'Truck load',value:'Unchanged'}],href:'/desktop?workspace=Fleet&date=2026-09-07&truck=Truck%23%202'})]}))}>Simulate warehouse entry</button><button onClick={() => setSnapshot(fixtureSnapshot())}>Reset preview</button></div>
    <CrewProgressAlerts live={{snapshot,pendingAlertId:null,error:'',onDateChange:()=>{},onAlertAction:async (id,action) => setSnapshot(old => ({...old,alerts:old.alerts.map(alert => alert.id === id ? {...alert,workflowState:action === 'acknowledge' ? 'acknowledged':'in-control',version:alert.version+1} : alert)}))}} openAlert={alert => setOpened(alert.href)} openControl={() => setOpened('Control')}/>
    <p role="status">{opened && `Preview opened record: ${opened}`}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
