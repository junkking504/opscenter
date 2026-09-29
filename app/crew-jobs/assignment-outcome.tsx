import type {CrewScheduledJob} from '@/lib/crew-dispatch';
import styles from './phone-access.module.css';
const money=(value:number)=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);

export default function AssignmentOutcome({job}:{job:CrewScheduledJob;details?:boolean}) {
  const estimate=/^estimate$/i.test(job.appointmentType || '');
  if(!/^completed$/i.test(job.status))return estimate?<p>Estimate · Not closed out</p>:null;
  const amount=typeof job.closedTotal==='number'?money(job.closedTotal):null,c=job.closeout;
  return <section className={styles.closedOutcome} aria-label="Saved closeout"><p className={styles.closedBadge}>{estimate?'Completed Estimate':'Completed Job'} | JunkWare ✔️</p>{amount && <p className={styles.closedTotal}><strong>{amount}</strong></p>}
    {!amount && <p>Saved amount is awaiting source details.</p>}
    {c && <><dl className={styles.closeoutFacts}>
      <div><dt>{estimate?'Quoted load':'Load'}</dt><dd>{c.loadSize || (c.loadQuantity?`${c.loadQuantity} full truck${c.loadQuantity===1?'':'s'}`:'None recorded')}{c.loadSize && c.loadQuantity>1?` × ${c.loadQuantity}`:''} · {money(c.loadPrice)}</dd></div>
      {(c.bedloadPrice>0 || c.bedloadSize) && <div><dt>Bedload</dt><dd>{c.bedloadQuantity || 1} × {c.bedloadSize || 'Full bed'} · {money(c.bedloadPrice)}</dd></div>}
      {c.otherCharges.map((charge,i)=><div key={`${charge.name}-${i}`}><dt>{charge.name}</dt><dd>{charge.quantity!==1?`${charge.quantity} × ${money(charge.unitPrice)} · `:''}{money(charge.total)}</dd></div>)}
      {c.discount!==0 && <div><dt>Discount</dt><dd>−{money(Math.abs(c.discount))}</dd></div>}
      {c.tip!==0 && <div><dt>Tip</dt><dd>{money(c.tip)}</dd></div>}
      <div><dt>{estimate?'Estimate total':'Total'}</dt><dd>{money(c.total)}</dd></div>
      <div><dt>Payment</dt><dd>{c.payments.length?c.payments.map((payment,i)=><span key={i}>{payment.method}{payment.detail?` ${payment.detail}`:''}</span>):'None'}</dd></div>
    </dl>{estimate && <p>Estimate only · not a completed pickup or collected revenue.</p>}</>}
    {estimate && job.estimateOutcomes?.map((note,index)=><p key={index}>{note}</p>)}
  </section>;
}
