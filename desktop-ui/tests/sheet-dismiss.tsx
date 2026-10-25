import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {SheetDismissHandle} from '../components/mobile-interactions';
import '../design-tokens.css';
function Fixture(){
 const [open,setOpen]=useState(true),[disabled,setDisabled]=useState(false),[dismisses,setDismisses]=useState(0),[underlyingClicks,setUnderlyingClicks]=useState(0);
 const dismiss=()=>{setDismisses(n=>n+1);setOpen(false);};
 return <><style>{`body{margin:0;font:16px system-ui;background:#eef3f7}main{padding:12px}#results{display:block;font-size:12px;overflow-wrap:anywhere}*{box-sizing:border-box}.sheet>*{min-width:0}button{min-height:44px}.sheet{position:fixed;inset:180px 12px auto;padding:16px;border:1px solid #99a;background:white;border-radius:16px;display:grid;gap:12px}.body{height:180px;overflow:auto}.body>div{height:800px;background:linear-gradient(#fff,#dde5ef)}.mobile-sheet-dismiss{margin:0}h1{font-size:20px}`}</style><main>
 <button id="open" onClick={()=>setOpen(true)}>Open synthetic sheet</button><label><input id="disabled" type="checkbox" checked={disabled} onChange={e=>setDisabled(e.target.checked)}/>Disable dismissal</label>
 <output id="results">{JSON.stringify({open,disabled,dismisses,underlyingClicks})}</output>
 <button id="underlying" style={{position:'fixed',top:260,left:12,width:366,height:140}} onClick={()=>setUnderlyingClicks(n=>n+1)}>Synthetic underlying action</button>
 {open && <section className="sheet" role="dialog" aria-label="Synthetic details"><SheetDismissHandle onDismiss={dismiss} disabled={disabled}/><h1>Synthetic details</h1><div className="body"><div>Scroll-safe synthetic content. No records or actions.</div></div></section>}
 </main></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
