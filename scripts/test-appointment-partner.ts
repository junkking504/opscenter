import assert from 'node:assert/strict';
import { appointmentPartner, serviceAddressForGeocoding } from '../lib/appointment-partner';
import { verifyGoogleAddress } from '../lib/desktop-address-verification';
import { scheduleMatchesQuery, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';

const address = 'Amazon Mattress Removal 100 Example Blvd 251 NEW ORLEANS, LA 70123';
const job = { address, customerName: 'Example Customer' } as ScheduleAppointment;
assert.deepEqual(appointmentPartner(job), { name: 'Amazon', short: 'AMZ' });
assert.equal(serviceAddressForGeocoding(address), '100 Example Blvd 251 NEW ORLEANS, LA 70123');
for (const prefix of ['Home Sweet Home', 'DMTransportation', 'DM Transportation']) {
  assert.ok(appointmentPartner({ ...job, address: `${prefix} 100 Example Blvd, LA 70123` }));
  assert.equal(serviceAddressForGeocoding(`${prefix} 100 Example Blvd, LA 70123`), '100 Example Blvd, LA 70123');
}
assert.equal(appointmentPartner({ ...job, address: '100 Amazon Street, LA 70123' }), null);
assert.equal(appointmentPartner({ ...job, address: 'Amazonia Storage 100 Example Blvd, LA 70123' }), null);
assert.equal(appointmentPartner({ ...job, address: '100 Example Blvd, LA 70123', appointmentNotes: ['Bought mattress from Amazon'] } as ScheduleAppointment), null);
for (const input of ['100 Example Blvd 251 NEW ORLEANS, LA 70123', 'Amazon Mattress Removal', '100 Amazon Way, LA 70123', 'Company 2 Locations 100 Example Blvd, LA 70123']) {
  assert.equal(serviceAddressForGeocoding(input), input, 'Do not guess a street or remove meaningful source numbers');
}
assert.equal(scheduleMatchesQuery(job, 'AMZ'), true);
const component = (type: string, value: string) => ({ types: [type], long_name: value, short_name: value });
const result = { address_components: [component('street_number', '100'), component('route', 'Example Boulevard'), component('postal_code', '70123'), component('administrative_area_level_1', 'LA'), component('country', 'US')], geometry: { location: { lat: 29.95, lng: -90.1 }, location_type: 'ROOFTOP' } };
assert.ok(verifyGoogleAddress(address, { status: 'OK', results: [result] }).location, 'Verify against the unmodified source address');
assert.equal(verifyGoogleAddress(address, { status: 'OK', results: [{ ...result, partial_match: true }] }).location, null);
assert.equal(verifyGoogleAddress(address.replace('100', '101'), { status: 'OK', results: [result] }).location, null);
assert.equal(verifyGoogleAddress(address.replace('70123', '70124'), { status: 'OK', results: [result] }).location, null);
console.log('Partner identity, exact service-address normalization, search, and geocode safety passed.');
