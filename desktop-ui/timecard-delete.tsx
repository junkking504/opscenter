import {useEffect,useRef,useState} from 'react';
type Receipt={id:string;employeeName:string;workDate:string;status:'preview'|'submitted'|'verified'|'failed'|'uncertain';message:string;expiresAt:string;before:{clockIn:string;clockOut:string;hourlyRate:number}};
export default function TimecardDelete({date,periodDate,name,onCancel,onDeleted,onBusy}:{date:string;periodDate:string;name:string;onCancel:()=>void;onDeleted:(message:string)=>Promise<void>;onBusy:(busy:boolean)=>void}){
 const [receipt,setReceipt]=useState<Receipt|null>(null),[pending,setPending]=useState(false),[message,setMessage]=useState(''),[attempted,setAttempted]=useState(false);
 const busy=useRef(false),mounted=useRef(true),confirmation=useRef<HTMLParagraphElement>(null);
 const key=`timecard-delete:${date}:${name}`;
 const [restore,setRestore]=useState(0),[loading,setLoading]=useState(false);
 useEffect(()=>{mounted.current=true;const controller=new AbortController();try{const saved=sessionStorage.getItem(key);if(saved){const value=JSON.parse(saved);setAttempted(Boolean(value.attempted));setLoading(true);void fetch(`/api/desktop/timecards?id=${encodeURIComponent(value.id)}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}).then(r=>r.json()).then(body=>{if(mounted.current&&!controller.signal.aborted){if(body.receipt&&body.receipt.id===value.id&&body.receipt.workDate===date&&body.receipt.employeeName===name)setReceipt(body.receipt);else setMessage(body.error||'Saved result unavailable.');}}).catch(()=>{if(mounted.current&&!controller.signal.aborted)setMessage('Saved result unavailable. Try again when connected.');}).finally(()=>{if(mounted.current&&!controller.signal.aborted)setLoading(false);});}}catch{setMessage('Saved-result storage unavailable.');}return()=>{mounted.current=false;controller.abort();};},[key,date,name,restore]);
 async function run(action:'preview'|'delete'|'check'){
  if(busy.current)return;busy.current=true;setPending(true);onBusy(true);setMessage('');
  try{
   if(action==='delete'){if(!receipt)return;sessionStorage.setItem(key,JSON.stringify({id:receipt.id,attempted:true}));setAttempted(true);}
   const response=await fetch('/api/desktop/timecards',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify(action==='preview'?{action,date,periodDate,name}:{action,id:receipt?.id,...(action==='delete'?{confirm:true}:{})})});
   const body=await response.json();
   if(body.receipt){if(body.receipt.workDate!==date||body.receipt.employeeName!==name||(action!=='preview'&&body.receipt.id!==receipt?.id))throw new Error('Receipt identity changed');setReceipt(body.receipt);const nextAttempted=body.receipt.status==='preview'&&!body.error&&response.ok?false:action!=='preview'||attempted;setAttempted(nextAttempted);sessionStorage.setItem(key,JSON.stringify({id:body.receipt.id,attempted:nextAttempted}));
    if(body.receipt.status==='verified'){sessionStorage.removeItem(key);await onDeleted(body.receipt.message);return;}
   }
   setMessage(body.error||(body.receipt?.status==='preview'?'':body.receipt?.message)||(!body.receipt?'Source entry unavailable.':''));
   if(action==='preview'&&body.receipt?.status==='preview')requestAnimationFrame(()=>confirmation.current?.focus());
  }catch{setMessage(action==='preview'?'Source preview unavailable. Try again when connected.':'Result unconfirmed. Check saved result before another change.');}
  finally{busy.current=false;if(mounted.current){setPending(false);onBusy(false);}}
 }
 const clear=()=>{sessionStorage.removeItem(key);setReceipt(null);setAttempted(false);onCancel();};
 return <section aria-label="Delete time entry">
  <h3>Delete Time Entry</h3>
  <p>{name} · {date}</p>
  {message&&<p role="status">{message}</p>}
  {!receipt&&attempted&&<button style={{minHeight:44}} type="button" disabled={pending||loading} onClick={()=>setRestore(value=>value+1)}>Check saved result</button>}
  {!receipt&&!attempted&&<><p>Load the exact entry from JunkWare before deleting.</p><button style={{minHeight:44}} type="button" disabled={pending||loading} onClick={()=>void run('preview')}>{pending?'Loading…':'Load source entry'}</button></>}
  {receipt&&<>
   <p><strong>{receipt.before.clockIn||'No clock-in'} – {receipt.before.clockOut||'No clock-out'}</strong> · ${receipt.before.hourlyRate.toFixed(2)}/hour</p>
   {receipt.status==='preview'&&!attempted&&<><p ref={confirmation} tabIndex={-1} role="alert">Deletes this entry from JunkWare and affects payroll. This may be permanent.</p><button style={{minHeight:44,marginRight:8,background:'var(--oc-status-critical-tint)',color:'var(--oc-status-critical-ink)',borderColor:'var(--oc-status-critical-accent)'}} type="button" disabled={pending} onClick={()=>void run('delete')}>Delete this entry</button></>}
   {(attempted||receipt.status==='submitted'||receipt.status==='uncertain')&&receipt.status!=='failed'&&<button style={{minHeight:44}} type="button" disabled={pending} onClick={()=>void run('check')}>{pending?'Checking…':'Check saved result'}</button>}
  </>}
  <button style={{minHeight:44}} type="button" disabled={pending} onClick={attempted&&receipt?.status!=='failed'?onCancel:clear}>{attempted?'Close':'Cancel'}</button>
 </section>;
}
