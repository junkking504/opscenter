import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {MobileInteractions} from '../components/mobile-interactions';
import '../design-tokens.css';
const workspaces=[{workspace:'Command',label:'Dashboard'},{workspace:'Schedule',label:'Command'},{workspace:'Krewe',label:'Krewe'},{workspace:'Fleet',label:'Fleet'},{workspace:'Marketing',label:'Marketing'}];
function Fixture(){
 const root=useRef<HTMLElement|null>(null);
 const [active,setActive]=useState('Command'),[busy,setBusy]=useState(false),[drawer,setDrawer]=useState(false),[refreshes,setRefreshes]=useState(0),[opens,setOpens]=useState(0);
 return <main ref={root}><style>{`body{margin:0;font:16px system-ui}main{padding:12px}h1{font-size:24px}button,input,select{min-height:44px}#swipe-space{height:90px;background:#eef3f7;padding:20px;box-sizing:border-box}#nested{height:70px;overflow-y:auto}#nested div{height:200px}#carousel{overflow-x:auto;width:250px}#carousel div{width:600px;height:50px}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`}</style>
 <h1>{workspaces.find(item=>item.workspace===active)?.label}</h1>
 <select aria-label="Choose workspace" value={active} onChange={e=>setActive(e.target.value)}>{workspaces.map(item=><option key={item.workspace} value={item.workspace}>{item.label}</option>)}</select>
 <button type="button" onClick={()=>setBusy(!busy)}>Busy: {String(busy)}</button><button type="button" onClick={()=>setDrawer(!drawer)}>Toggle drawer</button>
 <div id="swipe-space">Open page space</div>
 <button type="button" id="metric" data-gesture-preview="revenue" onClick={()=>setOpens(value=>value+1)}>Revenue $125</button>
 <input aria-label="Unsaved note" defaultValue="draft"/><div id="nested"><div>Nested scrolling</div></div><div id="carousel"><div>Horizontal content</div></div><div id="map" className="leaflet-container">Map</div><div id="drag" draggable>Drag appointment</div><div id="selection">Selectable description</div>
 {drawer && <aside className="record-drawer">Unsaved record</aside>}
 <MobileInteractions contentRef={root} activeWorkspace={active} workspaces={workspaces} onNavigate={setActive} busy={busy} previews={[{id:'revenue',label:'Revenue',value:'$125',detail:'Synthetic metric; no operational records'}]} onRefresh={async()=>{setRefreshes(value=>value+1);await new Promise(resolve=>setTimeout(resolve,100));}}/>
 <output id="results">{JSON.stringify({active,refreshes,opens})}</output>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
