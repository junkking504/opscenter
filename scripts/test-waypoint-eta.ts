import assert from 'node:assert/strict';
import {etaMessage} from '../app/crew-jobs/eta-message';
import {mapsDirections} from '../lib/waypoint-day-summary';

assert.equal(etaMessage('Dana Whitfield',15),'Hi Dana, this is Junk King. Our crew is about 15 minutes away. See you soon!');
assert.equal(etaMessage('  ',10),'Hi there, this is Junk King. Our crew is about 10 minutes away. See you soon!');
const sms='sms:+15045550142';
assert.equal(`${sms}&body=${encodeURIComponent(etaMessage('Dana',20))}`,'sms:+15045550142&body=Hi%20Dana%2C%20this%20is%20Junk%20King.%20Our%20crew%20is%20about%2020%20minutes%20away.%20See%20you%20soon!');
console.log('PASS Waypoint ETA text: first-name greeting, fallback, sms draft href with encoded body.');

const nav=new URL(mapsDirections('1520 Magazine St, New Orleans, LA 70130')!);
assert.equal(nav.origin+nav.pathname,'https://maps.apple.com/directions');
assert.equal(nav.searchParams.get('mode'),'driving');
assert.equal(nav.searchParams.get('destination'),'1520 Magazine St, New Orleans, LA 70130');
for(const missing of ['','—','Address unavailable','verification pending'])assert.equal(mapsDirections(missing),null);
console.log('PASS Waypoint Navigate: Apple Maps driving directions to the service address; none when the address is missing or pending.');
