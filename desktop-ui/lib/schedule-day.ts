export type ScheduleDay = 'today' | 'tomorrow';

export const dateForDay = (base: string, day: ScheduleDay) => { const date = new Date(`${base}T12:00:00Z`); if (day === 'tomorrow') date.setUTCDate(date.getUTCDate() + 1); return date.toISOString().slice(0, 10); };
