'use client';
import {useEffect,useRef,useState,type ReactNode} from 'react';
import {CREW_PHONE_API,type CrewPhoneSetupChoice} from '@/lib/crew-phone';
import {chicagoDateKey} from '@/lib/chicago-date';
import styles from './phone-access.module.css';
const storageKey='waypoint-setup-request-v1';
type Saved={choiceId:string;requestId:string;createdAt:number;canRequestNewCode?:boolean};
type Props={busy:boolean;onBusy:(value:boolean)=>void;hasPendingCode:boolean;onChoosePhone:()=>void;connectionError:string;onCheckConnection:()=>void;children:ReactNode};
export default function RequestSetupCode({busy,onBusy,hasPendingCode,onChoosePhone,connectionError,onCheckConnection,children}:Props) {
  const [choiceId,setChoiceId]=useState(''),[choices,setChoices]=useState<CrewPhoneSetupChoice[]>([]),[saved,setSaved]=useState<Saved|null>(null),[message,setMessage]=useState(''),[error,setError]=useState('');
  const [codeVisible,setCodeVisible]=useState(hasPendingCode);
  const sending=useRef(false),focusCode=useRef(false),codeEntry=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    try{const value=JSON.parse(localStorage.getItem(storageKey)||'null') as Saved|null;if(value?.choiceId && value.requestId && Number.isFinite(value.createdAt) && chicagoDateKey(new Date(value.createdAt))===chicagoDateKey()){setChoiceId(value.choiceId);setSaved(value);setCodeVisible(true);}}catch{/* A send requires working storage. */}
    let active=true;
    void fetch(`${CREW_PHONE_API}?setup=choices`,{cache:'no-store'}).then(async response=>{const body=await response.json();if(!response.ok || !Array.isArray(body.choices))throw new Error(body.error || 'Phone choices are unavailable.');if(active)setChoices(body.choices);}).catch(error=>{if(active)setError(error instanceof Error?error.message:'Phone choices are unavailable.');});
    return()=>{active=false;};
  },[]);
  useEffect(()=>{if(hasPendingCode)setCodeVisible(true);},[hasPendingCode]);
  useEffect(()=>{if(codeVisible && focusCode.current){focusCode.current=false;codeEntry.current?.querySelector('input')?.focus();}},[codeVisible]);
  function showCode(){focusCode.current=true;setCodeVisible(true);}
  async function requestCode(event?:React.FormEvent) {
    event?.preventDefault();if(busy || sending.current || !choiceId)return;
    sending.current=true;onBusy(true);setError('');setMessage('');
    try {
      const current=saved?.choiceId===choiceId?saved:{choiceId,requestId:crypto.randomUUID(),createdAt:Date.now()};
      try {localStorage.setItem(storageKey,JSON.stringify(current));}catch{throw new Error('Allow browser storage before requesting a setup code.');}
      setSaved(current);
      const response=await fetch(CREW_PHONE_API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'request-code',choiceId:current.choiceId,requestId:current.requestId})});
      const result=await response.json();
      const checked={...current,canRequestNewCode:result.canRequestNewCode===true};
      localStorage.setItem(storageKey,JSON.stringify(checked));setSaved(checked);
      if(!response.ok)throw new Error(result.error || 'The send could not be confirmed. Check WhatsApp, then check send status.');
      setMessage(result.message);
      // A successful HTTP response can still describe an uncertain send. Keep
      // that message and same-request status recovery beside manual code entry.
      showCode();
    }catch(e){setError(e instanceof Error && !(e instanceof TypeError)?e.message:'The send could not be confirmed. Check WhatsApp, then check send status.');}
    finally{sending.current=false;onBusy(false);}
  }
  function choosePhone(){onChoosePhone();setCodeVisible(false);setError('');setMessage('');}
  function newRequest(){
    if(busy || sending.current)return;
    if(saved && saved.canRequestNewCode!==true){setError('Check send status first so an unconfirmed send is not repeated.');return;}
    try{localStorage.removeItem(storageKey);setSaved(null);choosePhone();}catch{setError('Allow browser storage before requesting a new code.');}
  }
  return <section className={styles.connection} aria-labelledby="connect-phone-heading">
    <h1 id="connect-phone-heading">Connect Your Phone</h1>
    <div className={styles.connectionIntro}>
      <p>Choose the phone you are using today.</p>
      <p>Operations will send a verification code on WhatsApp</p>
    </div>
    {!codeVisible ? <>
      <form className={`${styles.form} ${styles.connectionForm}`} onSubmit={requestCode}>
        <label>Phone<select value={choiceId} onChange={e=>{setChoiceId(e.target.value);setMessage('');setError('');}} required disabled={busy || !choices.length}><option value="">Choose this phone</option>{choices.map(choice=><option key={choice.id} value={choice.id}>{choice.label}</option>)}</select></label>
        <button className={styles.primary} disabled={busy || !choiceId}>{busy?'Please wait…':saved?.choiceId===choiceId?'Check send status':'Send setup code'}</button>
      </form>
      <button className={styles.connectionLink} disabled={busy} onClick={showCode}>Already have a code?</button>
    </> : <div className={styles.codeEntry} ref={codeEntry}>
      <div className={styles.codeContext}>
        <p>{choices.find(choice=>choice.id===choiceId)?.label || 'Enter your verification code'}</p>
        <button className={styles.connectionLink} disabled={busy} onClick={choosePhone}>Choose phone</button>
      </div>
      <p className={styles.muted}>Enter the 6-digit code from Operations to connect this phone for today.</p>
      {children}
      {saved?.choiceId===choiceId && <button className={styles.connectionLink} disabled={busy} onClick={()=>void requestCode()}>Check send status</button>}
    </div>}
    {(codeVisible || saved) && <div className={styles.form}>
      <button className={`${styles.secondary} ${styles.replacementCode}`} disabled={busy} onClick={newRequest}>Request a new code</button>
      <p className={styles.muted}>You can request a replacement immediately after checking send status. Only the newest unused code works; codes expire after 10 minutes. Daily send limits apply.</p>
    </div>}
    {message && <p className={styles.connectionNotice} role="status">{message}</p>}
    {(error || connectionError) && <p className={styles.error} role="alert">{error || connectionError}</p>}
    <ol className={styles.connectionSteps} aria-label="Start your day">
      <li aria-current="step"><span className={styles.stepNumber} aria-hidden="true">1</span><div><strong>Connect phone</strong><p>Get a setup code from Operations.</p></div></li>
      <li><span className={styles.stepNumber} aria-hidden="true">2</span><div><strong>Truck setup</strong><p>Set up your truck and crew.</p></div></li>
      <li><span className={styles.stepNumber} aria-hidden="true">3</span><div><strong>Inspection</strong><p>Complete today’s inspection.</p></div></li>
    </ol>
    <details className={styles.connectionHelp}>
      <summary>Need help connecting?</summary>
      <p>Check WhatsApp for the code from Operations. If the connection is uncertain, check its status before trying again.</p>
      <button className={styles.secondary} disabled={busy} onClick={onCheckConnection}>Check connection</button>
    </details>
  </section>;
}
