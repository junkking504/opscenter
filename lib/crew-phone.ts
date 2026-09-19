export type CrewPhone = {
  deviceId: string;
  truck: string;
  label: string;
  enrolledAt: string;
  expiresAt: string;
};

export class CrewPhoneError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

// Separate from inspection connections, employee payroll and manager sessions.
export const CREW_PHONE_COOKIE = '__Secure-ops_crew_phone';
export const CREW_PHONE_API = '/api/crew-jobs/session';

export type CrewPhoneDirectory = {
  company: Array<{ label: string; truck: string; number: string }>;
  managers: Array<{ name: string; number: string }>;
};

export type CrewPhoneDelivery = {
  requestId: string; truck: string; label: string; number: string; deviceId: string;
  createdAt: string; expiresAt: string; status: 'pending' | 'accepted' | 'failed' | 'uncertain';
  message: string; providerMessageId?: string; cancelled?: boolean; test?: boolean;
};

export type CrewPhoneDay = {deviceId:string;truck:string;date:string;version:number;requestId:string;responsible:string;driver:string;navigators:string[];savedAt:string};

export const CREW_JOBS_ORIGIN = 'https://waypoint.junk-king.app';
export const CREW_JOBS_KINGPIN_ORIGIN = 'https://kingpin.junk-king.app';
export const CREW_JOBS_LEGACY_ORIGIN = 'https://jobs.junk-king.app';
export const MANAGER_SCHEDULE_URL = 'https://ops.junk-king.app/desktop?workspace=Schedule&scheduleDay=today&scheduleView=board';
export const CREW_JOBS_PUBLIC_PATHS = ['/crew-jobs', '/crew-jobs/manifest.webmanifest', '/crew-jobs/icon.png', '/crew-jobs/waypoint-crown-road-v1-32.png', '/crew-jobs/waypoint-crown-road-v1-180.png', '/crew-jobs/waypoint-crown-road-v1-192.png', '/crew-jobs/waypoint-crown-road-v1-512.png', '/crew-jobs/waypoint-compass-crown-v2-32.png', '/crew-jobs/waypoint-compass-crown-v2-180.png', '/crew-jobs/waypoint-compass-crown-v2-192.png', '/crew-jobs/waypoint-compass-crown-v2-512.png', '/crew-jobs/waypoint-compass-crown-v1-32.png', '/crew-jobs/waypoint-compass-crown-v1-180.png', '/crew-jobs/waypoint-compass-crown-v1-192.png', '/crew-jobs/waypoint-compass-crown-v1-512.png', '/api/crew-jobs/session', '/api/crew-jobs/day', '/api/crew-jobs/inspection', '/api/crew-jobs/switch-truck', '/api/crew-jobs/current', '/api/crew-jobs/photos', '/api/crew-jobs/closeout'];

export type CrewInspectionState = { status: 'required' | 'ready' | 'blocked'; requestId?: string; truck?: string; receivedAt?: string };
