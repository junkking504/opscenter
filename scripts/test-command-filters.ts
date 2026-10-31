import assert from 'node:assert/strict';
import { commandDone, commandAttention } from '../desktop-ui/lib/command-filters';
import { job } from './fixtures/crew-progress';
import type { ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
const appointment = (status: string, extra: Partial<ScheduleAppointment> = {}) => ({ ...job(), status, truck: 'Unassigned', ...extra }) as ScheduleAppointment;
for (const status of ['Canceled', 'Cancelled']) {
  assert.equal(commandDone(appointment(status)), false, `${status} is not Done`);
  assert.equal(commandAttention(appointment(status)), false, `${status} is not open attention`);
}
assert.equal(commandDone(appointment('Completed')), true);
assert.equal(commandDone(appointment('Completed', { appointmentType: 'Estimate' })), true);
assert.equal(commandDone(appointment('Confirmed')), false);
assert.equal(commandAttention(appointment('Completed')), false, 'Closed unassigned job is not attention');
assert.equal(commandAttention(appointment('Confirmed')), true, 'Open unassigned job needs attention');
assert.equal(commandAttention(appointment('Confirmed', { truck: 'Truck 2', location: { latitude: 30, longitude: -90 } })), false);
console.log('Command count filters PASS: closed jobs/estimates, both cancellation spellings, open assignment and location attention.');
