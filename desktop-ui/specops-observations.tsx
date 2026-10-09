import { useEffect, useState } from 'react';
import { outageIsStale, specOpsConditions, stormCategory, stormIsStale, type SpecOpsConditions, type StormObservation } from './lib/specops-conditions';
const time = (value: string) => new Date(value).toLocaleString('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export default function SpecOpsObservations({ onStorm, applyStorm }: {
  onStorm: (storm: StormObservation | null, stale: boolean) => void;
  applyStorm: (storm: StormObservation) => void;
}) {
  const [conditions, setConditions] = useState<SpecOpsConditions | null>(null);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now);
  const [reload, setReload] = useState(0);
  const [applied, setApplied] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/desktop/specops', { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error('Unavailable');
        const value = specOpsConditions(await response.json());
        if (!controller.signal.aborted) { setConditions(value); setError(false); }
      } catch { if (!controller.signal.aborted) { setError(true); setConditions(null); } }
    }
    void load();
    // Read the local snapshot only. This never contacts an external provider.
    const refresh = window.setInterval(() => { setNow(Date.now()); void load(); }, 60000);
    return () => { controller.abort(); window.clearInterval(refresh); };
  }, [reload]);
  const storm = conditions?.storm || null, outage = conditions?.outage || null;
  const staleStorm = storm ? stormIsStale(storm, now) : true;
  useEffect(() => { onStorm(storm, staleStorm); }, [storm, staleStorm, onStorm]);
  const canApply = !!storm && !staleStorm && storm.speedMph >= 5 && storm.speedMph <= 25;
  return <section className="specops-observations" aria-label="Observed conditions">
    <div className="specops-observation-heading"><div><strong>Observed conditions</strong><p>Published source snapshots · refresh scheduled every 10 minutes while this chat’s source tabs remain available</p></div>
      <button onClick={() => { setNow(Date.now()); setReload(value => value + 1); }}>Reload saved observations</button></div>
    {error && <p role="status">Saved observations could not be loaded. Source status is unavailable.</p>}
    <div className="specops-observation-grid">
      <article><h2>Southeast power outages <span>{outage ? outageIsStale(outage, now) ? 'Stale snapshot' : 'Recent snapshot' : conditions || error ? 'Unavailable' : 'Loading…'}</span></h2>
        {outage ? <><div className="specops-observed-total">{outage.customersOut.toLocaleString()} <small>customers without power</small></div>
          <p>{outage.customersTracked.toLocaleString()} customers tracked</p>
          <dl>{outage.states.map(state => <div key={state.name}><dt>{state.name}</dt><dd>{state.customersOut.toLocaleString()}</dd></div>)}</dl>
          <p>Checked {time(outage.checkedAt)}. Source showed “updated {outage.sourceAgeMinutes}m ago” at that check.</p>
          <a href={outage.sourceUrl} target="_blank" rel="noopener noreferrer">PowerOutage.com source ↗</a></> : <p>No verified outage snapshot is available.</p>}
        <p className="specops-observation-note">Coverage: AL, FL, GA, NC, SC. Louisiana and Mississippi are not included. Customer outages do not confirm an individual store outage or cleanout need.</p>
      </article>
      <article><h2>NHC storm position <span>{storm ? staleStorm ? 'Stale observation' : 'Recent observation' : conditions || error ? 'Unavailable' : 'Loading…'}</span></h2>
        {storm ? <><div className="specops-observed-total">{storm.name}</div>
          <p><strong>{Math.abs(storm.lat).toFixed(1)}°{storm.lat >= 0 ? 'N' : 'S'}, {Math.abs(storm.lon).toFixed(1)}°{storm.lon >= 0 ? 'E' : 'W'}</strong> · observed {time(storm.observedAt)}</p>
          <dl><div><dt>Sustained wind</dt><dd>{storm.windMph} mph · {stormCategory(storm.windMph) ? `Category ${stormCategory(storm.windMph)}` : 'Below hurricane strength'}</dd></div>
            <div><dt>Movement</dt><dd>{storm.heading}° at {storm.speedMph} mph</dd></div><div><dt>Pressure</dt><dd>{storm.pressureMb} mb</dd></div></dl>
          <p>Checked {time(storm.checkedAt)}. The blue map marker shows this observed position when inside the map’s bounds.</p>
          <a href={storm.sourceUrl} target="_blank" rel="noopener noreferrer">Official NHC position update ↗</a>
          <div><button disabled={!canApply} onClick={() => { applyStorm(storm); setApplied(JSON.stringify(storm)); }}>Use observed intensity &amp; motion</button></div>
          {applied === JSON.stringify(storm) && <p role="status">Intensity and motion applied to the planning scenario. Your landfall point is unchanged.</p>}</> : <p>No verified storm position is available.</p>}
        <p className="specops-observation-note">The observed center is separate from the modeled landfall and wind swath. Planning estimates are not an official forecast. Older than 90 minutes is marked stale.</p>
      </article>
    </div>
  </section>;
}
