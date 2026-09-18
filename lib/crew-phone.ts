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
export const CREW_PHONE_PUBLIC_PATHS = ['/crew-jobs', CREW_PHONE_API] as const;
