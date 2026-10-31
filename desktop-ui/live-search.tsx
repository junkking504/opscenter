import { useHeaderPanel } from './header-panel';
import {exactSearchDestination,isSearchQuestion} from './lib/search-destination';
import { readSearchJson, SearchRequestError, searchFailureMessage } from './lib/search-response';
import { historyQuery, mergeHistoryResults } from '../lib/junkware-history-contract';
import { searchSubmission } from './lib/search-intent';
import { workspaceLabel } from './lib/workspace-labels';
import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Bot, Search, X } from 'lucide-react';
import { Input } from './components/ui/input';
import { desktopSourceHref } from './lib/desktop-links';
import type { KnowledgeAnswer } from './lib/knowledge-answer';
import OpsBotMarkdown from './components/opsbot-markdown';
import './live-search.css';
import './pinned-search.css';
import { usePinnedSearch } from './use-pinned-search';
export function desktopHref(href: string): string { return desktopSourceHref(href, window.location.origin); }

type Result = { id: string; type: string; title: string; subtitle: string; source: string; href: string };
type OpsBotSource = { label: string; detail: string; href?: string };
type OpsBotAnswer = { answer: string; sources: OpsBotSource[]; model: string; remaining: number; limit: number };
type OpsBotStatus = { available: boolean; reason: string | null; remaining: number; limit: number };
type Scope='all'|'upcoming'|'past';
type Coverage={dateCount:number;from:string|null;to:string|null};
type SearchResults = { results?: Result[]; coverage?: Coverage; appointmentTotal?: number; hasMore?: boolean; customerError?:string;customerTotal?:number };
const searchUnavailable = 'Saved-record search is temporarily unavailable. Try again later.';
const localUnavailable = 'OpsBot’s saved-source lookup is temporarily unavailable. You can still search saved records below.';
const assistantUnavailable = 'Ask OpsBot did not return an answer. You can still search saved records below. A submitted pilot question may still count.';
export default function LiveSearch({ date, navigate, disabled, finance, openRequest = 0 }: { date: string; navigate: (workspace: string) => void; disabled: boolean; finance: boolean; openRequest?: number }) {
  const [query, setQuery] = useState(''); const [open, setOpen] = useState(false); const [savedResults, setResults] = useState<Result[]>([]); const [error, setError] = useState('');
  const [scope,setScope]=useState<Scope>('all');const [limit,setLimit]=useState(10);const [loading,setLoading]=useState(false);
  const [coverage,setCoverage]=useState<Coverage|null>(null);const [total,setTotal]=useState(0);const [hasMore,setHasMore]=useState(false);
  const [knowledgeAnswer,setKnowledgeAnswer]=useState<KnowledgeAnswer|null>(null);const [knowledgeLoading,setKnowledgeLoading]=useState(false);const [knowledgeError,setKnowledgeError]=useState('');
  const [opsBotStatus,setOpsBotStatus]=useState<OpsBotStatus|null>(null);const [opsBotAnswer,setOpsBotAnswer]=useState<OpsBotAnswer|null>(null);const [opsBotLoading,setOpsBotLoading]=useState(false);const [opsBotError,setOpsBotError]=useState('');
  const [history,setHistory]=useState<{key:string;results:Result[];loading:boolean;error:string;hasMore:boolean;checkedAt:string|null}>({key:'',results:[],loading:false,error:'',hasMore:false,checkedAt:null});
  const [pendingEnter,setPendingEnter]=useState('');const [searchNotice,setSearchNotice]=useState('');const [savedKey,setSavedKey]=useState('');const [customerError,setCustomerError]=useState('');const [customerTotal,setCustomerTotal]=useState(0);
  const requestKey=JSON.stringify([query,scope,limit,date]);
  const [historyRetry,setHistoryRetry]=useState(0);
  const historyEligible=Boolean(historyQuery(query));
  const historyKey=JSON.stringify([query,scope]);
  const currentHistory=history.key===historyKey?history:null;
  const historyLoading=historyEligible&&open&&(currentHistory?.loading??true);
  const combined=mergeHistoryResults(savedResults,currentHistory?.results||[]);
  const appointmentRows=combined.filter(row=>row.type==='job');
  const results=combined.filter(row=>row.type!=='job'||appointmentRows.indexOf(row)<limit);
  const more=hasMore||appointmentRows.length>limit;
  const input = useRef<HTMLInputElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  usePinnedSearch(shell);
  useHeaderPanel('search', open, () => setOpen(false), shell);
  const commands = ['Command', 'Schedule', 'Krewe', 'Fleet', ...(finance ? ['Finance'] : []), 'Marketing'].filter(name => `${name} ${workspaceLabel(name)}`.toLowerCase().includes(query.toLowerCase()));
  useEffect(() => { const listener = (event: KeyboardEvent) => { if (disabled) return; if (event.key === 'Escape') {setOpen(false);input.current?.blur();} if (event.key === '/' && !/input|textarea|select/i.test((event.target as HTMLElement)?.tagName)) { event.preventDefault(); setOpen(true); input.current?.focus(); } }; window.addEventListener('keydown', listener); return () => window.removeEventListener('keydown', listener); }, [disabled]);
  useEffect(()=>{
    const abort=new AbortController();setResults([]);setError('');setCoverage(null);setHasMore(false);setTotal(0);setCustomerError('');setCustomerTotal(0);
    if(query.trim().length<2||!open){setLoading(false);return;}
    setLoading(true);
    const timer=window.setTimeout(()=>{void fetch(`/api/global-search?q=${encodeURIComponent(query)}&date=${date}&scope=${scope}&limit=${limit}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(20000)])})
      .then(async response=>{const body=await readSearchJson<SearchResults>(response,searchUnavailable);if(!response.ok)throw new SearchRequestError(body.error||searchUnavailable);if(!abort.signal.aborted){setResults(body.results||[]);setCoverage(body.coverage||null);setTotal(body.appointmentTotal||0);setHasMore(Boolean(body.hasMore));setCustomerError(body.customerError||'');setCustomerTotal(body.customerTotal||0);setSavedKey(requestKey);}})
      .catch(failure=>{if(!abort.signal.aborted){setError(searchFailureMessage(failure,searchUnavailable));setSavedKey(requestKey);}})
      .finally(()=>{if(!abort.signal.aborted)setLoading(false);});},200);
    return()=>{abort.abort();window.clearTimeout(timer);};
  },[date,query,scope,limit,open,requestKey]);
  useEffect(()=>{
    if(!historyEligible||!open)return;
    const abort=new AbortController();
    setHistory({key:historyKey,results:[],loading:true,error:'',hasMore:false,checkedAt:null});
    const unavailable='JunkWare history could not be checked. Older appointments may be missing. Try again.';
    const timer=window.setTimeout(()=>{void fetch(`/api/global-search?source=junkware&q=${encodeURIComponent(query)}&scope=${scope}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(75000)])})
      .then(async response=>{const body=await readSearchJson<{results:Result[];hasMore:boolean;checkedAt:string}>(response,unavailable);if(!response.ok)throw new SearchRequestError(body.error||unavailable);if(!Array.isArray(body.results)||!body.checkedAt)throw new SearchRequestError(unavailable);if(!abort.signal.aborted)setHistory({key:historyKey,results:body.results,loading:false,error:'',hasMore:body.hasMore,checkedAt:body.checkedAt});})
      .catch(failure=>{if(!abort.signal.aborted)setHistory({key:historyKey,results:[],loading:false,error:searchFailureMessage(failure,unavailable),hasMore:false,checkedAt:null});});},900);
    return()=>{abort.abort();window.clearTimeout(timer);};
  },[query,scope,historyKey,historyEligible,open,historyRetry]);
  useEffect(()=>{
    const abort=new AbortController();setKnowledgeAnswer(null);setKnowledgeError('');
    if(query.trim().length<2||!open){setKnowledgeLoading(false);return;}
    setKnowledgeLoading(true);
    const timer=window.setTimeout(()=>{void fetch(`/api/desktop/knowledge/answer?q=${encodeURIComponent(query)}`,{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(4000)])})
      .then(async response=>{const body=await readSearchJson<{answer?:KnowledgeAnswer}>(response,'OpsWiki answer is unavailable.');if(!response.ok)throw new SearchRequestError(body.error||'OpsWiki answer is unavailable.');if(!abort.signal.aborted)setKnowledgeAnswer(body.answer||null);})
      .catch(()=>{if(!abort.signal.aborted)setKnowledgeError('OpsWiki answer is unavailable. Source-record search is still available.');})
      .finally(()=>{if(!abort.signal.aborted)setKnowledgeLoading(false);});},80);
    return()=>{abort.abort();window.clearTimeout(timer);};
  },[query,open]);
  useEffect(()=>{
    const abort=new AbortController();
    if(!open||!finance)return()=>abort.abort();
    void fetch('/api/desktop/ask-opsbot',{cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(5000)])})
      .then(async response=>{const body=await readSearchJson<OpsBotStatus>(response,'Ask OpsBot is unavailable.');if(!response.ok)throw new SearchRequestError(body.error||'Ask OpsBot is unavailable.');if(!abort.signal.aborted)setOpsBotStatus(body);})
      .catch(()=>{if(!abort.signal.aborted)setOpsBotStatus({available:false,reason:'Ask OpsBot is unavailable.',remaining:0,limit:50});});
    return()=>abort.abort();
  },[open,finance]);
  useEffect(() => { if (disabled) setOpen(false); if(disabled||!open)setPendingEnter(''); }, [disabled,open]);
  useEffect(() => {
    if (openRequest > 0 && !disabled) {
      setOpen(true);
      input.current?.focus();
    }
  }, [openRequest, disabled]);
  const submission = searchSubmission(query, finance, commands.flatMap(name => [name, workspaceLabel(name)]), results);
  const openResult = (href: string) => { if (!disabled) window.location.assign(desktopHref(href)); };
  const openKnowledge = (id: string) => { if (disabled) return; const url=new URL(window.location.href);url.searchParams.set('knowledge',id);window.location.assign(url); };
  const go = (workspace: string) => { if (disabled) return; navigate(workspace); setOpen(false); setQuery(''); };
  const askOpsBot=async()=>{
    if(disabled||opsBotLoading||query.trim().length<2)return;
    setOpsBotLoading(true);setOpsBotError('');setOpsBotAnswer(null);
    let unavailable=localUnavailable;
    try{
      const localResponse=await fetch('/api/desktop/ask-opsbot/local',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:query.trim(),date}),signal:AbortSignal.timeout(20000)});
      const localBody=await readSearchJson<OpsBotAnswer & {matched:boolean}>(localResponse,localUnavailable);
      if(!localResponse.ok)throw new SearchRequestError(localBody.error||localUnavailable);
      if(localBody.matched){setOpsBotAnswer(localBody);return;}
      if(!opsBotStatus?.available)throw new SearchRequestError(opsBotStatus?.reason||'Ask OpsBot is unavailable.');
      unavailable=assistantUnavailable;
      const response=await fetch('/api/desktop/ask-opsbot',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:query.trim(),date}),signal:AbortSignal.timeout(60000)});
      const body=await readSearchJson<OpsBotAnswer & OpsBotStatus>(response,assistantUnavailable);
      if(typeof body.remaining==='number')setOpsBotStatus({available:Boolean(body.available),reason:body.reason||null,remaining:body.remaining,limit:body.limit||50});
      if(!response.ok)throw new SearchRequestError(body.error||assistantUnavailable);
      setOpsBotAnswer(body);
    }catch(failure){setOpsBotError(searchFailureMessage(failure,unavailable));}
    finally{setOpsBotLoading(false);}
  };
  useEffect(()=>{
    if(!pendingEnter||pendingEnter!==requestKey||!open||disabled||loading||savedKey!==requestKey||historyLoading)return;
    setPendingEnter('');
    if(error||currentHistory?.error){setSearchNotice('Search is incomplete. Choose a verified result below or retry.');return;}
    const target=exactSearchDestination(query,combined);
    if(target && !(target.type==='customer'&&customerTotal>5)) {openResult(target.href);return;}
    const command=commands.find(name=>[name,workspaceLabel(name)].some(label=>label.toLowerCase()===query.trim().toLowerCase()));
    if(command){go(command);return;}
    if(!results.length&&submission==='assistant'&&isSearchQuestion(query)){void askOpsBot();return;}
    setSearchNotice(results.length?'Choose the matching record below.':'No exact record found. Check the identifier or choose another search.');
    // Process one Enter request against the completed current query, never a stale response.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[pendingEnter,requestKey,open,disabled,loading,savedKey,historyLoading,error,currentHistory,combined,customerTotal]);
  return <div ref={shell} className="global-search-shell">
    {open&&<button className="global-search-backdrop" aria-label="Close search" onClick={()=>setOpen(false)}/>}
    <div className={`global-search${open?' active':''}`}><Search size={17}/><Input ref={input} value={query} disabled={disabled} onFocus={()=>setOpen(true)} onChange={event=>{setQuery(event.target.value);setPendingEnter('');setSearchNotice('');setLimit(10);setOpsBotAnswer(null);setOpsBotError('');setOpen(true);}} placeholder="Ask OpsBot or search records" aria-label="Ask OpsBot or search records" aria-expanded={open} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();if(query.trim().length>=2){setPendingEnter(requestKey);setSearchNotice('Finding the matching record…');if(currentHistory?.error)setHistoryRetry(value=>value+1);}}}}/>{query?<button aria-label="Clear search" onClick={()=>{setQuery('');setPendingEnter('');setSearchNotice('');setLimit(10);setOpsBotAnswer(null);setOpsBotError('');}}><X size={14}/></button>:<kbd>/</kbd>}</div>
    {open&&<section className="global-search-panel cross-date-search" role="dialog" aria-label="OpsCenter launcher">
      <header><div><span>Ask OpsBot</span><strong>GPT-6 Luna with OpsCenter sources</strong></div></header>
      <div className="search-date-toolbar"><span>Appointments</span><div role="group" aria-label="Appointment Search Dates">{(['all','upcoming','past'] as Scope[]).map(value=><button key={value} aria-pressed={scope===value} disabled={disabled} onClick={()=>{setScope(value);setLimit(10);}}>{value==='all'?'All':value==='upcoming'?'Upcoming':'Past'}</button>)}</div><small>{scope==='upcoming'?'Today onward':scope==='past'?'Before today':'Past and upcoming'} · Krewe and Fleet use the selected operating day.</small></div>
      <div className="global-search-results-body">
        {searchNotice&&<p role="status">{searchNotice}</p>}{customerError&&<p role="alert">{customerError}</p>}
        {finance&&<section className="opsbot-prompt-card" aria-label="Ask OpsBot"><div><Bot size={18}/><span><strong>Ask OpsBot</strong><small>{historyEligible?'Searching appointment history; select a record below to open it.':'Enter opens an exact record. Choose Ask OpsBot for a question.'}</small><small>{opsBotStatus?`${opsBotStatus.remaining} of ${opsBotStatus.limit} pilot questions remaining`:'Checking availability…'}</small></span></div><button disabled={disabled||opsBotLoading||query.trim().length<2} onClick={()=>void askOpsBot()}>{opsBotLoading?'Thinking…':'Ask OpsBot'}</button>{opsBotStatus&&!opsBotStatus.available&&<p>{opsBotStatus.reason||'Ask OpsBot is unavailable.'}</p>}</section>}
        {opsBotAnswer&&<section className="opsbot-answer-card" aria-label="Ask OpsBot answer"><header><strong>Ask OpsBot answer</strong><span>{opsBotAnswer.model}</span></header><OpsBotMarkdown text={opsBotAnswer.answer}/>{opsBotAnswer.sources.length>0&&<footer><small>Sources</small><div>{opsBotAnswer.sources.map((source,index)=>source.href?<button key={`${source.label}-${index}`} onClick={()=>openResult(source.href!)}><strong>{source.label}</strong><span>{source.detail}</span><ArrowRight size={12}/></button>:<span key={`${source.label}-${index}`}><strong>{source.label}</strong> · {source.detail}</span>)}</div></footer>}</section>}
        {opsBotError&&<p className="opsbot-answer-error" role="alert">{opsBotError}</p>}
        {knowledgeLoading&&<p className="knowledge-answer-loading" role="status">Checking OpsWiki…</p>}
        {knowledgeAnswer&&!opsBotAnswer&&!opsBotLoading&&<section className={`knowledge-answer-card knowledge-answer-${knowledgeAnswer.confidence}`} aria-label="OpsWiki answer"><header><strong>OpsWiki answer</strong><span>{knowledgeAnswer.status}</span></header><h3>{knowledgeAnswer.title}</h3><p>{knowledgeAnswer.answer}</p>{knowledgeAnswer.detail&&<p className="knowledge-answer-detail">{knowledgeAnswer.detail}</p>}<footer><small>{knowledgeAnswer.sourceLabel} · {knowledgeAnswer.workspace}</small><button disabled={disabled} onClick={()=>openKnowledge(knowledgeAnswer.entryId)}>Open supporting record <ArrowRight size={13}/></button></footer></section>}
        {knowledgeError&&!opsBotAnswer&&!opsBotLoading&&<p className="knowledge-answer-error" role="status">{knowledgeError}</p>}
        {commands.length>0&&<section className="launcher-command-group"><div className="launcher-command-grid">{commands.map(name=><button key={name} disabled={disabled} onClick={()=>go(name)}><strong>Open {workspaceLabel(name)}</strong><ArrowRight size={14}/></button>)}</div></section>}
        {loading&&<p role="status">Searching Collected Records…</p>}
        {(!loading||Boolean(currentHistory?.results.length))&&<div className="global-search-groups">{[['customer','Customers'],['job','Appointments'],['crew','Krewe'],['truck','Fleet']].map(([type,label])=>{const rows=results.filter(row=>row.type===type);if(!rows.length)return null;return <section className="global-search-group" key={type} aria-label={label}><header><strong>{label}</strong><small>{type==='customer'?`${rows.length} of ${customerTotal}`:type==='job'?historyEligible?`${rows.length} shown`:`${rows.length} of ${total}`:rows.length}</small></header><div>{rows.map(result=><button key={result.id} disabled={disabled} onClick={()=>openResult(result.href)}><div><strong>{result.title}</strong><span>{result.subtitle}</span><small>{result.source}</small></div><ArrowRight size={15}/></button>)}</div></section>;})}</div>}
        {!loading&&more&&(limit<100?<button className="search-show-more" onClick={()=>setLimit(value=>Math.min(100,value+20))}>Show More Appointments</button>:<p>Showing 100 appointments. Refine the name, JK number, phone, or address to narrow the results.</p>)}
        {historyLoading&&<p role="status">Searching JunkWare appointment history…</p>}
        {currentHistory?.checkedAt&&<p className="search-coverage">JunkWare history checked · {scope==='all'?'All appointment dates':scope==='past'?'Before today':'Today onward'}. {currentHistory.hasMore?'More matches are available. Refine the address, JK number, phone, email, or surname: to narrow the search.':''}</p>}
        {currentHistory?.error&&<p role="alert">{currentHistory.error} <button className="search-show-more" onClick={()=>setHistoryRetry(value=>value+1)}>Retry history search</button></p>}
        {error&&<p role="alert">{error}</p>}
        {query.trim().length>=2&&!loading&&!historyLoading&&!results.length&&!error&&!customerError&&!currentHistory?.error&&!opsBotAnswer&&!opsBotLoading&&<p>{currentHistory?.checkedAt?'No matching appointments found. Try All or refine your search.':'No matching saved records. Search JunkWare history with a street number and address, JK number, phone, email, or surname: followed by a last name.'}</p>}
        {query.trim().length<2&&<p>Ask OpsBot about operations, an OpsCenter procedure, decision, or prior fix—or search by customer, JK number, phone, or service address.</p>}
        {coverage&&<p className="search-coverage">{coverage.dateCount?`Collected appointment dates: ${coverage.from}–${coverage.to}.`:'No collected appointment dates in this range.'} Saved dates may have gaps. Address, JK number, phone, email, and surname: searches also check JunkWare history.</p>}
      </div><footer><span><kbd>Esc</kbd> Close</span></footer>
    </section>}
  </div>;
}
