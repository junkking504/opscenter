import { createRoot } from 'react-dom/client';
import ScheduleMap from '../schedule-map';
import '../app/globals.css';
import '../live-schedule.css';
// Exercise the production loading/fallback path without contacting Apple.
const originalFetch = window.fetch;
window.fetch = (input, init) => String(input) === '/api/desktop/maps'
  ? Promise.resolve(Response.json({ provider: 'apple', token: 'synthetic-never-sent' }))
  : originalFetch(input, init);
const append = document.head.append.bind(document.head);
document.head.append = (...nodes) => {
  for (const node of nodes) {
    if (node instanceof HTMLScriptElement && node.src.includes('cdn.apple-mapkit.com')) queueMicrotask(() => node.dispatchEvent(new Event('error')));
    else append(node);
  }
};
const root = createRoot(document.getElementById('root')!);
root.render(<main className="ops-live"><h1>Apple SDK failure · synthetic</h1><div style={{position:'relative',width:700,maxWidth:'100%',height:420}}><ScheduleMap appointments={[]} trucks={[]} selected={null} selectedTruck={null} scope="ALL" resetKey={0} date="2026-10-29" onSelect={()=>{}} onSelectTruck={()=>{}} /></div></main>);
if (import.meta.hot) import.meta.hot.dispose(() => { root.unmount(); window.fetch = originalFetch; document.head.append = append; });
