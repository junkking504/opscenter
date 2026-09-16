import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, PhoneCall, Search } from 'lucide-react';
import { Button } from './components/ui/button';
import { commercialDate, commercialMoney, type Lead } from './lib/commercial-contract';
import { browseLeads, defaultLeadFilters, inLeadQueue, leadPhoneHref, leadStatusLabel, type LeadFilters } from './lib/lead-browser';
import './lead-browser.css';

export function LeadBrowser({ leads, onEdit }: { leads: Lead[]; onEdit: (id: string) => void }) {
  const [filters, setFilters] = useState<LeadFilters>(defaultLeadFilters);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const heading = useRef<HTMLHeadingElement>(null);
  const result = useMemo(() => browseLeads(leads, filters, page, pageSize), [leads, filters, page, pageSize]);
  const territories = useMemo(() => [...new Set(leads.map(lead => lead.territory).filter(Boolean))].sort(), [leads]);
  const update = (next: Partial<LeadFilters>) => { setFilters(current => ({ ...current, ...next })); setPage(1); };
  const reset = () => { setFilters(defaultLeadFilters); setPage(1); };
  const changePage = (next: number) => { setPage(next); heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'start' }); };
  const queues = [['recover', 'To recover'], ['lost', 'Lost'], ['followup', 'Follow-up'], ['booked', 'Booked / recovered'], ['all', 'All leads']] as const;
  const pagination = <nav className="lead-pagination" aria-label="Lead pages">
    <span>Page {result.page} of {result.pageCount}</span>
    <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => changePage(result.page - 1)} aria-label="Previous lead page"><ChevronLeft size={15} />Previous</Button>
    <Button variant="outline" size="sm" disabled={result.page >= result.pageCount} onClick={() => changePage(result.page + 1)} aria-label="Next lead page">Next<ChevronRight size={15} /></Button>
  </nav>;
  return <section className="lead-browser" aria-label="SearchKings leads">
    <header className="lead-browser-heading"><div><span className="section-kicker">SearchKings · Lead recovery</span><h2>Find your next follow-up</h2><p>Search a customer or service, narrow by territory, and work through one page at a time.</p></div></header>
    <div className="lead-queues" aria-label="Lead status filters">{queues.map(([key, name]) => <button type="button" key={key} aria-pressed={filters.queue === key} onClick={() => update({ queue: key })}><span>{name}</span><strong>{leads.filter(lead => inLeadQueue(lead, key)).length}</strong></button>)}</div>
    <div className="lead-browser-filters">
      <label className="lead-search"><span>Search leads</span><div><Search size={16} aria-hidden="true" /><input type="search" value={filters.query} placeholder="Name, phone, service or notes" onChange={event => update({ query: event.target.value })} /></div></label>
      <label><span>Territory</span><select value={filters.territory} onChange={event => update({ territory: event.target.value })}><option value="">All territories</option>{territories.map(territory => <option key={territory}>{territory}</option>)}</select></label>
      <label><span>Contact</span><select value={filters.contact} onChange={event => update({ contact: event.target.value as LeadFilters['contact'] })}><option value="">Any contact status</option><option value="uncontacted">No contact recorded</option><option value="contacted">Contact recorded</option></select></label>
      <label><span>Sort</span><select value={filters.order} onChange={event => update({ order: event.target.value as LeadFilters['order'] })}><option value="newest">Newest calls first</option><option value="oldest">Oldest calls first</option><option value="priority">Lost leads first</option><option value="value">Highest quoted value</option></select></label>
      <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button>
    </div>
    <div className="lead-results-heading"><h3 ref={heading} tabIndex={-1} aria-live="polite">{result.start}–{result.end} of {result.total} matching leads</h3><label>Per page<select value={pageSize} onChange={event => { setPageSize(Number(event.target.value)); setPage(1); }}>{[10, 25, 50].map(size => <option key={size}>{size}</option>)}</select></label>{pagination}</div>
    <div className="lead-browser-list">{result.rows.map(lead => {
      const phone = leadPhoneHref(lead.phone);
      return <article className={`lead-row lead-row-${lead.status}`} key={lead.id} aria-label={`${lead.customer}, ${leadStatusLabel(lead.status)}`}>
        <div className="lead-identity"><span className={`lead-status lead-status-${lead.status}`}>{leadStatusLabel(lead.status)}</span><h3>{lead.customer}</h3>{phone ? <a href={phone}>{lead.phone}</a> : <span>Phone unavailable</span>}<strong>{lead.territory}</strong><time dateTime={lead.calledAt}>Inbound · {commercialDate(lead.calledAt)}</time><small>{lead.source}</small></div>
        <div className="lead-need"><p>{lead.intent}</p>{lead.reason && <span className="lead-reason">{lead.reason.replaceAll('_', ' ')}</span>}<div className="lead-contact"><strong>{lead.contacted ? `Contact recorded · ${commercialDate(lead.updatedAt)}` : 'No franchise contact recorded'}</strong>{lead.note && <details><summary>Contact notes</summary><p>{lead.note}</p></details>}</div>{lead.appointmentId && <a className="lead-appointment" href={`/schedule?job=${encodeURIComponent(lead.jk || lead.appointmentId)}`} target="_blank" rel="noreferrer">{lead.completed ? 'Completed' : 'Matched'} appointment · {lead.jk || lead.appointmentId} ↗</a>}</div>
        <div className="lead-actions"><div className="lead-quote"><span>Quoted value</span><strong>{commercialMoney(lead.quotedValue)}</strong></div><div>{phone && <a className="lead-call" href={phone} aria-label={`Call ${lead.customer}`}><PhoneCall size={14} />Call</a>}<Button variant="outline" size="sm" onClick={() => onEdit(lead.id)} aria-label={`Update ${lead.customer}`}>Update</Button></div>{/^https?:\/\//i.test(lead.sourceUrl) && <a href={lead.sourceUrl} target="_blank" rel="noreferrer">Open source<ExternalLink size={13} /></a>}</div>
      </article>;
    })}</div>
    {!result.total && <div className="lead-browser-empty"><strong>No leads match these filters.</strong><p>Try another name, phone or territory, or reset to all recovery leads.</p><Button variant="outline" size="sm" onClick={reset}>Reset filters</Button></div>}
    <footer className="lead-browser-footer"><span>Counts cover the loaded month. Status combines booking matches and recorded outcomes.</span>{pagination}</footer>
  </section>;
}
