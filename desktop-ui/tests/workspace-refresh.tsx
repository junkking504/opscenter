import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useWorkspaceRefresh } from '../workspace-freshness';
import { useDisplayedRefresh, useRegisterDisplayedRefresh } from '../displayed-refresh';
const engine = { mode: 'fail', calls: 0, aborts: 0, release: [] as Array<() => void>, direct: undefined as ((signal: AbortSignal) => Promise<void>) | undefined };
declare global { interface Window { refreshTest: typeof engine } }
window.refreshTest = engine;
function Reader({ paused }: { paused: boolean }) {
  const [value, setValue] = useState(0);
  const load = useCallback(async (signal: AbortSignal) => {
    const value = ++engine.calls;
    if (engine.mode === 'fail') throw new Error('Synthetic poll failed');
    if (engine.mode === 'hold') await new Promise<void>((resolve, reject) => {
      const aborted = () => { engine.aborts++; reject(signal.reason); };
      signal.addEventListener('abort', aborted, { once: true });
      engine.release.push(() => { signal.removeEventListener('abort', aborted); resolve(); });
    });
    if (!signal.aborted) setValue(value);
  }, []);
  const state = useWorkspaceRefresh(load, 'fixture', paused, 60_000);
  useRegisterDisplayedRefresh('Fixture', state.refreshDisplayed, paused, 'fixture');
  useEffect(() => { engine.direct = state.refreshDisplayed; return () => { engine.direct = undefined; }; }, [state.refreshDisplayed]);
  return <output id="reader">{JSON.stringify({value,error:state.error,pending:state.pending,receivedAt:state.receivedAt})}</output>;
}
function Fixture() {
  const [paused, setPaused] = useState(false), [mounted, setMounted] = useState(true), [result, setResult] = useState('Ready');
  const refresh = useDisplayedRefresh('Fixture');
  return <><button onClick={() => setPaused(value => !value)}>Toggle editing</button><button onClick={() => setMounted(value => !value)}>Toggle mount</button><button disabled={!refresh} onClick={() => { setResult('Pending'); void refresh?.().then(() => setResult('Refreshed'), () => setResult('Cancelled or failed')); }}>Pull snapshot</button><output id="result">{result}</output>{mounted && <Reader paused={paused} />}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
