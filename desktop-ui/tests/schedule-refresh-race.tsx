import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useDisplayedRefresh } from '../displayed-refresh';
function Probe() {
  const refresh = useDisplayedRefresh('Schedule');
  const [result, setResult] = useState('Ready');
  return <div><button disabled={!refresh} onClick={() => { setResult('Pending'); void refresh?.().then(() => setResult('Refreshed'), error => setResult(error.message)); }}>Read displayed snapshot</button><output id="refresh-result">{result}</output></div>;
}
createRoot(document.getElementById('refresh-probe')!).render(<Probe />);
