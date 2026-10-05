import React from 'react';
import { createRoot } from 'react-dom/client';
import { LiveFinance } from '../live-finance';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../opscenter-brand.css';
createRoot(document.getElementById('root')!).render(<main className="ops-live" style={{ padding: 16 }}><p>Synthetic resale QA · local fixture records only</p><LiveFinance date="2026-10-05" view="resale" /></main>);
