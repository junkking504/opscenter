import {Suspense, type ComponentProps, type ComponentType} from 'react';
import {preloadableWorkspace} from './lib/preloadable-workspace';

// These panels render only after their existing workspace/tab is selected.
// Their component-scoped styles travel with the panel, not every page load.
function deferredPanel<P extends object>(load:()=>Promise<{default:ComponentType<P>}>,label:string){
  const {Component}=preloadableWorkspace(load);
  return function DeferredPanel(props:P){return <Suspense fallback={<p role="status">Loading {label}…</p>}><Component {...props}/></Suspense>;};
}
export const SettingsWorkspace=deferredPanel<ComponentProps<typeof import('./settings-workspace').SettingsWorkspace>>(()=>import('./settings-workspace').then(module=>({default:module.SettingsWorkspace})),'settings');
export const AgentHierarchy=deferredPanel(()=>import('./agent-hierarchy'),'agent overview');
export const MaintenanceMonitor=deferredPanel(()=>import('./maintenance-monitor'),'maintenance monitor');
export const LivePhotoReview=deferredPanel<ComponentProps<typeof import('./live-photo-review').default>>(()=>import('./live-photo-review'),'photo review');
export const TruckAgents=deferredPanel<ComponentProps<typeof import('./truck-agents').default>>(()=>import('./truck-agents'),'truck recommendations');
