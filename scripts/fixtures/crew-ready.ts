import { randomUUID } from 'node:crypto';
import type { CrewPhone } from '../../lib/crew-phone';
import { requireCrewDay } from '../../lib/crew-phone-day';
import { crewInspectionDevice } from '../../lib/crew-phone-inspection';
import { INSPECTION_SECTIONS } from '../../lib/truck-inspection';
import { submitTruckInspection } from '../../lib/truck-inspection-store';

/** Callers must point OPS_TRUCK_INSPECTION_DIR at isolated test storage. */
export function readyCrewInspection(phone: CrewPhone) {
  if (!process.env.OPS_TRUCK_INSPECTION_DIR) throw new Error('Use isolated inspection storage.');
  const day = requireCrewDay(phone);
  return submitTruckInspection({ requestId: randomUUID(), truck: day.truck, inspector: day.responsible,
    odometer: '12345', fuel: 'Full', loadLevel: 'Empty', startedAt: new Date().toISOString(),
    answers: INSPECTION_SECTIONS.map(section => ({ id: section.id, status: 'good', notes: '' })),
    photos: [], status: 'clear', notes: '', initials: 'TS' }, crewInspectionDevice(phone, day));
}
