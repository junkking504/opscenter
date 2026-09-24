import { workspaceLabel } from './lib/workspace-labels';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Search, X } from 'lucide-react';
import { Input } from './components/ui/input';
import { desktopSourceHref } from './lib/desktop-links';
import type { KnowledgeAnswer } from './lib/knowledge-answer';
import './live-search.css';
export function desktopHref(href: string): string { return desktopSourceHref(href, window.location.origin); }

type Result = { id: string; type: string; title: string; subtitle: string; source: string; href: string };
type OpsBotSource = { label: string; detail: string; href?: string };
type OpsBotAnswer = { answer: string; sources: OpsBotSource[]; model: string; remaining: number; limit: number };
type OpsBotStatus = { available: boolean; reason: string | null; remaining: number; limit: number };
type Scope='all'|'upcoming'|'past';
type Coverage={dateCount:number;from:string|null;to:string|null};
export default function LiveSearch({ date, navigate, disabled, finance }: { date: string; navigate: (workspace: string) => void; disabled: boolean; finance: boolean }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [results, setResults] = useState<Result[]>([]); const [error, setError] = useState('');
  const [scope,setScope]=useState<Scope>('all');const [limit,setLimit]=useState(10);const [loading,setLoading]=useState(false);
  const [coverage,setCoverage]=useState<Coverage|null>(null);const [total,setTotal]=useState(0);const [hasMore,setHasMore]=useState(false);
  const [knowledgeAnswer,setKnowledgeAnswer]=useState<KnowledgeAnswer|null>(null);const [knowledgeLoading,setKnowledgeLoading]=useState(false);const [knowledgeError,setKnowledgeError]=useState('');
  const [opsBotStatus,setOpsBotStatus]=useState<OpsBotStatus|null>(null);const [opsBotAnswer,setOpsBotAnswer]=useState<OpsBotAnswer|null>(null);const [opsBotLoading,setOpsBotLoading]=useState(false);const [opsBotError,setOpsBotError]=useState('');
  const input = useRef<HTMLInputElement>(null);
  const commands = ['Command', 'Schedule', 'Krewe', 'Fleet', ...(finance ? ['Finance'] : []), 'Marketing'].filter(name => `${name} ${workspaceLabel(name)}`.toLowerCase().includes(query.toLowerCase()));
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
  useEffect(()=>{
    const abort=new AbortController();setKnowledgeAnswer(null);setKnowledgeError('');
    if(query.trim().length<2||!open){setKnowledgeLoading(false);return;}
    setKnowledgeLoading(true);
    const timer=window.setTimeout(()=>{void fetch(`/api/desktop/knowledge/answer?q=${encodeURIComponent(query)}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(4000)])})
      .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'OpsWiki answer is unavailable.');if(!abort.signal.aborted)setKnowledgeAnswer(body.answer||null);})
      .catch(()=>{if(!abort.signal.aborted)setKnowledgeError('OpsWiki answer is unavailable. Source-record search is still available.');})
      .finally(()=>{if(!abort.signal.aborted)setKnowledgeLoading(false);});},80);
    return()=>{abort.abort();window.clearTimeout(timer);};
  },[query,open]);
  useEffect(()=>{
    const abort=new AbortController();
    if(!open||!finance)return()=>abort.abort();
    void fetch('/api/desktop/ask-opsbot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)])})
      .then(async response=>{const body=await response.json();if(!response.ok)throw Error(body.error||'Ask OpsBot is unavailable.');if(!abort.signal.aborted)setOpsBotStatus(body);})
      .catch(()=>{if(!abort.signal.aborted)setOpsBotStatus({available:false,reason:'Ask OpsBot is unavailable.',remaining:0,limit:50});});
    return()=>abort.abort();
  },[open,finance]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const openResult = (href: string) => { if (!disabled) window.location.assign(desktopHref(href)); };
  const openKnowledge = (id: string) => { if (disabled) return; const url=new URL(window.location.href);url.searchParams.set('knowledge',id);window.location.assign(url); };
  const go = (workspace: string) => { if (disabled) return; navigate(workspace); setOpen(false); setQuery(''); };
  const askOpsBot=async()=>{
    if(disabled||opsBotLoading||!opsBotStatus?.available||query.trim().length<2)return;
    setOpsBotLoading(true);setOpsBotError('');setOpsBotAnswer(null);
    try{
      const response=await fetch('/api/desktop/ask-opsbot',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:query.trim(),date}),signal:AbortSignal.timeout(60000)});
      const body=await response.json();
      if(typeof body.remaining==='number')setOpsBotStatus({available:Boolean(body.available),reason:body.reason||null,remaining:body.remaining,limit:body.limit||50});
      if(!response.ok)throw Error(body.error||'Ask OpsBot could not complete this question.');
      setOpsBotAnswer(body);
    }catch(failure){setOpsBotError(failure instanceof Error?failure.message:'Ask OpsBot could not complete this question.');}
    finally{setOpsBotLoading(false);}
  };
  return <div className="global-search-shell">
    {open&&<button className="global-search-backdrop" aria-label="Close search" onClick={()=>setOpen(false)}/>}
    <div className={`global-search${open?' active':''}`}><Search size={17}/><Input ref={input} value={query} disabled={disabled} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setLimit(10);setOpsBotAnswer(null);setOpsBotError('');setOpen(true);}} placeholder="Ask OpsBot or search records" aria-label="Ask OpsBot or search records" aria-expanded={open} onKeyDown={event=>{if(event.key==='Enter'){if(knowledgeAnswer)openKnowledge(knowledgeAnswer.entryId);else if(commands[0])go(commands[0]);else if(!loading&&results[0])openResult(results[0].href);}}}/>{query?<button aria-label="Clear search" onClick={()=>{setQuery('');setLimit(10);setOpsBotAnswer(null);setOpsBotError('');}}><X size={14}/></button>:<kbd>/</kbd>}</div>
    {open&&<section className="global-search-panel cross-date-search" role="dialog" aria-label="OpsCenter launcher">
      <header><div><span>Ask OpsBot</span><strong>GPT-6 Luna with OpsCenter sources</strong></div></header>
      <div className="search-date-toolbar"><span>Appointments</span><div role="group" aria-label="Appointment Search Dates">{(['all','upcoming','past'] as Scope[]).map(value=><button key={value} aria-pressed={scope===value} disabled={disabled} onClick={()=>{setScope(value);setLimit(10);}}>{value==='all'?'All':value==='upcoming'?'Upcoming':'Past'}</button>)}</div><small>{scope==='upcoming'?'Today onward':scope==='past'?'Before today':'Past and upcoming'} · Crew and Convoy use the selected operating day.</small></div>
      <div className="global-search-results-body">
        {finance&&<section className="opsbot-prompt-card" aria-label="Ask OpsBot"><div><Bot size={18}/><span><strong>Ask OpsBot</strong><small>{opsBotStatus?`${opsBotStatus.remaining} of ${opsBotStatus.limit} pilot questions remaining`:'Checking availability…'}</small></span></div><button disabled={disabled||opsBotLoading||!opsBotStatus?.available||query.trim().length<2} onClick={()=>void askOpsBot()}>{opsBotLoading?'Thinking…':'Ask OpsBot'}</button>{opsBotStatus&&!opsBotStatus.available&&<p>{opsBotStatus.reason||'Ask OpsBot is unavailable.'}</p>}</section>}
        {opsBotAnswer&&<section className="opsbot-answer-card" aria-label="Ask OpsBot answer"><header><strong>Ask OpsBot answer</strong><span>{opsBotAnswer.model}</span></header><p>{opsBotAnswer.answer}</p>{opsBotAnswer.sources.length>0&&<footer><small>Sources</small><div>{opsBotAnswer.sources.map((source,index)=>source.href?<button key={`${source.label}-${index}`} onClick={()=>openResult(source.href!)}><strong>{source.label}</strong><span>{source.detail}</span><ArrowRight size={12}/></button>:<span key={`${source.label}-${index}`}><strong>{source.label}</strong> · {source.detail}</span>)}</div></footer>}</section>}
        {opsBotError&&<p className="opsbot-answer-error" role="alert">{opsBotError}</p>}
        {knowledgeLoading&&<p className="knowledge-answer-loading" role="status">Checking OpsWiki…</p>}
        {knowledgeAnswer&&<section className={`knowledge-answer-card knowledge-answer-${knowledgeAnswer.confidence}`} aria-label="OpsWiki answer"><header><strong>OpsWiki answer</strong><span>{knowledgeAnswer.status}</span></header><h3>{knowledgeAnswer.title}</h3><p>{knowledgeAnswer.answer}</p>{knowledgeAnswer.detail&&<p className="knowledge-answer-detail">{knowledgeAnswer.detail}</p>}<footer><small>{knowledgeAnswer.sourceLabel} · {knowledgeAnswer.workspace}</small><button disabled={disabled} onClick={()=>openKnowledge(knowledgeAnswer.entryId)}>Open supporting record <ArrowRight size={13}/></button></footer></section>}
        {knowledgeError&&<p className="knowledge-answer-error" role="status">{knowledgeError}</p>}
        {commands.length>0&&<section className="launcher-command-group"><div className="launcher-command-grid">{commands.map(name=><button key={name} disabled={disabled} onClick={()=>go(name)}><strong>Open {workspaceLabel(name)}</strong><ArrowRight size={14}/></button>)}</div></section>}
        {loading&&<p role="status">Searching Collected Records…</p>}
        {!loading&&<div className="global-search-groups">{[['job','Appointments'],['crew','Crew'],['truck','Convoy']].map(([type,label])=>{const rows=results.filter(row=>row.type===type);if(!rows.length)return null;return <section className="global-search-group" key={type} aria-label={label}><header><strong>{label}</strong><small>{type==='job'?`${rows.length} of ${total}`:rows.length}</small></header><div>{rows.map(result=><button key={result.id} disabled={disabled} onClick={()=>openResult(result.href)}><div><strong>{result.title}</strong><span>{result.subtitle}</span><small>{result.source}</small></div><ArrowRight size={15}/></button>)}</div></section>;})}</div>}
        {!loading&&hasMore&&(limit<100?<button className="search-show-more" onClick={()=>setLimit(value=>Math.min(100,value+20))}>Show More Appointments</button>:<p>Showing 100 appointments. Refine the name, JK number, phone, or address to narrow the results.</p>)}
        {error&&<p role="alert">{error}</p>}
        {query.trim().length>=2&&!loading&&!results.length&&!error&&<p>{knowledgeAnswer?'No matching live source records. The answer above comes from saved knowledge.':'No matching records in this search. Try All or a different name, JK number, phone, or address.'}</p>}
        {query.trim().length<2&&<p>Ask OpsBot about operations, an OpsCenter procedure, decision, or prior fix—or search by customer, JK number, phone, or service address.</p>}
        {coverage&&<p className="search-coverage">{coverage.dateCount?`Collected appointment dates: ${coverage.from}–${coverage.to}.`:'No collected appointment dates in this range.'} Some dates may not be loaded. Results reflect saved source snapshots, not a new JunkWare search.</p>}
      </div><footer><span><kbd>Esc</kbd> Close</span></footer>
    </section>}
  </div>;
}
