import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Search, X } from 'lucide-react';
import { Input } from './components/ui/input';
import { desktopSourceHref } from './lib/desktop-links';
import './live-search.css';
export function desktopHref(href: string): string { return desktopSourceHref(href, window.location.origin); }

type Result = { id: string; type: string; title: string; subtitle: string; source: string; href: string };
type Scope='all'|'upcoming'|'past';
type Coverage={dateCount:number;from:string|null;to:string|null};
export default function LiveSearch({ date, navigate, disabled, finance }: { date: string; navigate: (workspace: string) => void; disabled: boolean; finance: boolean }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [results, setResults] = useState<Result[]>([]); const [error, setError] = useState('');
  const [scope,setScope]=useState<Scope>('all');const [limit,setLimit]=useState(10);const [loading,setLoading]=useState(false);
  const [coverage,setCoverage]=useState<Coverage|null>(null);const [total,setTotal]=useState(0);const [hasMore,setHasMore]=useState(false);
  const input = useRef<HTMLInputElement>(null);
  const commands = ['Command', 'Schedule', 'Krewe', 'Fleet', 'Marketing', ...(finance ? ['Finance'] : [])].filter(name => name.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (disabled) return; if (event.key === 'Escape') {setOpen(false);input.current?.blur();} if (event.key === '/' && !/input|textarea|select/i.test((event.target as HTMLElement)?.tagName)) { event.preventDefault(); setOpen(true); input.current?.focus(); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [disabled]);
  useEffect(()=>{
    const abort=new AbortController();setResults([]);setError('');setCoverage(null);setHasMore(false);setTotal(0);
    if(query.trim().length<2||!open){setLoading(false);return;}
    setLoading(true);
    const timer=window.setTimeout(()=>{void fetch(`/api/global-search?q=${encodeURIComponent(query)}&date=${date}&scope=${scope}&limit=${limit}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])})
      .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Source search is unavailable.');if(!abort.signal.aborted){setResults(body.results||[]);setCoverage(body.coverage||null);setTotal(body.appointmentTotal||0);setHasMore(Boolean(body.hasMore));}})
      .catch(failure=>{if(!abort.signal.aborted)setError(failure instanceof Error?failure.message:'Source search is unavailable.');})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});},200);
    return()=>{abort.abort();window.clearTimeout(timer);};
  },[date,query,scope,limit,open]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const openResult = (href: string) => { if (!disabled) window.location.assign(desktopHref(href)); };
  const go = (workspace: string) => { if (disabled) return; navigate(workspace); setOpen(false); setQuery(''); };
  return <div className="global-search-shell">
    {open&&<button className="global-search-backdrop" aria-label="Close search" onClick={()=>setOpen(false)}/>}
    <div className={`global-search${open?' active':''}`}><Search size={17}/><Input ref={input} value={query} disabled={disabled} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setLimit(10);setOpen(true);}} placeholder="Search records or run a command" aria-label="Search records or run an OpsCenter command" aria-expanded={open} onKeyDown={event=>{if(event.key==='Enter'){if(commands[0])go(commands[0]);else if(!loading&&results[0])openResult(results[0].href);}}}/>{query?<button aria-label="Clear search" onClick={()=>{setQuery('');setLimit(10);}}><X size={14}/></button>:<kbd>/</kbd>}</div>
    {open&&<section className="global-search-panel cross-date-search" role="dialog" aria-label="OpsCenter launcher">
      <header><div><span>OpsCenter Launcher</span><strong>Commands and Source Records</strong></div></header>
      <div className="search-date-toolbar"><span>Appointments</span><div role="group" aria-label="Appointment Search Dates">{(['all','upcoming','past'] as Scope[]).map(value=><button key={value} aria-pressed={scope===value} disabled={disabled} onClick={()=>{setScope(value);setLimit(10);}}>{value==='all'?'All':value==='upcoming'?'Upcoming':'Past'}</button>)}</div><small>{scope==='upcoming'?'Today onward':scope==='past'?'Before today':'Past and upcoming'} · Krewe and Fleet use the selected operating day.</small></div>
      <div className="global-search-results-body">
        {commands.length>0&&<section className="launcher-command-group"><div className="launcher-command-grid">{commands.map(name=><button key={name} disabled={disabled} onClick={()=>go(name)}><strong>Open {name}</strong><ArrowRight size={14}/></button>)}</div></section>}
        {loading&&<p role="status">Searching Collected Records…</p>}
        {!loading&&<div className="global-search-groups">{[['job','Appointments'],['crew','Krewe'],['truck','Fleet']].map(([type,label])=>{const rows=results.filter(row=>row.type===type);if(!rows.length)return null;return <section className="global-search-group" key={type} aria-label={label}><header><strong>{label}</strong><small>{type==='job'?`${rows.length} of ${total}`:rows.length}</small></header><div>{rows.map(result=><button key={result.id} disabled={disabled} onClick={()=>openResult(result.href)}><div><strong>{result.title}</strong><span>{result.subtitle}</span><small>{result.source}</small></div><ArrowRight size={15}/></button>)}</div></section>;})}</div>}
        {!loading&&hasMore&&(limit<100?<button className="search-show-more" onClick={()=>setLimit(value=>Math.min(100,value+20))}>Show More Appointments</button>:<p>Showing 100 appointments. Refine the name, JK number, phone, or address to narrow the results.</p>)}
        {error&&<p role="alert">{error}</p>}
        {query.trim().length>=2&&!loading&&!results.length&&!error&&<p>No matching records in this search. Try All or a different name, JK number, phone, or address.</p>}
        {query.trim().length<2&&<p>Search by customer, JK number, phone, or service address—no date needed.</p>}
        {coverage&&<p className="search-coverage">{coverage.dateCount?`Collected appointment dates: ${coverage.from}–${coverage.to}.`:'No collected appointment dates in this range.'} Some dates may not be loaded. Results reflect saved source snapshots, not a new JunkWare search.</p>}
      </div><footer><span><kbd>Esc</kbd> Close</span></footer>
    </section>}
  </div>;
}
