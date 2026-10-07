import { useState } from 'react';
import { Search, FileText, ArrowRight, Download } from 'lucide-react';
import { Button } from './components/ui/button';
import { sameTruck } from './lib/convoy-presentation';
import { filterHistory, historyEntries, historyCosts, recordTitle, linkedInvoiceId } from './lib/convoy-records';
import type { DesktopFleetSnapshot, DesktopFleetTruck, FleetMaintenanceRow } from './lib/people-fleet-contract';
import type { FleetRecord } from './convoy-views';
const money = (n: number | null) => n === null ? 'Not recorded' : n.toLocaleString('en-US',{style:'currency',currency:'USD'});
const dateLabel = (date: string) => date ? new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Date not recorded';
const truckLabel = (name: string) => name.replace(/Truck\s*#\s*/,'Truck ');
const statusLabel = (status: string) => ({completed:'Completed',scheduled:'Scheduled',open:'Open repair',in_progress:'Repair in progress',resolved:'Resolved repair'}[status] || status);
type Props = { snapshot: DesktopFleetSnapshot; trucks: DesktopFleetTruck[]; truckId?: string; open: (record: FleetRecord) => void; compact?: boolean };

export function ConvoyRecords({snapshot,trucks,truckId='',open,compact=false}: Props) {
  const [query,setQuery] = useState(''), [kind,setKind] = useState(''), [category,setCategory] = useState(''), [from,setFrom] = useState(''), [to,setTo] = useState('');
  const all = historyEntries(snapshot);
  const entries = filterHistory(all,{truck:truckId,query,kind,category,from,to});
  const costs = historyCosts(entries);
  const filtered = Boolean(query||kind||category||from||to);
  const reset = () => {setQuery('');setKind('');setCategory('');setFrom('');setTo('');};
  function exportRecords() {
    const cells = [['Truck','Date (service / repair update)','Record','Status','Work','Shop','Recorded cost','Invoice photos'],...entries.map(r=>[truckLabel(r.truck),r.date,r.title,statusLabel(r.status),r.description,r.record?.vendor||r.issue?.owner||'',r.cost===null?'':String(r.cost),String(r.record?.photos?.length||0)])];
    const csv = cells.map(row=>row.map(value=>'"'+(/^[=+\-@\t\r]/.test(value)?"'"+value:value).replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='convoy-records.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className={`convoy-records ${compact?'compact':''}`} aria-label="Repair and maintenance records">
    <header className="convoy-records-heading"><div><h2>{compact?'Service & repair history':'All service, repairs & invoices'}</h2><p>All dates by default. Search the work, shop, VIN, or invoice number.</p></div><Button variant="outline" size="sm" onClick={exportRecords} disabled={!entries.length}><Download size={15}/>Export list</Button></header>
    <div className="convoy-record-filters">
      <label className="convoy-record-search"><span>Search records</span><div><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="e.g. brakes, Danny’s, 44820"/></div></label>
      <label>Record type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">All records</option><option value="invoice">Invoices</option><option value="completed">Completed service</option><option value="repair">Repairs</option><option value="scheduled">Scheduled service</option></select></label>
      <label>Work category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{[...new Set(all.flatMap(r=>r.categories))].sort().map(c=><option key={c}>{c}</option>)}</select></label>
      <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
    </div>
    {from&&to&&from>to&&<p role="status" className="convoy-source-alert">The start date is after the end date. Choose an earlier start date.</p>}
    <div className="convoy-record-summary"><span role="status"><strong>{entries.length}</strong> {entries.length===1?'record':'records'} · {from||to?'Selected dates':'All dates'}{truckId?` · ${truckLabel(truckId)}`:' · All trucks'}</span>{filtered&&<Button variant="ghost" size="sm" onClick={reset}>Clear filters</Button>}<span><strong>{money(costs.total)}</strong> recorded for completed work{costs.missing>0?` · ${costs.missing} missing ${costs.missing===1?'total':'totals'}`:''}</span></div>
    <p className="convoy-record-note">Each invoice appears once. Invoice totals cover all work on the bill, even when filtering by category. Blank costs are unknown. Repair dates are the latest update.</p>
    <div className="convoy-record-list">{entries.map(row=>{const truck=trucks.find(t=>sameTruck(t.id,row.truck));return <article className="convoy-history-card" key={row.id}>
      <div className="convoy-history-date"><strong>{dateLabel(row.date)}</strong><span>{truckLabel(row.truck)}</span></div>
      <div className="convoy-history-work"><div className="convoy-history-tags"><span className={`convoy-badge ${row.status==='scheduled'?'warning':''}`}>{statusLabel(row.status)}</span>{row.kind==='invoice'&&<span><FileText size={13}/>Invoice</span>}</div><h3>{row.title}</h3><p className="convoy-work-preview">{row.description.replace(/^Invoice[^\n]*\n?/,'') || (row.issue?.resolution || 'Work details not recorded')}</p><small>{row.record?.vendor||row.issue?.owner||'Shop not recorded'}{row.record?.odometer!=null?` · ${row.record.odometer.toLocaleString()} mi`:''}</small><div className="convoy-category-tags">{row.categories.map(c=><span key={c}>{c}</span>)}{Boolean(row.record?.photos?.length)&&<span>{row.record!.photos!.length} invoice {row.record!.photos!.length===1?'photo':'photos'}</span>}</div></div>
      <div className="convoy-history-action"><strong>{money(row.cost)}</strong><small>{row.kind==='invoice'?'Invoice total':'Recorded cost'}</small><Button variant="outline" size="sm" disabled={!truck} onClick={()=>truck&&open(row.record?{kind:'maintenance',truck,record:row.record}:{kind:'issue',truck,issue:row.issue})}>View {row.kind==='invoice'?'invoice':'record'}<ArrowRight size={14}/></Button>{!truck&&<small>Truck unavailable in this view</small>}</div>
    </article>;})}</div>
    {!entries.length&&<div className="convoy-repair-empty"><FileText size={24}/><strong>{filtered?'No records match these filters':'No records saved yet'}</strong><p>{filtered?'Try an invoice number, a different truck, or a wider date range.':'Use Record service after work is completed, or Report a problem for a new repair.'}</p>{filtered&&<Button variant="outline" onClick={reset}>Show all dates and types</Button>}</div>}
  </section>;
}

export function ServiceRecordDetails({record,snapshot,truck,open}: {record: FleetMaintenanceRow;snapshot:DesktopFleetSnapshot;truck:DesktopFleetTruck;open:Props['open']}) {
  const entry=historyEntries(snapshot).find(r=>r.record?.recordId===record.recordId);
  const parent=snapshot.maintenance.find(r=>r.recordId===linkedInvoiceId(record)&&sameTruck(r.truck,record.truck));
  return <section className="convoy-record-detail">
    <div className="convoy-heading"><div><span className="convoy-badge">{statusLabel(record.status)}</span><h3>{recordTitle(record)}</h3></div><Button variant="outline" disabled={!snapshot.canWrite} onClick={()=>open({kind:'maintenance',truck,record,mode:'edit'})}>Edit record</Button></div>
    <dl className="convoy-detail-facts">{[['Truck',truckLabel(record.truck)],['Service date',dateLabel(record.serviceDate)],['Mileage at service',record.odometer===null?'Not recorded':`${record.odometer.toLocaleString()} mi`],['Shop / vendor',record.vendor||'Not recorded'],['Recorded cost',parent&&record.cost===null?'Included in linked invoice':money(record.cost)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <h4>Work performed / planned</h4><p className="convoy-full-text">{record.description||'No work description recorded.'}</p>
    {Boolean(entry?.children.length)&&<section><h4>Services on this invoice</h4><p>These entries track maintenance by category. The bill total is counted once.</p><div className="convoy-linked-services">{entry!.children.map(child=><button key={child.recordId} onClick={()=>open({kind:'maintenance',truck,record:child})}>{child.serviceType}<ArrowRight size={14}/></button>)}</div></section>}
    {parent&&<Button variant="outline" onClick={()=>open({kind:'maintenance',truck,record:parent})}>View linked {recordTitle(parent).toLowerCase()}</Button>}
    <section><h4>Invoice & service photos ({record.photos?.length||0})</h4>{record.photos?.length?<><p>Open a photo to read the original invoice at full size.</p><div className="convoy-invoice-photos">{record.photos.map((photo,index)=><a key={photo.photoId} href={`/api/fleet-maintenance-photos?photoId=${encodeURIComponent(photo.photoId)}`} target="_blank" rel="noreferrer"><img loading="lazy" src={`/api/fleet-maintenance-photos?photoId=${encodeURIComponent(photo.photoId)}`} alt={`Invoice photo ${index+1}: ${photo.fileName}`}/><span>Photo {index+1} · Open full size ↗</span></a>)}</div></>:<p>No photos attached to this record.</p>}</section>
    {record.notes&&<details className="convoy-extra-fields"><summary>Notes & source details</summary><p className="convoy-full-text">{record.notes}</p></details>}
  </section>;
}
