import assert from 'node:assert/strict';
import { appointmentAccountLabel } from '../lib/appointment-account-marker';

const job = {address: 'Amazon Mattress Removal 100 Example St, New Orleans, LA 70118', customerName: 'Example customer', pickupItems: [], appointmentNotes: []};
assert.equal(appointmentAccountLabel(job), 'Amazon');
assert.equal(appointmentAccountLabel({...job, address: 'amazon 100 Example St'}), 'Amazon');
for (const address of ['', '100 Amazon Street', 'Amazonia Storage 100 Example St', 'Home Sweet Home 100 Example St', 'DMTransportation 100 Example St']) {
  const candidate={...job, address, customerName: 'Amazon Customer', appointmentNotes: ['Bought a mattress on Amazon']};
  assert.equal(appointmentAccountLabel(candidate), null, 'Never infer account identity from a customer name or incidental brand mention');
}
console.log('Account marker uses source Amazon business label; unrelated names and brands stay unmarked.');
