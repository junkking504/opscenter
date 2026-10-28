import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { buildSync } from 'esbuild';
import { appointmentSummaryCancellation as cancellation, appointmentSummaryPhoneHref as phone, appointmentSummaryWork as work } from '../desktop-ui/lib/appointment-summary';

const status = { appointmentType:'Estimate', status:'Confirmed', cancellationReason:'Cancellation reason unavailable' };
for (const state of ['Confirmed','Open','Completed','Closed']) assert.equal(cancellation({...status,status:state}),null);
assert.equal(cancellation({...status,cancellationReason:'Stale earlier reason'}),null);
assert.equal(cancellation({...status,status:'Canceled',cancellationReason:'Customer changed plans'}),'Cancellation reason: Customer changed plans');
for (const reason of ['', '  ', 'N/A', 'Cancellation reason unavailable']) assert.equal(cancellation({...status,status:'Cancelled',cancellationReason:reason}),'Cancellation reason unavailable');
assert.equal(status.status,'Confirmed','Presentation must not mutate status');

// Entirely synthetic descriptions; no customer records in fixtures.
const source={pickupItems:[],junkItems:['Construction debris','Tires'],appointmentNotes:['Note: Customer will be absent; call with a quote. Disposing about 5 items like 4 broken stone panels, 80 to 95 lbs each, and a tire filled with sand. (10/20/2026 9:00:00 PM , Customer)']};
assert.equal(work(source),'about 5 items: 4 broken stone panels, 80 to 95 lbs each, and a tire filled with sand.');
assert.equal(work({...source,pickupItems:['Construction debris','Tires']}),work(source),'Category-only pickup fields must not hide concrete notes');
assert.equal(work({...source,pickupItems:['Two oak cabinets; keep the glass doors.']}),'Two oak cabinets; keep the glass doors.','Explicit source description takes precedence over notes');
assert.equal(work({...source,appointmentNotes:['Please remove the blue sofa. Do not remove the piano.']}),'remove the blue sofa. · Do not remove the piano.','Negations are retained with item details');
assert.equal(work({...source,appointmentNotes:['Items: about two shelves, contents unknown.']}),'Items: about two shelves, contents unknown.');
assert.equal(work({...source,appointmentNotes:['Customer requested an ETA.']}),'Construction debris · Tires','Do not present call-center boilerplate as inventory');
assert.equal(work({...source,appointmentNotes:['Call before pickup.']}),'Construction debris · Tires','A callback instruction must not replace the recorded inventory');
assert.equal(work({...source,appointmentNotes:['Two custom display cases; contents unknown.']}),'Two custom display cases; contents unknown.','Unrecognized inventory names and uncertainty are retained');
assert.equal(work({junkItems:[],appointmentNotes:['Online request: A large custom display case; quantity unknown.']}),'A large custom display case; quantity unknown.');
assert.equal(work({junkItems:[],appointmentNotes:[]}), '');
assert.equal(source.appointmentNotes[0].startsWith('Note:'),true,'Original full notes are untouched');
assert.equal(phone('(504) 555-0142'),'tel:+15045550142');
assert.equal(phone('+44 20 7946 0123'),'tel:+442079460123');
assert.equal(phone('1 (504) 555-0142 ext. 29'),'tel:+15045550142;ext=29');
for(const value of ['', '—', 'Phone unavailable', '123', 'not a number 1234567890', '555-0101 / 555-0102'])assert.equal(phone(value),null);

const desktopRequire=createRequire(path.resolve('desktop-ui/package.json'));
const React=desktopRequire('react'),{renderToStaticMarkup}=desktopRequire('react-dom/server');
const bundle=buildSync({entryPoints:['desktop-ui/appointment-summary-dialog.tsx'],bundle:true,platform:'node',format:'cjs',packages:'external',loader:{'.css':'empty'},jsx:'automatic',write:false}).outputFiles[0].text;
const exported={exports:{}};
new Function('require','module','exports',bundle)(desktopRequire,exported,exported.exports);
const Summary=(exported.exports as {AppointmentSummaryDialog:Parameters<typeof React.createElement>[0]}).AppointmentSummaryDialog;
const job={...status,...source,recordId:'synthetic',appointmentId:'synthetic',jkNumber:'JKSYNTHETIC',customerName:'Synthetic Customer',phone:'(504) 555-0142',address:'100 Example Street, New Orleans, LA 70130',truck:'Truck 8',territory:'New Orleans',paymentType:'',paymentAmount:0,tipAmount:0};
const render=(extra:Record<string,unknown>)=>renderToStaticMarkup(React.createElement(Summary,{job:{...job,...extra},date:'2026-10-20',close(){},openDetails(){},returnFocus:null}));
assert.doesNotMatch(render({}),/Cancellation reason/);
assert.match(render({status:'Canceled',cancellationReason:'Customer changed plans'}),/Cancellation reason: Customer changed plans/);
assert.match(render({status:'Canceled',cancellationReason:''}),/Cancellation reason unavailable/);
assert.doesNotMatch(render({status:'Canceled',cancellationReason:''}),/Cancellation reason: Cancellation reason/);
assert.match(render({}),/href="tel:\+15045550142"/);
assert.match(render({}),/destination=100%20Example%20Street/);
assert.match(render({phone:''}),/Phone unavailable/);
assert.doesNotMatch(render({phone:''}),/href="tel:/);
console.log('Appointment summary content PASS: source status/reasons, detailed note fallback, quantities/negation/full-note retention, phone normalization and missing contacts.');
