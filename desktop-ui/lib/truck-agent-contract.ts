export type AgentPriority = 'urgent' | 'next' | 'watch';
export type AgentEvidence = { source: string; value: string; observedAt: string | null; href: string };
export type TruckRecommendation = {
  id: string; version: string; rule: string; title: string; detail: string;
  priority: AgentPriority; owner: string; due: string | null; href: string;
  evidence: AgentEvidence[]; firstSeenAt: string; changedAt: string;
  review: { status: 'acknowledged' | 'open'; actor: string; at: string; version: string } | null;
  reviewVersion: string;
};
export type TruckAgent = {
  id: string; truck: string; mode: string; status: 'ok' | 'degraded' | 'error';
  heartbeatAt: string; lastSuccessAt: string | null; error?: string;
  summary: { assigned: number | null; completed: number | null; nextJob: string | null; load: string; gpsAt: string | null; inspectionAt: string | null };
  sources: Array<{ name: string; observedAt: string | null; available: boolean; note: string }>;
  recommendations: TruckRecommendation[];
  history: Array<{ id: string; title: string; at: string; outcome: 'superseded'; version: string }>;
};
export type TruckAgentSnapshot = {
  version: 1; date: string; generatedAt: string; heartbeatAt: string | null; canWrite: boolean;
  agents: TruckAgent[]; dispatcher: { unassigned: number | null; scheduleAt: string | null; current: boolean };
  warnings: string[];
};
export const agentTruckNumber = (value: unknown): number | null => {
  const match = String(value || '').trim().match(/^(?:Truck\s*#?\s*)?([1-9])$/i);
  return match ? Number(match[1]) : null;
};
export const agentFleetHref = (date: string, truck: number, view = 'overview') => `/desktop?data=live&workspace=Fleet&fleetView=${view}&date=${date}&truck=${truck}`;
export const agentScheduleHref = (date: string, appointment?: string) => `/desktop?data=live&workspace=Schedule&scheduleView=board&scheduleDay=today&date=${date}${appointment ? `&appointment=${encodeURIComponent(appointment)}` : ''}`;
