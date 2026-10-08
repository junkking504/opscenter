import type { servicePlan } from '../../lib/fleet-service-plan';

/** Fraction of a recorded service interval used. Unknown mileage never becomes zero. */
export function serviceGauge(plan: ReturnType<typeof servicePlan>) {
  const fractions: number[] = [];
  if (plan.nextMiles !== null && plan.milesRemaining !== null && plan.completed?.odometer != null) {
    const interval = plan.nextMiles - plan.completed.odometer;
    if (interval > 0) fractions.push(1 - plan.milesRemaining / interval);
  }
  if (plan.nextDate && plan.daysRemaining !== null && plan.completed) {
    const interval = (Date.parse(plan.nextDate) - Date.parse(plan.completed.serviceDate)) / 86400000;
    if (interval > 0) fractions.push(1 - plan.daysRemaining / interval);
  }
  return plan.status === 'due' ? 100 : fractions.length ? Math.max(0, Math.min(100, Math.round(Math.max(...fractions) * 100))) : null;
}
