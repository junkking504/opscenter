import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Truck, Users, RotateCcw } from 'lucide-react';
import modelDocument from './specops-model.html?raw';
import { workspaceReady } from './navigation-performance';
import { specOpsScenario } from './lib/specops-scenario';
import './specops.css';

const storageKey = 'opscenter.specops.scenario.v1';
export default function SpecOps({ navigate }: { navigate: (workspace: string) => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(2400);
  const [revision, setRevision] = useState(0);
  const [saveStatus, setSaveStatus] = useState('Scenario changes stay in this browser tab.');
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || !event.data || typeof event.data !== 'object') return;
      if (event.data.type === 'specops-height' && Number.isFinite(event.data.height)) {
        setHeight(Math.max(600, Math.min(30000, event.data.height + 4)));
      } else if (event.data.type === 'specops-ready') {
        try {
          const saved = specOpsScenario(JSON.parse(sessionStorage.getItem(storageKey) || 'null'));
          if (saved) frame.current?.contentWindow?.postMessage({ type: 'specops-restore', scenario: saved }, '*');
        } catch { setSaveStatus('Browser storage unavailable. Changes last until you leave this page.'); }
        workspaceReady('SpecOps');
      } else if (event.data.type === 'specops-scenario') {
        const scenario = specOpsScenario(event.data.scenario);
        if (!scenario) return;
        try { sessionStorage.setItem(storageKey, JSON.stringify(scenario)); }
        catch { setSaveStatus('Browser storage unavailable. Changes last until you leave this page.'); }
      }
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, []);
  function reset() {
    try { sessionStorage.removeItem(storageKey); } catch { /* Reload still resets the visible model. */ }
    setRevision(value => value + 1);
  }
  return <section className="specops-workspace" aria-label="SpecOps storm operations">
    <div className="specops-toolbar">
      <div><strong>Storm response planning</strong><p>{saveStatus} Estimates do not book jobs or commit trucks.</p></div>
      <div className="specops-actions">
        <button onClick={() => navigate('Schedule')}><CalendarDays size={15} />Control</button>
        <button onClick={() => navigate('Krewe')}><Users size={15} />Crew</button>
        <button onClick={() => navigate('Fleet')}><Truck size={15} />Convoy</button>
        <button onClick={reset}><RotateCcw size={15} />Reset scenario</button>
      </div>
    </div>
    <iframe key={revision} ref={frame} title="Gulf Coast storm cleanout planner" srcDoc={modelDocument}
      sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox" referrerPolicy="no-referrer"
      style={{ height }} className="specops-model" />
  </section>;
}
