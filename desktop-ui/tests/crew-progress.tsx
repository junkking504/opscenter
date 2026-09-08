import {consolidateCrewClockOutAlerts} from '../../lib/crew-clock-out-alerts';
import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {CrewProgressAlerts} from '../components/crew-progress-alerts';
import {alert,fixtureSnapshot} from '../../scripts/fixtures/crew-progress';

function Fixture() {
  const [snapshot,setSnapshot] = useState(fixtureSnapshot);
  const [opened,setOpened] = useState('');
  return <main style={{maxWidth:1280,margin:'20px auto',padding:'0 16px'}}>
    <div style={{display:'flex',flexWrap:'wrap',gap:12,fontSize:13,alignItems:'center'}}><strong>Local design preview · synthetic records</strong><span>No live operational actions</span><button onClick={() => setSnapshot(old => ({...old,sources:{...old.sources,workflow:false},crewProgress:{...old.crewProgress!,scheduleCurrent:false,visitsCurrent:false,updatesComplete:false}}))}>Simulate disconnected sources</button><button onClick={() => setSnapshot(old => ({...old,crewProgress:{...old.crewProgress!,updatesComplete:false}}))}>Simulate partial history</button><button onClick={() => setSnapshot(old => ({...old,alerts:[...old.alerts,alert('unindexed','Truck Unloaded','2026-09-07T09:25:00-05:00',{title:'Truck 2',domain:'Fleet',href:'/fleet'}),alert('timeless','Inspection','2026-09-07T14:00:00Z',{timestamp:'',detected:'Time unavailable',title:'Truck 3',truck:'Truck 3',domain:'Fleet',href:'/fleet'})]}))}>Simulate unindexed updates</button><button onClick={() => setSnapshot(old => ({...old,alerts:[...old.alerts,alert('linxup-geofence-warehouse','Geofence Entry','2026-09-07T09:25:00-05:00',{source:'LinxUp',title:'Truck 2 · Junk King warehouse',truck:'Truck 2',domain:'Fleet',facts:[{label:'Location',value:'Junk King warehouse'},{label:'Entered',value:'9:25 AM'},{label:'Truck load',value:'Unchanged'}],href:'/desktop?workspace=Fleet&date=2026-09-07&truck=Truck%23%202'})]}))}>Simulate warehouse entry</button><button onClick={() => setSnapshot(old => ({...old,alerts:old.alerts.map(item => item.id === 'closed-one' ? {...item,label:'Estimate Completed'} : item),crewProgress:{...old.crewProgress!,jobs:old.crewProgress!.jobs.map(item => item.jobNumber === 'JK1000001' ? {...item,status:'Estimate completed'} : item)}}))}>Simulate estimate completed</button><button onClick={() => setSnapshot(fixtureSnapshot())}>Reset preview</button></div>
    <CrewProgressAlerts live={{snapshot,pendingAlertId:null,error:'',onDateChange:()=>{},onAlertAction:async (id,action) => setSnapshot(old => ({...old,alerts:old.alerts.map(alert => alert.id === id ? {...alert,workflowState:action === 'acknowledge' ? 'acknowledged':'in-control',version:alert.version+1} : alert)}))}} openAlert={alert => setOpened(alert.href)} openControl={() => setOpened('Control')}/>
    <button onClick={() => setSnapshot(old => {
      const records = [
        alert('clock-out-preview','Clock Out','2026-09-07T23:13:00Z',{title:'Example driver',truck:undefined,domain:'Krewe',href:'/crew?date=2026-09-07',facts:[{label:'Krewe member',value:'Example driver'},{label:'Clock out',value:'6:10 PM'},{label:'Hours',value:'8.25'}]}),
        alert('pay-preview','Final Daily Pay','2026-09-07T23:13:01Z',{title:'Example driver',truck:undefined,domain:'Krewe',facts:[{label:'Krewe member',value:'Example driver'},{label:'Total pay',value:'$225.68'},{label:'Hourly pay',value:'$188.70'},{label:'Tips',value:'$36.98'},{label:'Bonuses',value:'$0.00'}]}),
      ];
      const combined = consolidateCrewClockOutAlerts(records.map(row => ({...row,next:'Review shift.'}))).map(row=>({...records.find(record=>record.id===row.id)!,...row}));
      return {...old,alerts:[...combined,...old.alerts]};
    })}>Simulate clock-out pay</button>
    <p role="status">{opened && `Preview opened record: ${opened}`}</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
