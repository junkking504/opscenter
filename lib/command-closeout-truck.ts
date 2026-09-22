import { truckDisplayText } from './junkware-trucks';
import type { OperationalAlert } from './operational-alert-presentation';

type SavedAppointment = { status: string; truck: string };

// The timeline keeps the original event, but its completion heading must reflect
// a saved assignment correction, just as its payment and visit facts do.
export function withSavedCloseoutTruck(alert: OperationalAlert, matches: SavedAppointment[]): OperationalAlert {
  if (!['Job Closed', 'Estimate Closed', 'Job Completed', 'Estimate Completed'].includes(alert.label)
      || matches.length !== 1 || !/complete|closed/i.test(matches[0].status)) return alert;
  const number = matches[0].truck.match(/^Truck\s*#?\s*(\d+)$/i)?.[1];
  if (!number || Number(number) <= 0) return alert;
  const truck = `Truck ${Number(number)}`;
  return { ...alert, truck, title: truckDisplayText(alert.title.replace(/\bTruck\s*#?\s*\d+\b/gi, truck)) };
}
