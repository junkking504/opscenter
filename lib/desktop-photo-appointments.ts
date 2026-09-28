import { readJobRows, junkwareScheduleUpdatedAt } from './desktop-schedule-source';
import { PhotoAssignmentError } from './whatsapp-photo-review-assignment';
import type { PhotoAppointmentOptions } from '../desktop-ui/lib/photo-review-contract';

export function photoAppointmentOptions(date: string): PhotoAppointmentOptions {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T12:00:00Z`)) || new Date(`${date}T12:00:00Z`).toISOString().slice(0, 10) !== date) throw new PhotoAssignmentError('Choose a valid appointment date.');
  return { date, sourceAt: junkwareScheduleUpdatedAt(date), appointments: readJobRows(date).filter(row => /^\d{1,12}$/.test(row.appointmentId) && /^JK\d{4,12}$/.test(row.jkNumber) && !/cancelled|canceled/i.test(row.status)).map(row => ({ appointmentId: row.appointmentId, jk: row.jkNumber, date, truck: row.truck || '', customer: row.customerName, address: row.address, time: row.appointmentTime, status: row.status })) };
}
