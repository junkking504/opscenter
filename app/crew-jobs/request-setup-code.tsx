'use client';
import {useEffect,useRef,useState} from 'react';
import {CREW_PHONE_API} from '@/lib/crew-phone';
import styles from './phone-access.module.css';
const storageKey='waypoint-setup-request-v1';
type Saved={number:string;requestId:string;createdAt:number};
export default function RequestSetupCode({busy,onBusy}:{busy:boolean;onBusy:(value:boolean)=>void}) {
  const [number,setNumber]=useState(''),[saved,setSaved]=useState<Saved|null>(null),[message,setMessage]=useState(''),[error,setError]=useState('');
  const sending=useRef(false);
  useEffect(()=>{try{const value=JSON.parse(localStorage.getItem(storageKey)||'null') as Saved|null;if(value?.number && value.requestId && Number.isFinite(value.createdAt)){setNumber(value.number);setSaved(value);}}catch{/* A send requires working storage. */}},[]);
  async function requestCode(event:React.FormEvent) {
    event.preventDefault();if(busy || sending.current)return;
    sending.current=true;onBusy(true);setError('');setMessage('');
    try {
      const current=saved?.number===number?saved:{number,requestId:crypto.randomUUID(),createdAt:Date.now()};
      try {localStorage.setItem(storageKey,JSON.stringify(current));}catch{throw new Error('Allow browser storage before requesting a setup code.');}
      setSaved(current);
      const response=await fetch(CREW_PHONE_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request-code',number:current.number,requestId:current.requestId})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error || 'The send could not be confirmed. Check WhatsApp, then check send status.');
      setMessage(result.message);
    }catch(e){setError(e instanceof Error?e.message:'The send could not be confirmed. Check WhatsApp, then check send status.');}
    finally{sending.current=false;onBusy(false);}
  }
  function newRequest(){
    if(saved && Date.now()-saved.createdAt<10*60_000){setError('Check WhatsApp for the existing code. Wait 10 minutes before requesting a new one.');return;}
    try{localStorage.removeItem(storageKey);setSaved(null);setMessage('');setError('');}catch{setError('Allow browser storage before requesting a new code.');}
  }
  return <section>
    <p>Enter this company phone’s number. OpsBot will send its setup code on WhatsApp.</p>
    <form className={styles.form} onSubmit={requestCode}>
      <label>Company phone number<input type="tel" inputMode="tel" autoComplete="tel" value={number} maxLength={32} onChange={e=>{setNumber(e.target.value);setMessage('');setError('');}} placeholder="(504) 555-0100" required disabled={busy}/></label>
      <button className={styles.primary} disabled={busy || number.replace(/\D/g,'').length<10}>{busy?'Please wait…':saved?.number===number?'Check send status':'Send setup code via OpsBot'}</button>
    </form>
    {message && <p role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    {saved && <button className={styles.secondary} disabled={busy} onClick={newRequest}>Request a new code</button>}
  </section>;
}
