import React from 'react';
import { createRoot } from 'react-dom/client';
import Home from '../app/page';
import { workspaceShell } from '../lib/workspace-bootstrap';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../opscenter-brand.css';

// Exercise the actual shared header and workspace stacking contexts. All API
// traffic is intercepted by the browser test; no operational data is used.
const url = new URL(window.location.href);
url.searchParams.set('workspace', 'Finance');
url.searchParams.set('financeView', 'resale');
window.history.replaceState({}, '', url);
const snapshot = workspaceShell({ date: '2026-10-05', actor: { displayName: 'Synthetic QA', role: 'Administrator' } });
snapshot.sources.alerts = true;
snapshot.alerts = [{ id: 'fixture-alert', domain: 'Finance', priority: 'watch', title: 'Synthetic alert', detail: 'Local fixture only', label: 'Review', owner: 'QA', detected: 'Now', source: 'Fixture', action: 'Review', context: 'Fixture', facts: [], href: '', needsAction: true, workflowState: 'active', version: 1 }];
createRoot(document.getElementById('root')!).render(<Home live={{ snapshot, error: '', pendingAlertId: null, onDateChange: () => {}, onAlertAction: async () => {} }} />);
