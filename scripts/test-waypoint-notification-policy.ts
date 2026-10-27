import assert from 'node:assert/strict';
import {waypointPushProjection as projection,waypointPushChange as change} from '../lib/waypoint-push-change';
import {waypointNotificationMessage,waypointJobChanges} from '../lib/waypoint-update-context';
import {encryptPushMessage,pushPath} from '../lib/web-push-message';
import {createECDH,randomBytes} from 'node:crypto';
const job={appointmentId:'1',status:'Confirmed',appointmentTime:'8 AM',address:'Fictional address',appointmentNotes:['Original note'],junkItems:['Chair'],routePosition:1,customerName:'Fictional Customer',phone:'',driver:'Fictional Driver',navigator:''};
let prior=projection([job],[]);
for(let n=0;n<240;n++){
 const next=projection([{...job,appointmentTime:n%2?'8:00 AM':'8 AM',appointmentNotes:[String(n)],driver:n%2?'Fictional Driver':'',address:n%2?'Normalized address':'Fictional address',routePosition:n%2?1:4}],[]);
 assert.equal(change(prior,next,'schedule').changed,false,'Repeated enrichment/notes/renumbering does not interrupt crews');prior=next;
}
assert.equal(change(projection([job],[]),projection([{...job,status:'Completed'}],[]),'schedule').changed,false);
assert.equal(change(projection([{...job,status:'Completed'}],[]),projection([],[]),'schedule').changed,false);
assert.equal(change(projection([],[]),projection([{...job,status:'Completed'}],[]),'schedule').changed,false);
assert.equal(change(null,projection([job],[]),'schedule').changed,false);
assert.equal(change(projection([job],[]),projection([{...job,appointmentTime:'8 AM – 9 AM'}],[]),'schedule').changed,false,'End-time enrichment is quiet');
assert.equal(change(projection([job],[]),projection([{...job,appointmentTime:''}],[]),'schedule').changed,false,'Unavailable time is not a verified move');
const timing=change(projection([job],[]),projection([{...job,appointmentTime:'10 AM'}],[]),'schedule');assert.equal(timing.counts.timing,1);assert.equal(timing.changes[0].before,'8 AM');assert.equal(timing.urgent,false);
assert.equal(change(projection([],[]),projection([job],[]),'schedule').counts.added,1);
assert.equal(change(projection([job],[]),projection([],[]),'schedule').counts.removed,1);
assert.equal(change(projection([{...job,status:'Completed'}],[]),projection([job],[]),'schedule').counts.schedule,1);
const second={...job,appointmentId:'2',routePosition:2};
assert.equal(change(projection([job,second],[]),projection([{...job,routePosition:2},{...second,routePosition:1}],[]),'schedule').counts.timing,2);
assert.equal(change(projection([job,second],[]),projection([{...job,routePosition:2},{...second,routePosition:3}],[]),'schedule').changed,false);
assert.equal(change(projection([],[]),projection([],[{id:'message'}]),'messages').urgent,true);
const message=waypointNotificationMessage('Truck 4',timing.counts,'12345678-1234-4234-8234-123456789012');assert.ok(message.body.includes('Appointment time or route order changed'));assert.ok(!JSON.stringify(message).includes('Fictional'));assert.equal(pushPath(message.path),message.path);
const key=createECDH('prime256v1');key.generateKeys();const subscription={endpoint:'https://web.push.apple.com/fictional',keys:{p256dh:key.getPublicKey().toString('base64url'),auth:randomBytes(16).toString('base64url')}};assert.ok(encryptPushMessage({subscription,message}).length>100);
assert.deepEqual(waypointJobChanges([{appointmentId:'https://invalid',kind:'added'}]),[]);
console.log('PASS: 240 noisy refreshes are silent; completed jobs, enrichment and unavailable times are quiet; real route/time/membership changes and office messages remain actionable; encrypted category context excludes customer details.');
