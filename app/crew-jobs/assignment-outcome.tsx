import type {CrewScheduledJob} from '@/lib/crew-dispatch';

export default function AssignmentOutcome({job}:{job:CrewScheduledJob}) {
  const estimate=/^estimate$/i.test(job.appointmentType || '');
  if(!/^completed$/i.test(job.status))return estimate?<p>Estimate · Not closed out</p>:null;
  const amount=typeof job.closedTotal==='number'
    ?new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(job.closedTotal):null;
  return <div role="status"><p><strong>{estimate?'Closed as estimate':/^job$/i.test(job.appointmentType || '')?'Closed as job':'Closed out'}{amount?` · ${amount}`:''}</strong></p>
    {!amount && <p>Saved amount is awaiting source details.</p>}
    {estimate && job.estimateOutcomes?.map((note,index)=><p key={index}>{note}</p>)}
  </div>;
}
