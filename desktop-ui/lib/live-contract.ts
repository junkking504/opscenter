export type DesktopSourceHealth = { name: string; area: string; workspace: string; action: string; state: string; tone: 'healthy' | 'warning'; observedAt: string | null; maxAgeSeconds: number; href?: string };
export type DesktopKpi = {
  label: string;
  value: string;
  detail: string;
  progress: number;
  tone: 'healthy' | 'warning' | 'critical';
  segments?: Array<{ label: string; value: number; tone: string }>;
};

export type DesktopAlert = {
  id: string;
  domain: string;
  priority: 'critical' | 'warning' | 'watch';
  title: string;
  detail: string;
  label: string;
  owner: string;
  detected: string;
  source: string;
  action: string;
  context: string;
  facts: Array<{ label: string; value: string; href?: string }>;
  href: string;
  needsAction: boolean;
  workflowState: 'active' | 'acknowledged' | 'in-control' | 'resolved';
  version: number;
  actionId?: string;
};

export type DesktopCommandSnapshot = {
  date: string;
  generatedAt: string;
  actor: { displayName: string; role: string };
  kpis: DesktopKpi[];
  alerts: DesktopAlert[];
  sourceHealth?: DesktopSourceHealth[];
  sources: { metrics: boolean; alerts: boolean; workflow: boolean };
};

export type DesktopLiveProps = {
  onBusyChange?: (busy: boolean) => void;
  onDateChange: (date: string, workspace?: string) => void;
  snapshot: DesktopCommandSnapshot;
  pendingAlertId: string | null;
  error: string;
  onAlertAction: (alertId: string, action: 'acknowledge' | 'add_to_control') => Promise<void>;
};
