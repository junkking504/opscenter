export type HoursDay = {
  date: string; hours: number | null; regular: number; overtime: number;
  clockIn: string; clockOut: string; corrected: boolean;
  role: string; truck: string; jobs: number | null; jobRevenueWorked: number | null;
  status: 'Recorded' | 'On Shift' | 'Missing Clock-Out' | 'Hours Unavailable' | 'No Record' | 'Source Unavailable' | 'Upcoming';
};
export type HoursWeek = {
  start: string; end: string; total: number | null; regular: number; overtime: number;
  incomplete: boolean; days: HoursDay[];
};
export type KreweHoursSnapshot = {
  date: string; start: string; end: string; generatedAt: string; missingDates: string[];
  employees: Array<{ name: string; id: string; weeks: HoursWeek[]; total: number | null }>;
};
