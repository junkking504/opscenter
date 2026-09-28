import assert from 'node:assert/strict';
import {gpsAppointmentTrips} from '../desktop-ui/lib/gps-appointment-trips';
import {gpsTripDisplay} from '../desktop-ui/lib/gps-trip-display';
import type {TruckGpsRoute} from '../desktop-ui/lib/gps-route-contract';
import type {ScheduleAppointment} from '../desktop-ui/lib/schedule-contract';

const stamp=(clock:string)=>`2026-09-08T${clock}:00.000Z`;
const route:TruckGpsRoute={date:'2026-09-08',truck:'Truck 3',status:'available',observedAt:null,coveredThrough:null,points:[],paths:[],gaps:0,rejected:0,
  trips:[{id:'engine-trip',number:1,departure:stamp('13:00'),arrival:stamp('17:00'),from:{latitude:30.4,longitude:-91.1,address:'Yard'},to:{latitude:30.4,longitude:-91.1,address:'Yard'}}]};
const job=(id:string,arrival:string,departure:string|null,truck='Truck 3')=>({recordId:`2026-09-08:appointment:${id}`,appointmentId:id,jkNumber:`JK${id}`,customerName:`Customer ${id}`,phone:'',truck:'Unassigned',location:{latitude:30.3,longitude:-91.1},
  truckVisits:[{truck,arrival:stamp(arrival),departure:departure?stamp(departure):null,observedThrough:stamp(departure || arrival)}]} as ScheduleAppointment);
const jobs=[job('1','14:00','14:20'),job('2','15:23','15:46')];
const original=JSON.stringify([route,jobs]);
const output=gpsAppointmentTrips(route,jobs);
assert.deepEqual(output.trips?.map(t=>[t.from.address,t.to.address,t.departure,t.arrival]),[
  ['Yard','JK1 · Customer 1',stamp('13:00'),stamp('14:00')],
  ['JK1 · Customer 1','JK2 · Customer 2',stamp('14:20'),stamp('15:23')],
  ['JK2 · Customer 2','Yard',stamp('15:46'),stamp('17:00')],
]);
assert.equal(JSON.stringify([route,jobs]),original,'GPS and bookings remain immutable');
assert.deepEqual(gpsTripDisplay(output,output.trips![1].id).bounds,[output.trips![1].from,output.trips![1].to],'Selecting an appointment leg frames its own endpoints');
assert.deepEqual(gpsAppointmentTrips(route,[job('3','14:00',null)]).trips,route.trips,'Unconfirmed departure cannot invent outbound travel');
assert.deepEqual(gpsAppointmentTrips(route,[job('3','14:00','14:20','Truck 4')]).trips,route.trips,'Other trucks are excluded');
assert.deepEqual(gpsAppointmentTrips(route,[job('3','14:00','14:40'),job('4','14:20','15:00')]).trips,route.trips,'Overlapping appointment identity is ambiguous');
assert.deepEqual(gpsAppointmentTrips(route,[{...jobs[0],recordId:'2026-09-07:appointment:1'}]).trips,route.trips,'Other operating days are excluded');
assert.deepEqual(gpsAppointmentTrips(route,[{...jobs[0],location:null}]).trips,route.trips,'Missing verified premises cannot create a stop');
assert.equal(gpsAppointmentTrips({...route,gaps:2},jobs).gaps,2,'Coverage gaps remain disclosed');
console.log('Appointment trips passed: yard/customer/customer/yard, exact timestamps, selection, truck/day/identity guards and source preservation.');
