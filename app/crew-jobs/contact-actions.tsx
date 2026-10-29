'use client';
import {useId,useState} from 'react';
import {customerPhoneHref} from './customer-phone-link';
import {etaMessage} from './eta-message';
import styles from './contact-actions.module.css';

const MINUTES=[10,15,20,30];

export default function ContactActions({phone,customerName,eta=true}:{phone:string;customerName:string;eta?:boolean}) {
  const href=customerPhoneHref(phone),panelId=useId();
  const [open,setOpen]=useState(false),[minutes,setMinutes]=useState(15);
  if(!href)return null;
  const sms=href.replace(/^tel:/,'sms:');
  const text=etaMessage(customerName,minutes);
  return <div className={styles.actions}>
    <div className={styles.row}>
      <a href={href}>Call</a>
      <a href={sms}>Message</a>
      {eta&&<button type="button" aria-expanded={open} aria-controls={panelId} onClick={()=>setOpen(value=>!value)}>Send ETA</button>}
    </div>
    {eta&&open&&<div id={panelId} className={styles.panel}>
      <div className={styles.chips} role="group" aria-label="Minutes away">
        {MINUTES.map(value=><button type="button" key={value} aria-pressed={minutes===value} onClick={()=>setMinutes(value)}>{value} Min</button>)}
      </div>
      <p>{text}</p>
      <a className={styles.send} href={`${sms}&body=${encodeURIComponent(text)}`}>Open In Messages</a>
    </div>}
  </div>;
}
