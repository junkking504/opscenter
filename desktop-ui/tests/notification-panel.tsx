import React from 'react';
import {createRoot} from 'react-dom/client';
import '../app/globals.css';

const alerts = Array.from({length: 9}, (_, index) => ({
  id: index + 1,
  title: `Truck ${index + 1}: load reconciliation needs attention`,
}));

createRoot(document.getElementById('root')!).render(
  <main className="ops-live" style={{margin: '40px 30px', width: 1000}}>
    <header className="topbar">
      <div />
      <div className="topbar-actions">
        <div className="notification-center">
          <button className="notification-backdrop" aria-label="Close alerts" />
          <button className="notification-trigger" aria-label={`${alerts.length} alerts need attention`}>Alerts</button>
          <aside className="notification-panel" role="dialog" aria-label="Alerts">
            <header><div><span>Operational sources · OpsCenter format</span><strong>Alerts</strong><small>{alerts.length} need attention · Essential operating information</small></div><button>Open Command</button></header>
            <div className="notification-list">
              {alerts.map((alert) => <article className="notification-alert warning" key={alert.id}>
                <i className="priority-mark warning" />
                <button className="notification-alert-open"><div><span className="notification-priority warning">Load tracking</span><small>Fleet · 2026-09-24</small></div><strong>{alert.title}</strong><p>Review the identified job or unload; confirmed amounts remain visible.</p><footer><span>Owner · Dispatch</span></footer></button>
                <div className="notification-alert-controls"><button>Acknowledge</button><button className="primary">Add to Control</button></div>
              </article>)}
            </div>
            <footer><span>Source and ownership stay attached</span><button>View All Alerts</button></footer>
          </aside>
        </div>
      </div>
    </header>
    <section className="synthetic-schedule-board" aria-label="Synthetic Schedule Board" style={{position: 'relative', zIndex: 1100, height: 650, background: '#fff'}}>Synthetic Schedule Board</section>
  </main>,
);
