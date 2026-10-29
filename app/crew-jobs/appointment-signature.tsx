'use client';
import {useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import {signatureDrawing,signatureReceipt,signatureSubmission,type AppointmentSignature,type SignatureSubmission} from '@/lib/appointment-signature';
import type {SignatureDrawing} from '@/lib/amazon-closeout';
import styles from './phone-access.module.css';
import signatureStyles from './appointment-signature.module.css';

export function SignatureInk({drawing}:{drawing:SignatureDrawing|null}) {
 return <>{drawing?.strokes.map((stroke,index)=><polyline key={index} points={stroke.map(point=>point.join(',')).join(' ')} fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>)}</>;
}
export function OptionalSignaturePad({drawing,onChange,disabled=false}:{drawing:SignatureDrawing|null;onChange:(drawing:SignatureDrawing|null)=>void;disabled?:boolean}) {
 const active=useRef<{id:number;prior:SignatureDrawing|null;strokes:SignatureDrawing['strokes']}|null>(null);
 const [signing,setSigning]=useState(false),[error,setError]=useState('');
 const point=(event:PointerEvent<SVGSVGElement>):[number,number]=>{const box=event.currentTarget.getBoundingClientRect();return [Math.round(Math.max(0,Math.min(600,(event.clientX-box.left)/box.width*600))),Math.round(Math.max(0,Math.min(200,(event.clientY-box.top)/box.height*200)))];};
 const cancel=()=>{const current=active.current;active.current=null;if(current)onChange(current.prior);};
 return <div>
  <p>{signing?'Sign inside the box. Scroll outside it to move the page.':'Tap Start signing to use the drawing area. You can scroll across it until then.'}</p>
  <button type="button" disabled={disabled} onClick={()=>{cancel();setSigning(value=>!value);setError('');}}>{signing?'Finish drawing':'Start signing'}</button>
  <svg viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label="Optional appointment signature drawing area" className={signatureStyles.canvas} style={{touchAction:signing&&!disabled?'none':'pan-y'}}
   onPointerDown={event=>{if(!signing||disabled||active.current||!event.isPrimary||event.button!==0)return;if((drawing?.strokes.length||0)>=100){setError('Clear the drawing and sign again.');return;}event.preventDefault();const strokes=drawing?.strokes.map(stroke=>[...stroke])||[];active.current={id:event.pointerId,prior:drawing,strokes};event.currentTarget.setPointerCapture(event.pointerId);strokes.push([point(event)]);onChange({strokes:strokes.map(stroke=>[...stroke])});}}
   onPointerMove={event=>{const current=active.current;if(!current||current.id!==event.pointerId)return;if(disabled){cancel();return;}if(current.strokes.reduce((count,stroke)=>count+stroke.length,0)>=2000){setError('Clear the drawing and sign again.');cancel();return;}current.strokes.at(-1)!.push(point(event));onChange({strokes:current.strokes.map(stroke=>[...stroke])});}}
   onPointerUp={event=>{if(active.current?.id!==event.pointerId)return;active.current=null;event.currentTarget.releasePointerCapture(event.pointerId);}}
   onPointerCancel={cancel} onLostPointerCapture={cancel}>
   <SignatureInk drawing={drawing}/>
  </svg>
  <button type="button" disabled={disabled||!drawing} onClick={()=>{active.current=null;onChange(null);setError('');}}>Clear signature</button>
  {error&&<p role="alert">{error}</p>}
 </div>;
}
async function responseReceipt(response:Response,appointmentId:string):Promise<AppointmentSignature|null> {
 const body=await response.json();if(!response.ok)throw new Error(body.error||'Signature could not be checked.');
 if(!Object.hasOwn(body,'receipt'))throw new Error('Signature response could not be verified.');
 return body.receipt===null?null:signatureReceipt(body.receipt,appointmentId);
}
export default function AppointmentSignatureSection({appointmentId,assignmentId,deviceId,readOnly=false,test=false,onBusyChange}:{appointmentId:string;assignmentId?:string;deviceId:string;readOnly?:boolean;test?:boolean;onBusyChange:(busy:boolean)=>void}) {
 const nameId=useId(),key=`waypoint-signature:${deviceId}:${appointmentId}:${assignmentId||''}`;
 const [open,setOpen]=useState(false),[editing,setEditing]=useState(false),[drawing,setDrawing]=useState<SignatureDrawing|null>(null),[name,setName]=useState(''),[saved,setSaved]=useState<AppointmentSignature|null>(null),[pending,setPending]=useState<SignatureSubmission|null>(null),[busy,setBusy]=useState(false),[checked,setChecked]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const inFlight=useRef(false),mounted=useRef(true);
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;onBusyChange(false);};},[onBusyChange]);
 useEffect(()=>{onBusyChange(busy||editing||Boolean(pending));},[busy,editing,pending,onBusyChange]);
 const locked=busy||Boolean(pending);
 const run=async(action:()=>Promise<void>)=>{if(inFlight.current)return;inFlight.current=true;setBusy(true);setError('');try{await action();}catch(error){if(mounted.current)setError(error instanceof Error?error.message:'Signature unavailable.');}finally{inFlight.current=false;if(mounted.current)setBusy(false);}};
 const accept=(receipt:AppointmentSignature,expected?:SignatureSubmission)=>{
  if(expected&&(receipt.requestId!==expected.requestId||receipt.signerName!==expected.signerName||JSON.stringify(receipt.drawing)!==JSON.stringify(expected.drawing)))throw Error('The saved result does not match this signature. Keep this screen open and contact the office.');
  sessionStorage.removeItem(key);setSaved(receipt);setChecked(true);setPending(null);setEditing(false);setDrawing(null);setName('');setNotice('Signature saved and verified in OpsCenter.');
 };
 const check=(attempt?:SignatureSubmission)=>run(async()=>{
  const response=await fetch(`/api/crew-jobs/signatures?${new URLSearchParams({assignmentId:assignmentId!,...(attempt?{requestId:attempt.requestId}:{})})}`,{cache:'no-store',signal:AbortSignal.timeout(15_000)});
  const receipt=await responseReceipt(response,appointmentId);
  if(receipt){if(attempt)accept(receipt,attempt);else setSaved(receipt);}
  else if(attempt){setNotice('No saved signature was found. Retry the same save when your connection is ready.');setChecked(true);}
  else setSaved(null);
  if(!attempt)setChecked(true);
 });
 const show=()=>{setOpen(true);setNotice('');try{const raw=sessionStorage.getItem(key);if(raw){const attempt=signatureSubmission(JSON.parse(raw));if(attempt.assignmentId!==assignmentId)throw Error('Saved signature draft belongs to another assignment.');setPending(attempt);setName(attempt.signerName);setDrawing(attempt.drawing);setEditing(true);void check(attempt);return;}}catch{setError('Phone storage is unavailable or the saved draft needs attention. Reload before signing.');return;}void check();};
 const send=(retry?:SignatureSubmission)=>run(async()=>{
  let attempt:SignatureSubmission;
  try{attempt=retry||signatureSubmission({requestId:crypto.randomUUID(),assignmentId,signerName:name,drawing:signatureDrawing(drawing)});}catch(error){throw error;}
  sessionStorage.setItem(key,JSON.stringify(attempt));setPending(attempt);setChecked(false);setNotice('Saving signature…');
  try{
   const response=await fetch('/api/crew-jobs/signatures',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(attempt),signal:AbortSignal.timeout(15_000)});
   const receipt=await responseReceipt(response,appointmentId);if(!receipt)throw Error('Saved signature was not returned.');accept(receipt,attempt);
  }catch{setNotice('Save not confirmed. Check the saved signature before doing anything else.');throw Error('The connection or save needs attention. Your request is retained; checking does not submit it again.');}
 });
 return <section className={signatureStyles.section} aria-label="Appointment signature">
  <h2>Signature <small>Optional</small></h2><p className={styles.muted}>Saved with this appointment in OpsCenter. Existing closeout requirements still apply.</p>
  {readOnly||!assignmentId||test?<p className={styles.muted}>{test?'Signature storage is unavailable on test phones.':'View only · Signature capture stays with the authorized appointment crew.'}</p>:!open?<button type="button" className={styles.secondary} onClick={show}>View or add signature</button>:<>
   {saved&&<div><p><strong>{saved.signerName}</strong> · Saved {new Date(saved.signedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} Central</p><svg viewBox="0 0 600 200" role="img" aria-label={`Saved signature by ${saved.signerName}`} className={signatureStyles.canvas}><SignatureInk drawing={saved.drawing}/></svg></div>}
   {editing?<><label htmlFor={nameId}>Signer name</label><input id={nameId} value={name} maxLength={100} disabled={locked} autoComplete="off" onChange={event=>setName(event.target.value)}/><OptionalSignaturePad drawing={drawing} onChange={setDrawing} disabled={locked}/>
    {!pending&&<><button type="button" className={styles.primary} disabled={busy} onClick={()=>void send()}>Save signature</button><button type="button" disabled={busy} onClick={()=>{setEditing(false);setDrawing(null);setName('');setError('');}}>Cancel drawing</button></>}
   </>:checked&&!pending&&<button type="button" disabled={busy} className={styles.secondary} onClick={()=>{setEditing(true);setDrawing(null);setName('');setNotice('');}}>{saved?'Sign again':'Add signature'}</button>}
   {pending&&<><button type="button" disabled={busy} onClick={()=>void check(pending)}>Check saved signature</button>{checked&&<button type="button" disabled={busy} onClick={()=>void send(pending)}>Retry same save</button>}<button type="button" disabled={busy} onClick={()=>{setOpen(false);setEditing(false);setPending(null);setNotice('The unconfirmed save is retained on this phone. Open this section to check it again.');}}>Close and keep pending save</button></>}
   {!busy&&!editing&&!checked&&!pending&&<button type="button" onClick={()=>void check()}>Check saved signature</button>}
   {busy&&<p role="status">Checking signature…</p>}
  </>}
  {notice&&<p role="status">{notice}</p>}{error&&<p role="alert">{error}</p>}
 </section>;
}
