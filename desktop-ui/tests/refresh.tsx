import React, {useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useWorkspaceRefresh, WorkspaceFreshness} from '../workspace-freshness';
function Fixture() {
 const source=useRef({version:1,fail:false,slow:false});
 const [snapshot,setSnapshot]=useState('None');
 const [paused,setPaused]=useState(false), [draft,setDraft]=useState(''), [date,setDate]=useState('Day A');
 const [calls,setCalls]=useState(0);
 const freshness=useWorkspaceRefresh(async signal=>{
  setCalls(n=>n+1); const version=source.current.version, day=date;
  if(source.current.slow) await new Promise(resolve=>setTimeout(resolve,3000));
  if(signal.aborted)return;
  if(source.current.fail)throw new Error('Simulated source offline');
  setSnapshot(`${day} version ${version}`);
 },date,paused,1000);
 return <main><h1>Workspace refresh regression fixture</h1><p>Isolated synthetic data; no network requests or business writes.</p>
 <p>Snapshot: {snapshot}</p><p>Requests started: {calls}</p>
 <WorkspaceFreshness state={freshness} sourceAt={new Date().toISOString()}/>
 <button onClick={()=>source.current.version++}>Advance source</button>
 <button onClick={()=>source.current.fail=true}>Fail source</button><button onClick={()=>source.current.fail=false}>Recover source</button>
 <button onClick={()=>source.current.slow=!source.current.slow}>Toggle slow reads</button>
 <button onClick={()=>setPaused(true)}>Open draft</button><button onClick={()=>setPaused(false)}>Close draft</button>
 <label>Draft text<input value={draft} onChange={e=>setDraft(e.target.value)}/></label>
 <button onClick={()=>setDate(day=>day==='Day A'?'Day B':'Day A')}>Switch operating day</button>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
