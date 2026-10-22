import { useState } from 'react';
import { PushSettings } from './components/push-settings';
import { openingWorkspaces, readOpeningWorkspace, saveOpeningWorkspace } from './lib/workspace-preferences';
import { workspaceLabel } from './lib/workspace-labels';
import './settings-workspace.css';

type Source = { name: string; area: string; state: string; tone: string; freshness: string; detail?: string };
export function SettingsWorkspace({ canFinance, live, sources, loading, error, onSourceHealth, onBusyChange }: {
  canFinance: boolean; live: boolean; sources: Source[]; loading: boolean; error?: string;
  onSourceHealth: () => void; onBusyChange: (busy: boolean) => void;
}) {
  const [opening, setOpening] = useState(() => readOpeningWorkspace(canFinance));
  const [message, setMessage] = useState('');
  return <div className="settings-workspace">
    <section className="settings-card" aria-labelledby="preferences-title">
      <div className="section-title"><h2 id="preferences-title">My Preferences</h2></div>
      <p>Choose where OpsCenter opens in this browser.</p>
      <label className="settings-field" htmlFor="opening-workspace"><span>Default opening page</span>
        <select id="opening-workspace" value={opening} onChange={event => {
          const value = event.target.value;
          if (saveOpeningWorkspace(value)) { setOpening(value); setMessage('Saved for this browser.'); }
          else setMessage('Could not save this preference. Browser storage may be unavailable.');
        }}>{openingWorkspaces.filter(value => value !== 'Finance' || canFinance).map(value => <option key={value} value={value}>{workspaceLabel(value)}</option>)}</select>
      </label>
      <p className="settings-note">Applies when you open OpsCenter without a saved page or date link. This preference is shared by people using this browser and does not sync to other devices.</p>
      <p role="status">{message}</p>
    </section>
    <section className="settings-card" aria-labelledby="notifications-title">
      <div className="section-title"><h2 id="notifications-title">Notifications</h2></div>
      {live && canFinance ? <PushSettings showUnavailable onBusyChange={onBusyChange} /> : <p>{live ? 'Manager access is required to manage phone notifications.' : 'Open the live application to manage phone notifications.'}</p>}
    </section>
    <section className="settings-card settings-connections" aria-labelledby="connections-title">
      <div className="section-title"><h2 id="connections-title">Connections</h2><button type="button" onClick={onSourceHealth}>View source details</button></div>
      <p>Connection status and last observed updates from OpsCenter’s existing source checks.</p>
      {error && <p role="status">Connection status could not refresh. Any retained observations are shown below.</p>}
      {loading ? <p role="status">Loading connection status…</p> : sources.length ? <div className="settings-source-list">{sources.map(source => <article key={source.name}>
        <div><strong>{source.name}</strong><span>{source.area}</span></div>
        <span className={`settings-source-state ${source.tone}`}>{source.state}</span>
        <p>{source.freshness}</p>{source.detail && <p>{source.detail}</p>}
      </article>)}</div> : <p>Connection status is unavailable. No verified source observations were returned.</p>}
    </section>
  </div>;
}
