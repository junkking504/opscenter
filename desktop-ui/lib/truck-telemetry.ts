import type { ScheduleTruck } from './schedule-contract';

/** Speed belongs to the same provider observation as the position. */
export function truckTelemetry(truck?: Pick<ScheduleTruck, 'speed' | 'lastGpsUpdate'>, now = Date.now()) {
  const age = now - Date.parse(truck?.lastGpsUpdate || '');
  const validTime = Number.isFinite(age) && age >= 0;
  const recent = validTime && age <= 180_000;
  const validSpeed = typeof truck?.speed === 'number' && Number.isFinite(truck.speed) && truck.speed >= 0;
  const speed = validSpeed && validTime ? `${Math.round(truck.speed!)} mph` : 'Unavailable';
  const seconds = Math.floor(age / 1000);
  const reportAge = !validTime ? 'Report time unavailable' : seconds < 60 ? `${seconds}s ago`
    : seconds < 3600 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s ago`
    : `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}m ago`;
  return { speed, recent, reportAge, label: recent ? 'Reported speed' : 'Last reported speed',
    markerLabel: speed === 'Unavailable' ? 'Speed unavailable' : recent ? speed : `Last ${speed}` };
}
