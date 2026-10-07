import { useId, useState } from 'react';
import { Search, FileText, ArrowRight, Download, SlidersHorizontal, ChevronDown, ChevronRight, Image as ImageIcon, Wrench, Truck, X, ExternalLink } from 'lucide-react';
import { Button } from './components/ui/button';
import { sameTruck } from './lib/convoy-presentation';
import { filterHistory, historyEntries, historyCosts, recordTitle, linkedInvoiceId, workSections, visitTitle, type HistoryEntry } from './lib/convoy-records';
import type { DesktopFleetSnapshot, DesktopFleetTruck, FleetMaintenanceRow } from './lib/people-fleet-contract';
import type { FleetRecord } from './convoy-views';
const money = (n: number | null) => n === null ? 'Not recorded' : n.toLocaleString('en-US',{style:'currency',currency:'USD'});
const dateLabel = (date: string) => date ? new Date(`${date.slice(0,10)}T12:00:00`).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : 'Date not recorded';
const monthLabel = (date: string) => date ? new Date(`${date.slice(0,7)}-01T12:00:00`).toLocaleDateString('en-US',{month:'long',year:'numeric'}) : 'Date not recorded';
const truckLabel = (name: string) => name.replace(/Truck\s*#\s*/,'Truck ');
const statusLabel = (status: string) => ({completed:'Completed',scheduled:'Scheduled',open:'Open repair',in_progress:'Repair in progress',resolved:'Resolved repair'}[status] || status);
type Props = { snapshot: DesktopFleetSnapshot; trucks: DesktopFleetTruck[]; truckId?: string; onTruck?: (id:string)=>void; open: (record: FleetRecord) => void; compact?: boolean };

function WorkDetails({description}: {description:string}) {
  const sections=workSections(description);
  return sections.length?<dl className="convoy-work-sections">{sections.map((section,index)=><div key={index}><dt>{section.label}</dt><dd>{section.text}</dd></div>)}</dl>:<p>No work description recorded.</p>;
}

export function ConvoyRecords({snapshot,trucks,truckId='',onTruck,open,compact=false}: Props) {
  const [query,setQuery] = useState(''), [kind,setKind] = useState(''), [category,setCategory] = useState(''), [from,setFrom] = useState(''), [to,setTo] = useState('');
  const [filtersOpen,setFiltersOpen]=useState(false),[expanded,setExpanded]=useState('');
  const controlId=useId();
  const all = historyEntries(snapshot);
  const entries = filterHistory(all,{truck:truckId,query,kind,category,from,to});
  const truckMatches = filterHistory(all,{query,kind,category,from,to});
  const workMatches = filterHistory(all,{truck:truckId,query,kind,from,to});
  const categories=[...new Set(all.flatMap(r=>r.categories))].sort();
  const costs = historyCosts(entries);
  const filtered = Boolean(query||kind||category||from||to);
  const reset = () => {setQuery('');setKind('');setCategory('');setFrom('');setTo('');};
  const openRecord=(row:HistoryEntry,recordSection:'work'|'photos'='work')=>{
    const truck=trucks.find(t=>sameTruck(t.id,row.truck));
    if(truck)open(row.record?{kind:'maintenance',truck,record:row.record,recordSection}:{kind:'issue',truck,issue:row.issue});
  };
  function exportRecords() {
    const cells = [['Truck','Date (service / repair update)','Record','Status','Work','Shop','Recorded cost','Invoice photos'],...entries.map(r=>[truckLabel(r.truck),r.date,r.title,statusLabel(r.status),r.description,r.record?.vendor||r.issue?.owner||'',r.cost===null?'':String(r.cost),String(r.record?.photos?.length||0)])];
    const csv = cells.map(row=>row.map(value=>'"'+(/^[=+\-@\t\r]/.test(value)?"'"+value:value).replaceAll('"','""')+'"').join(',')).join('\r\n');
    const url=URL.createObjectURL(new Blob(['\uFEFF'+csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='convoy-records.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  return <section className={`convoy-record-browser ${compact?'compact':''}`} aria-label="Repair and maintenance records">
    {!compact&&onTruck&&<aside className="convoy-record-navigation">
      <h2>Trucks</h2><nav aria-label="Filter records by truck" className="convoy-record-trucks">
        {[{id:'',label:'All trucks'},...trucks].map(truck=><button key={truck.id} aria-pressed={truckId===truck.id} onClick={()=>{onTruck(truck.id);setExpanded('');}}><span>{truckLabel(truck.label)}</span><span>{truckMatches.filter(r=>!truck.id||sameTruck(r.truck,truck.id)).length}</span></button>)}
      </nav>
      <div className="convoy-record-categories"><h2>Work category</h2><nav aria-label="Filter records by work category"><button aria-pressed={!category} onClick={()=>setCategory('')}><span>All work</span><span>{workMatches.length}</span></button>{categories.map(c=><button key={c} aria-pressed={category===c} onClick={()=>setCategory(c)}><span>{c}</span><span>{workMatches.filter(r=>r.categories.includes(c)).length}</span></button>)}</nav></div>
      <p className="convoy-library-hint">Select a visit to see the work and invoice photos.</p>
    </aside>}
    <div className="convoy-journal">
      <header className="convoy-journal-header"><div><h2>{compact?'Service & repair history':truckId?`${truckLabel(truckId)} history`:'All truck history'}</h2><span role="status">{entries.length} {entries.length===1?'record':'records'} · {from||to?'Selected dates':'All dates'}</span></div><Button variant="ghost" size="sm" onClick={exportRecords} disabled={!entries.length}><Download size={16}/>Export</Button></header>
      <div className="convoy-journal-tools"><label className="convoy-journal-search"><Search size={18}/><input aria-label="Search records" value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search work, shop, VIN or invoice number"/>{query&&<button aria-label="Clear search" onClick={()=>setQuery('')}><X size={16}/></button>}</label><Button variant="outline" aria-expanded={filtersOpen} aria-controls={`${controlId}-filters`} onClick={()=>setFiltersOpen(!filtersOpen)}><SlidersHorizontal size={16}/>Filters{Boolean(kind||category||from||to)&&<span className="convoy-filter-count">{[kind,category,from,to].filter(Boolean).length}</span>}</Button></div>
      {filtersOpen&&<div className="convoy-journal-filters" id={`${controlId}-filters`}>
        <label>Record type<select value={kind} onChange={e=>setKind(e.target.value)}><option value="">All records</option><option value="invoice">Invoices</option><option value="completed">Completed service</option><option value="repair">Repairs</option><option value="scheduled">Scheduled service</option></select></label>
        <label>Work category<select value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{categories.map(c=><option key={c}>{c}</option>)}</select></label>
        <label>From<input type="date" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>Through<input type="date" value={to} onChange={e=>setTo(e.target.value)}/></label>
      </div>}
      {from&&to&&from>to&&<p role="status" className="convoy-source-alert">The start date is after the end date. Choose an earlier start date.</p>}
      {filtered&&<div className="convoy-applied-filters"><span>{[query?`Search: ${query}`:'',kind?`Type: ${{invoice:'Invoices',completed:'Completed service',repair:'Repairs',scheduled:'Scheduled service'}[kind]}`:'',category,from?`From ${dateLabel(from)}`:'',to?`Through ${dateLabel(to)}`:''].filter(Boolean).join(' · ')}</span><button onClick={reset}>Clear filters<X size={14}/></button></div>}
      <div className="convoy-journal-list">{entries.map((row,index)=>{
        const isOpen=expanded===row.id,photos=row.record?.photos||[],available=trucks.some(t=>sameTruck(t.id,row.truck));
        return <div key={row.id}>
          {(index===0||entries[index-1].date.slice(0,7)!==row.date.slice(0,7))&&<h3 className="convoy-journal-month">{monthLabel(row.date)}</h3>}
          <article className={`convoy-visit ${isOpen?'is-open':''}`}>
            <button className="convoy-visit-toggle" aria-expanded={isOpen} aria-controls={`${controlId}-${index}-work`} aria-label={`${isOpen?'Collapse':'Expand'} ${row.title}, ${truckLabel(row.truck)}, ${dateLabel(row.date)}`} onClick={()=>setExpanded(isOpen?'':row.id)}>
              <span className="convoy-visit-date"><time dateTime={row.date}>{dateLabel(row.date)}</time><span>{row.kind==='repair'?'Updated':truckLabel(row.truck)}</span></span>
              <span className="convoy-visit-icon">{row.kind==='invoice'?<FileText size={21}/>:row.kind==='repair'?<Wrench size={21}/>:<Truck size={21}/>}</span>
              <span className="convoy-visit-label"><strong>{visitTitle(row)}</strong><span>{[row.kind==='invoice'?row.title:statusLabel(row.status),row.kind==='repair'?truckLabel(row.truck):row.record?.vendor||'Shop not recorded'].join(' · ')}</span><span className="convoy-visit-metadata">{row.record?.odometer!=null?`${row.record.odometer.toLocaleString()} mi`:'Mileage not recorded'}{photos.length?` · ${photos.length} ${photos.length===1?'photo':'photos'}`:''}{row.kind==='invoice'&&row.status!=='completed'?` · ${statusLabel(row.status)}`:''}</span></span>
              <span className="convoy-visit-cost"><strong>{money(row.cost)}</strong><span>{row.kind==='invoice'?'Invoice total':'Recorded cost'}</span></span>
              {isOpen?<ChevronDown size={18}/>:<ChevronRight size={18}/>}
            </button>
            {isOpen&&<div className="convoy-visit-expanded" id={`${controlId}-${index}-work`}>
              <div className="convoy-visit-expanded-heading"><h4>{row.status==='scheduled'?'Planned work':row.kind==='repair'?'Problem & resolution':'Work performed'}</h4><span className={`convoy-badge ${row.status==='scheduled'?'warning':''}`}>{statusLabel(row.status)}</span></div>
              <WorkDetails description={row.description}/>{row.issue?.resolution&&<div className="convoy-resolution"><strong>Resolution</strong><p>{row.issue.resolution}</p></div>}
              <div className="convoy-visit-links"><Button variant="outline" disabled={!available} onClick={()=>openRecord(row)}><FileText size={16}/>Open record<ArrowRight size={14}/></Button>{photos.length>0&&<Button variant="ghost" disabled={!available} onClick={()=>openRecord(row,'photos')}><ImageIcon size={17}/>Invoice photos ({photos.length})</Button>}{!available&&<span>Truck unavailable in this view</span>}</div>
            </div>}
          </article>
        </div>;
      })}</div>
      {!entries.length&&<div className="convoy-repair-empty"><FileText size={24}/><strong>{filtered?'No matching records':'No records saved for this truck'}</strong><p>{filtered?'Try a different truck, clear the filters, or widen the date range.':'Completed work will appear here after you record a service visit.'}</p>{filtered&&<Button variant="outline" onClick={reset}>Clear filters</Button>}</div>}
      <footer className="convoy-journal-footer"><span><strong>{money(costs.total)}</strong> recorded for completed work{costs.missing?` · ${costs.missing} missing ${costs.missing===1?'total':'totals'}`:''}</span><details><summary>About these records</summary><p>Each invoice appears once. Totals cover all work on the bill, even when filtering by category. Missing costs are unknown. Repair dates show the latest update. History includes all dates unless you set a date filter.</p></details></footer>
    </div>
  </section>;
}

export function ServiceRecordDetails({record,snapshot,truck,open,initialSection='work'}: {record: FleetMaintenanceRow;snapshot:DesktopFleetSnapshot;truck:DesktopFleetTruck;open:Props['open'];initialSection?:'work'|'photos'}) {
  const [section,setSection]=useState<'work'|'photos'>(initialSection);
  const entry=historyEntries(snapshot).find(r=>r.record?.recordId===record.recordId);
  const parent=snapshot.maintenance.find(r=>r.recordId===linkedInvoiceId(record)&&sameTruck(r.truck,record.truck));
  return <section className="convoy-record-detail">
    <div className="convoy-heading"><div><span className="convoy-badge">{statusLabel(record.status)}</span><h3>{recordTitle(record)}</h3></div><Button variant="outline" disabled={!snapshot.canWrite} onClick={()=>open({kind:'maintenance',truck,record,mode:'edit'})}>Edit record</Button></div>
    <dl className="convoy-detail-facts">{[['Truck',truckLabel(record.truck)],['Service date',dateLabel(record.serviceDate)],['Mileage at service',record.odometer===null?'Not recorded':`${record.odometer.toLocaleString()} mi`],['Shop / vendor',record.vendor||'Not recorded'],['Recorded cost',parent&&record.cost===null?'Included in linked invoice':money(record.cost)]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    <nav className="convoy-detail-switch" aria-label="Record sections"><button aria-pressed={section==='work'} onClick={()=>setSection('work')}><Wrench size={16}/>Work details</button><button aria-pressed={section==='photos'} onClick={()=>setSection('photos')}><ImageIcon size={16}/>Invoice photos ({record.photos?.length||0})</button></nav>
    {section==='work'?<><WorkDetails description={record.description}/>
      {Boolean(entry?.children.length)&&<section><h4>Services on this invoice</h4><p>Open a category to see its maintenance entry. The bill total is counted once.</p><div className="convoy-linked-services">{entry!.children.map(child=><button key={child.recordId} onClick={()=>open({kind:'maintenance',truck,record:child})}>{child.serviceType}<ArrowRight size={14}/></button>)}</div></section>}
      {parent&&<Button variant="outline" onClick={()=>open({kind:'maintenance',truck,record:parent})}>View linked {recordTitle(parent).toLowerCase()}</Button>}
      {record.notes&&<details className="convoy-extra-fields"><summary>Notes & source details</summary><p className="convoy-full-text">{record.notes}</p></details>}
    </>:<section aria-label="Invoice photos"><h4>Original invoice & service photos</h4>{record.photos?.length?<><p>Choose a page to read the original at full size.</p><div className="convoy-invoice-photos">{record.photos.map((photo,index)=><a key={photo.photoId} href={`/api/fleet-maintenance-photos?photoId=${encodeURIComponent(photo.photoId)}`} target="_blank" rel="noreferrer"><img loading="lazy" src={`/api/fleet-maintenance-photos?photoId=${encodeURIComponent(photo.photoId)}`} alt={`Invoice photo ${index+1}: ${photo.fileName}`}/><span>Photo {index+1}<ExternalLink size={13}/></span></a>)}</div></>:<p>No photos attached to this record.</p>}</section>}
  </section>;
}
