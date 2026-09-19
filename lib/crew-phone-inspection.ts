import { createHash } from 'node:crypto';
import { CrewPhoneError, type CrewPhone, type CrewPhoneDay, type CrewInspectionState } from './crew-phone';
import { readCrewDay, requireCrewDay } from './crew-phone-day';
import { inspectionDate, type InspectionDevice } from './truck-inspection';
import { listTruckInspections } from './truck-inspection-store';

/** A new daily setup gets its own inspection identity. It has no public connection token. */
export function crewInspectionDevice(phone: CrewPhone, day: CrewPhoneDay): InspectionDevice {
  const hex = createHash('sha256').update(`waypoint:${phone.deviceId}:${day.date}:${day.requestId}`).digest('hex');
  const deviceId = `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
  return { deviceId, truck: day.truck, label: phone.label, createdAt: day.savedAt, expiresAt: phone.expiresAt };
}

export function crewInspectionReport(phone: CrewPhone, day = readCrewDay(phone)) {
  if (!day) return null;
  return listTruckInspections(day.date).filter(report => report.truck === day.truck && report.inspectionDate === day.date).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt) || Number(b.status==='stop')-Number(a.status==='stop'))[0] || null;
}

export function crewInspectionState(phone: CrewPhone, day = readCrewDay(phone)): CrewInspectionState {
  const report = crewInspectionReport(phone, day);
  if (!report) return { status: 'required' };
  if (!['clear','reported','stop'].includes(report.status) || !Number.isFinite(Date.parse(report.receivedAt))) throw new CrewPhoneError('The inspection receipt needs recovery. Contact your manager.',503);
  return { status: report.status === 'stop' ? 'blocked' : 'ready', requestId: report.requestId, truck: report.truck, receivedAt: report.receivedAt };
}

export function requireCrewInspection(phone: CrewPhone) {
  const day = requireCrewDay(phone);
  const report = crewInspectionReport(phone, day);
  if (!report || report.inspectionDate !== inspectionDate()) throw new CrewPhoneError('Complete today’s truck inspection before opening jobs.', 409);
  if (!['clear','reported','stop'].includes(report.status) || !Number.isFinite(Date.parse(report.receivedAt))) throw new CrewPhoneError('The inspection receipt needs recovery. Contact your manager.',503);
  if (report.status === 'stop') throw new CrewPhoneError('Do not operate this truck. Contact your manager before opening jobs.', 409);
  return report;
}
