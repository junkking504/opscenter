'use client';
import {useEffect,useRef,useState} from 'react';
import {CREW_PHONE_API,type CrewPhoneSetupChoice} from '@/lib/crew-phone';
import {chicagoDateKey} from '@/lib/chicago-date';
import styles from './phone-access.module.css';
const storageKey='waypoint-setup-request-v1';
type Saved={choiceId:string;requestId:string;createdAt:number};
export default function RequestSetupCode({busy,onBusy}:{busy:boolean;onBusy:(value:boolean)=>void}) {
  const [choiceId,setChoiceId]=useState(''),[choices,setChoices]=useState<CrewPhoneSetupChoice[]>([]),[saved,setSaved]=useState<Saved|null>(null),[message,setMessage]=useState(''),[error,setError]=useState('');
  const sending=useRef(false);
  useEffect(()=>{
    try{const value=JSON.parse(localStorage.getItem(storageKey)||'null') as Saved|null;if(value?.choiceId && value.requestId && Number.isFinite(value.createdAt) && chicagoDateKey(new Date(value.createdAt))===chicagoDateKey()){setChoiceId(value.choiceId);setSaved(value);}}catch{/* A send requires working storage. */}
    void fetch(`${CREW_PHONE_API}?setup=choices`,{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok || !Array.isArray(body.choices))throw new Error(body.error || 'Phone choices are unavailable.');setChoices(body.choices);}).catch(error=>setError(error instanceof Error?error.message:'Phone choices are unavailable.'));
  },[]);
  async function requestCode(event:React.FormEvent) {
    event.preventDefault();if(busy || sending.current)return;
    sending.current=true;onBusy(true);setError('');setMessage('');
    try {
      const current=saved?.choiceId===choiceId?saved:{choiceId,requestId:crypto.randomUUID(),createdAt:Date.now()};
      try {localStorage.setItem(storageKey,JSON.stringify(current));}catch{throw new Error('Allow browser storage before requesting a setup code.');}
      setSaved(current);
      const response=await fetch(CREW_PHONE_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request-code',choiceId:current.choiceId,requestId:current.requestId})});
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
    <p>Choose the phone you are using today. OpsBot will send its setup code on WhatsApp.</p>
    <form className={styles.form} onSubmit={requestCode}>
      <label>Phone<select value={choiceId} onChange={e=>{setChoiceId(e.target.value);setMessage('');setError('');}} required disabled={busy || !choices.length}><option value="">Choose this phone</option>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
      <button className={styles.primary} disabled={busy || !choiceId}>{busy?'Please wait…':saved?.choiceId===choiceId?'Check send status':'Send setup code via OpsBot'}</button>
    </form>
    {message && <p role="status">{message}</p>}{error && <p className={styles.error} role="alert">{error}</p>}
    {saved && <button className={styles.secondary} disabled={busy} onClick={newRequest}>Request a new code</button>}
  </section>;
}
