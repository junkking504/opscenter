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

export type CrewPhoneDay = {deviceId:string;truck:string;date:string;version:number;requestId:string;responsible:string;driver:string;navigators:string[];savedAt:string};
