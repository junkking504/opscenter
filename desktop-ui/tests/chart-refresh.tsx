import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveAnalytics } from '../live-analytics';
import { useDisplayedRefresh } from '../displayed-refresh';
import type { AnalyticsScope, OperatingTrendsData } from '../../lib/operating-trends';
const engine = { mode: 'hold', value: 100, aborts: 0, requests: [] as Array<{url: string; method: string}>, release: [] as Array<() => void> };
declare global { interface Window { chartRefreshTest: typeof engine } }
window.chartRefreshTest = engine;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.startsWith('/api/desktop/analytics?')) return originalFetch(input, init);
  engine.requests.push({url, method: init?.method || 'GET'});
  const signal = init?.signal;
  const mode = engine.mode, value = engine.value;
  if (mode === 'hold') await new Promise<void>((resolve, reject) => {
    const abort = () => { engine.aborts++; reject(signal?.reason); };
    signal?.addEventListener('abort', abort, {once: true});
    engine.release.push(() => { signal?.removeEventListener('abort', abort); resolve(); });
  });
  signal?.throwIfAborted();
  if (mode === 'fail') return Response.json({error:'Synthetic chart read failed'}, {status:503});
  const data: OperatingTrendsData = {generatedAt:'2026-10-25T12:00:00Z',snapshotDate:'2026-10-25',historyThrough:'2026-10-24',wexCoverage:null,forecasts:[],daily:[{date:'2026-10-22',revenue:null,completedJobs:null,recordedFuel:null,wexCost:null,gallons:null,netPerGallon:null,dumpCost:null,jobDay:null},{date:'2026-10-23',revenue:0,completedJobs:0,recordedFuel:null,wexCost:null,gallons:null,netPerGallon:null,dumpCost:null,jobDay:'zero'},{date:'2026-10-24',revenue:value,completedJobs:2,recordedFuel:null,wexCost:null,gallons:null,netPerGallon:null,dumpCost:null,jobDay:'operating'}]};
  return Response.json({data: mode === 'null' ? null : data});
};
function Fixture() {
  const [mounted,setMounted]=useState(true),[date,setDate]=useState('2026-10-25'),[scope,setScope]=useState<AnalyticsScope>('forecast'),[result,setResult]=useState('Ready');
  const refresh=useDisplayedRefresh('Fixture');
  return <><button onClick={()=>setMounted(value=>!value)}>Toggle mount</button><button onClick={()=>setDate(value=>value==='2026-10-25'?'2026-10-24':'2026-10-25')}>Change date</button><button onClick={()=>setScope(value=>value==='forecast'?'business':'forecast')}>Change scope</button><button disabled={!refresh} onClick={()=>{setResult('Pending');void refresh?.().then(()=>setResult('Refreshed'),()=>setResult('Cancelled or failed'));}}>Pull snapshot</button><output id="result">{result}</output>{mounted&&<LiveAnalytics date={date} scope={scope} focusMetric="revenue" refreshWorkspace="Fixture"/>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
