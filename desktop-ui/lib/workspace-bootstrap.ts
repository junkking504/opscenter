import type { DesktopCommandSnapshot } from './live-contract';

export type WorkspaceBootstrap = { date: string; actor: DesktopCommandSnapshot['actor'] };
export function workspaceShell({ date, actor }: WorkspaceBootstrap): DesktopCommandSnapshot {
  return {
    date, actor, loading: true, generatedAt: '', kpis: [], alerts: [],
    sources: { metrics: false, alerts: false, workflow: false },
    sourceHealth: [{ name: 'Source status', area: 'Connected sources', workspace: 'Command',
      action: 'Open Command', state: 'Loading', tone: 'warning', observedAt: null, maxAgeSeconds: 0 }],
  };
}
