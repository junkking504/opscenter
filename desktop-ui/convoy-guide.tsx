import { lazy, Suspense, useState } from 'react';
import { BookOpen } from 'lucide-react';
import type { FleetView } from './lib/people-fleet-contract';

const GuideContent = lazy(() => import('./convoy-guide-content'));
export function ConvoyGuide({view,date,onView}: {view:FleetView;date:string;onView?: (view:FleetView)=>void}) {
  const [opened, setOpened] = useState(false);
  return <div className="convoy-orientation"><details className="convoy-guide" onToggle={event => { if (event.currentTarget.open) setOpened(true); }}><summary><BookOpen size={16}/>How to use Fleet</summary>{opened && <Suspense fallback={<p role="status">Loading Fleet guide…</p>}><GuideContent view={view} date={date} onView={onView}/></Suspense>}</details></div>;
}
