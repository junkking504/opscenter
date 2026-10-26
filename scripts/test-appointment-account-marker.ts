import assert from 'node:assert/strict';
import {appointmentNotes,appointmentPickupItems} from '../lib/junkware-job-details';
import { appointmentAccountLabel } from '../lib/appointment-account-marker';

const job = {address: 'Amazon Mattress Removal 100 Example St, New Orleans, LA 70118', customerName: 'Example customer', pickupItems: [], appointmentNotes: []};
assert.equal(appointmentAccountLabel(job), 'Amazon');
assert.equal(appointmentAccountLabel({...job, address: 'amazon 100 Example St'}), 'Amazon');
for (const address of ['', '100 Amazon Street', 'Amazonia Storage 100 Example St', 'Home Sweet Home 100 Example St', 'DMTransportation 100 Example St']) {
  const candidate={...job, address, customerName: 'Amazon Customer', appointmentNotes: ['Bought a mattress on Amazon']};
  assert.equal(appointmentAccountLabel(candidate), null, 'Never infer account identity from a customer name or incidental brand mention');
}
console.log('Account marker uses source Amazon business label; unrelated names and brands stay unmarked.');

for(const number of ['8558880112','855-888-0112','(855) 888-0112','855.888.0112','+1 (855) 888-0112','1-855-888-0112','855–888–0112']) {
  for(const field of ['appointmentNotes','pickupItems']) {
    assert.equal(appointmentAccountLabel({address:'100 Example St',[field]:[`Call NA @ ${number} while onsite for approval.`]}),'National account',`${field}: ${number}`);
  }
}
for(const note of ['85588801129','98558880112','28558880112','+44 855 888 0112','refAB8558880112','8558880112abc','855-888-0113','855 888 0112 99','No account description available']) {
  assert.equal(appointmentAccountLabel({address:'100 Example St',appointmentNotes:[note]}),null,`Do not match a substring: ${note}`);
}
assert.equal(appointmentAccountLabel({address:'100 Example St',appointmentNotes:['855','8880112']}),null,'Do not join separate notes into a phone');
assert.equal(appointmentAccountLabel({address:'100 Example St',pickupItems:['855'],appointmentNotes:['8880112']}),null,'Do not join separate source fields');
assert.equal(appointmentAccountLabel({address:'100 Example St'}),null,'Missing description means no positive marker, never verified non-national');
assert.equal(appointmentAccountLabel({address:'855-888-0112 Example St'}),null,'National-account matching does not use the address');
const contactOnly={address:'100 Example St',customerName:'National Account 8558880112',phone:'8558880112'};
assert.equal(appointmentAccountLabel(contactOnly),null,'Names and customer contact numbers are not classification evidence');
assert.equal(appointmentAccountLabel({...job,appointmentNotes:['NA 855-888-0112']}),'Amazon','Existing Amazon label retains precedence');
console.log('National account marker: complete normalized source-description phone, country code, boundary/unknown-source checks and Amazon precedence PASS.');

for(const source of [{appointment_notes:['Call NA @ 855-888-0112 while onsite for approval.']},{job_description:'National account instructions: (855) 888-0112'}]) {
  assert.equal(appointmentAccountLabel({address:'100 Example St',appointmentNotes:appointmentNotes(source),pickupItems:appointmentPickupItems(source)}),'National account','Current source projection retains the positive marker');
}
