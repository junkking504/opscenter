import assert from 'node:assert/strict';
import { serviceTerritory } from '../lib/service-territory';
import { appointmentColorClass, appointmentRegion, type ScheduleAppointment } from '../desktop-ui/lib/schedule-contract';
import { proposeRoutes, routePlanSourceKey, planEligible } from '../desktop-ui/lib/route-plan';
import { buildRoutePlan, parsePlanOptions } from '../lib/desktop-route-plan';
import { desktopCalendarDay } from '../lib/desktop-schedule-calendar';

const cases: Array<[string, string, string, string]> = [
  ['100 Example Rd Bldg 1, Greenwell Springs, 70739', 'New Orleans', 'BR', 'GWS'],
  ['100 Example Rd Bldg 1, Greenwell Springs, LA 70739-5532', 'Baton Rouge', 'BR', 'GWS'],
  ['100 Example Rd Greenwell Springs LA 70739', 'New Orleans', 'BR', 'GWS'],
  ['100 Example Rd, 70739', 'New Orleans', 'BR', 'GWS'],
  ['100 Example Rd, Lafayette, 70508', 'Baton Rouge', 'LF', 'LAF'],
  ['100 Lafayette St, New Orleans, LA 70113', 'Baton Rouge', 'NO', 'NO'],
  ['100 Greenwell Springs Rd, Baton Rouge, LA 70814', 'New Orleans', 'BR', 'BR'],
  ['100 Example Rd, Denham Springs, LA 70726', 'New Orleans', 'BR', 'LIV'],
  ['100 Example Rd, Gonzales, LA 70737', 'New Orleans', 'BR', 'ASC'],
  ['100 Example Rd, Covington, LA 70433', 'New Orleans', 'NS', 'COV'],
  ['100 Example Rd, Metairie, LA 70001', 'Baton Rouge', 'JP', 'MET'],
  ['100 Example Rd, Harvey, LA 70058', 'New Orleans', 'JP', 'WB'],
  ['100 Example Rd, New Orleans, LA 70114', 'New Orleans', 'JP', 'WB'],
  ['100 Example Rd, New Orleans, 70123', 'Jefferson Parish', 'JP', 'EB'],
  ['100 Example Rd Gonzales, LA 70737', 'New Orleans', 'BR', 'ASC'],
  ['100 Example Rd Unit 410 Baton Rouge, LA 70810', 'New Orleans', 'BR', 'BR'],
  ['100 Example Rd Pearl River, LA 70452', 'Northshore', 'NS', 'PR'],
  ['100 Example Rd, Walker, 70785', 'New Orleans', 'BR', 'LIV'],
  ['100 Example Rd, Chalmette, LA 70043', 'Westbank', 'NO', 'EM'],
  ['100 Example Rd, New Orleans East, LA 70128', 'Westbank', 'NO', 'EM'],
  ['100 Example Blvd New Orleans, LA 70114', 'Jefferson Parish', 'JP', 'WB'],
  ['100 Example Rd New Orleans, LA 70131', 'New Orleans', 'JP', 'WB'],
  ['100 Example Rd, New Orleans, LA 70128', 'New Orleans', 'NO', 'EM'],
  ['100 Example Rd, New Orleans, 70127-1234', 'New Orleans', 'NO', 'EM'],
  ['100 Example Rd, New Orleans, LA 70129', 'New Orleans', 'NO', 'EM'],
  ['100 Example Rd, New Orleans, LA 70126', 'New Orleans', 'NO', 'EM'],
  ['100 Example Rd, 70043', 'New Orleans', 'NO', 'EM'],
  ['70128 Westwego St, Metairie, LA 70001', 'Westbank', 'JP', 'MET'],
  ['100 Chalmette St, New Orleans, LA 70122', 'Westbank', 'NO', 'NO'],
  ['100 Example Rd, New Orleans East, LA 70114', 'New Orleans', 'UNK', 'UNK'],
  ['100 Example Rd, New Orleans, LA 70739', 'New Orleans', 'UNK', 'UNK'],
  ['100 Example Rd, Lafayette, IN 47901', 'Baton Rouge', 'UNK', 'UNK'],
  ['100 Example Rd, Lafayette, CA', 'Baton Rouge', 'UNK', 'UNK'],
  ['100 Example Rd, Unknown City, LA 99999', 'New Orleans', 'UNK', 'UNK'],
  ['100 Greenwell Springs Road', 'New Orleans', 'UNK', 'UNK'],
  ['', 'New Orleans', 'UNK', 'UNK'],
];
for (const [address, source, code, area] of cases) {
  const result = serviceTerritory(address, source);
  assert.equal(result.code, code, address);
  assert.equal(result.areaCode, area, address);
  assert.equal(result.sourceTerritory, source);
  assert.equal(result.needsReview, code === 'UNK');
  assert.equal(appointmentColorClass({address, territory: source}), `territory-${(['WB','EM'].includes(area) ? area : code).toLowerCase()}`, address);
}
const job = (id: string, address: string, territory: string) => ({ recordId: id, appointmentId: id, version: 'v1', jkNumber: 'JK_SYNTHETIC', address, territory, truck: 'Unassigned', status: 'Confirmed', appointmentType: 'Job', location: null, appointmentStartMinutes: 720 } as ScheduleAppointment);
const greenwell = job('greenwell-no', cases[0][0], 'New Orleans');
const sameAddress = { ...greenwell, recordId: 'greenwell-br', appointmentId: 'greenwell-br', territory: 'Baton Rouge' };
const metro = job('metro', cases[5][0], 'Baton Rouge');
const unknown = job('unknown', '', 'New Orleans');
assert.equal(appointmentRegion(greenwell).mismatch, true);
assert.equal(appointmentRegion(sameAddress).mismatch, false);
assert.equal(planEligible(unknown), false);
const jobs = [greenwell, sameAddress, metro, unknown];
const before = JSON.stringify(jobs);
const options = { trucks: ['Truck 1', 'Truck 2'], area: 'metro', start: 480, serviceMinutes: 30 };
assert.deepEqual(proposeRoutes(jobs, options).flatMap(r => r.appointmentIds), ['metro']);
assert.deepEqual(proposeRoutes(jobs, {...options, area:'BR'}).flatMap(r => r.appointmentIds).sort(), ['greenwell-br','greenwell-no']);
assert.equal(JSON.stringify(jobs), before, 'Never mutate source franchise or merge same-address appointments');
assert.deepEqual(desktopCalendarDay('2026-09-08', null, jobs).territories, {BR:2, NO:1, UNK:1}, 'Calendar uses the same physical service territories');
assert.notEqual(routePlanSourceKey([greenwell]), routePlanSourceKey([{...greenwell, address:metro.address}]), 'Address changes invalidate route proposals');
assert.throws(() => parsePlanOptions({...options, area:'UNK'}, {appointments:jobs, fleet:{trucks:[]}} as never));
assert.throws(() => parsePlanOptions({...options, routes:[{truck:'Truck 1',appointmentIds:['greenwell-no']},{truck:'Truck 2',appointmentIds:['metro']}]}, {appointments:jobs, fleet:{trucks:[]}} as never));
void buildRoutePlan({appointments:[{...greenwell,truck:'Truck 1'}]} as never, options, async()=>null).then(plan => {
  assert.ok(plan.routes[0].stops[0].warnings.includes('Existing Assignment Outside Selected Route Area'));
  assert.ok(plan.routes[0].stops[0].warnings.includes('Service Territory Differs From JunkWare Franchise'));
  console.log('Service territory regressions passed: address-first, franchise preservation, locality/ZIP conflicts, street-name traps, calendar parity, route gating, explicit cross-area warnings, identity preservation and stale-proposal invalidation.');
});
