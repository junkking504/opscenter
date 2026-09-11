import { useEffect, useState } from 'react';
import { Button } from './components/ui/button';
import { commercialDate, commercialMoney as money, type CommercialOperation } from './lib/commercial-contract';
import type { RecyclingReceiptDraft, RecyclingReceiptLine } from './lib/recycling-receipts';
export function RecyclingReceiptReview({ drafts, busy, onBusyChange, onSave }: { drafts: RecyclingReceiptDraft[]; busy: boolean; onBusyChange?: (busy:boolean) => void; onSave: (operation: Omit<CommercialOperation, 'date' | 'requestId'>) => Promise<boolean> }) {
  const [selected, setSelected] = useState<RecyclingReceiptDraft | null>(null);
  const [rows, setRows] = useState<RecyclingReceiptLine[]>([]), [yard,setYard]=useState(''), [total,setTotal]=useState(''), [paid,setPaid]=useState(false), [paymentDate,setPaymentDate]=useState(''), [reference,setReference]=useState(''), [checked,setChecked]=useState(false);
  const reviewing = Boolean(selected);
  useEffect(() => { onBusyChange?.(reviewing); return () => onBusyChange?.(false); }, [reviewing, onBusyChange]);
  useEffect(() => { if (selected && drafts.find(draft=>draft.id===selected.id)?.status === 'recorded') setSelected(null); }, [drafts, selected]);
  const open = (draft: RecyclingReceiptDraft) => { setSelected(draft);setRows(draft.rows.map(row=>({...row})));setYard(draft.yard);setTotal(draft.total?.toString()||'');setPaid(false);setPaymentDate('');setReference('');setChecked(false); };
  const update = (index: number, values: Partial<RecyclingReceiptLine>) => { setChecked(false);setRows(rows.map((row,i)=>i===index?{...row,...values}:row)); };
  const extractedTotal = rows.some(row=>row.amount==null) ? null : rows.reduce((sum,row)=>sum+Math.round(row.amount!*100),0)/100;
  const reconciles = total !== '' && extractedTotal != null && Math.round(Number(total)*100) === Math.round(extractedTotal*100);
  return <section className="finance-recovery-ledger recycling-receipts"><div className="section-title"><div><h3>Receipt Photos from OpsBot</h3><p>Send <strong>Recycling</strong> to OpsBot on WhatsApp, then all pages of one receipt within 10 minutes. Start a new message for the next receipt.</p></div></div>
    {drafts.filter(draft=>draft.status==='review').map(draft=><article className="recycling-receipt-card" key={draft.id}><div><strong>{draft.yard || 'Recycling receipt'}</strong><small>{commercialDate(draft.receivedAt)} · {draft.photos.length} photos · {draft.rows.length} extracted lines</small></div><strong>{money(draft.total)}</strong><Button variant="outline" size="sm" onClick={()=>open(draft)}>Review Breakdown</Button></article>)}
    {!drafts.some(draft=>draft.status==='review') && <p className="marketing-empty">No receipt photos awaiting review.</p>}
    {drafts.some(draft=>draft.status==='recorded') && <details><summary>Recorded Receipt Photos</summary>{drafts.filter(draft=>draft.status==='recorded').map(draft=><div key={draft.id}><p>{draft.yard} · {money(draft.total)} · {draft.recordIds?.length || 0} daily entries</p><div className="recycling-receipt-photos">{draft.photos.map((photo,index)=><a key={photo.photoId} href={`/api/desktop/finance/recycling-photos/${photo.photoId}`} target="_blank" rel="noreferrer"><img src={`/api/desktop/finance/recycling-photos/${photo.photoId}`} alt={`Recorded recycling receipt page ${index+1}`} loading="lazy" /></a>)}</div></div>)}</details>}
    {selected && <form className="recycling-receipt-editor" onSubmit={event=>{event.preventDefault();void onSave({action:'recycling.receipt.record',recordId:selected.id,expectedVersion:selected.version,values:{rows,total:Number(total),reviewed:checked,yard,paid,paymentDate,paymentReference:reference}}).then(saved=>{if(saved)setSelected(null);});}}>
      <header><h3>Review Receipt Breakdown</h3><Button type="button" variant="outline" disabled={busy} onClick={()=>setSelected(null)}>Close Review</Button></header>
      <div className="recycling-receipt-photos">{selected.photos.map((photo,index)=><a key={photo.photoId} href={`/api/desktop/finance/recycling-photos/${photo.photoId}`} target="_blank" rel="noreferrer"><img src={`/api/desktop/finance/recycling-photos/${photo.photoId}`} alt={`Recycling receipt page ${index+1}`} /></a>)}</div>
      {selected.warnings.map(warning=><p key={warning} className="finance-payment-note">{warning}</p>)}
      <label>Yard<input required maxLength={500} value={yard} onChange={event=>{setYard(event.target.value);setChecked(false);}} /></label>
      <div className="recycling-receipt-lines">{rows.map((row,index)=><div key={index}>
        <label>Ticket date<input type="date" required value={row.date} onChange={event=>update(index,{date:event.target.value})}/></label>
        <label>Ticket<input required maxLength={200} value={row.ticket} onChange={event=>update(index,{ticket:event.target.value})}/></label>
        <label>Metal / material<input required maxLength={500} value={row.material} onChange={event=>update(index,{material:event.target.value})}/></label>
        <label>Net weight (lb)<input type="number" min="0" step="0.01" value={row.weightLb??''} onChange={event=>update(index,{weightLb:event.target.value===''?null:Number(event.target.value)})}/></label>
        <label>Amount<input type="number" required min="0" step="0.01" value={row.amount??''} onChange={event=>update(index,{amount:event.target.value===''?null:Number(event.target.value)})}/></label>
        <Button type="button" variant="outline" size="sm" onClick={()=>{setRows(rows.filter((_,i)=>i!==index));setChecked(false);}}>Remove Line</Button>
      </div>)}</div>
      <Button type="button" variant="outline" onClick={()=>{setRows([...rows,{date:'',ticket:'',material:'',weightLb:null,amount:null}]);setChecked(false);}}>Add Missing Line</Button>
      <label>Complete receipt total<input type="number" required min="0" step="0.01" value={total} onChange={event=>{setTotal(event.target.value);setChecked(false);}} /></label>
      <p>Extracted line total: <strong>{money(extractedTotal)}</strong> · {reconciles?'Matches receipt total':'Does not match receipt total'}</p>
      <label className="recycling-checkbox"><input type="checkbox" checked={paid} onChange={event=>{setPaid(event.target.checked);setChecked(false);}}/>Payment has been received</label>
      {paid&&<><label>Payment received date<input type="date" required value={paymentDate} onChange={event=>setPaymentDate(event.target.value)}/></label><label>Payment method / receipt reference<input required maxLength={500} value={reference} onChange={event=>setReference(event.target.value)}/></label></>}
      <label className="recycling-checkbox"><input type="checkbox" required checked={checked} onChange={event=>setChecked(event.target.checked)}/>I checked all pages, ticket dates and amounts against the photos.</label>
      <Button type="submit" disabled={busy||!checked||!reconciles||!rows.length}>{busy?'Verifying…':'Record Daily Runs'}</Button>
    </form>}
  </section>;
}
