import assert from 'node:assert/strict';
import {etaMessage} from '../app/crew-jobs/eta-message';

assert.equal(etaMessage('Dana Whitfield',15),'Hi Dana, this is Junk King. Our crew is about 15 minutes away. See you soon!');
assert.equal(etaMessage('  ',10),'Hi there, this is Junk King. Our crew is about 10 minutes away. See you soon!');
const sms='sms:+15045550142';
assert.equal(`${sms}&body=${encodeURIComponent(etaMessage('Dana',20))}`,'sms:+15045550142&body=Hi%20Dana%2C%20this%20is%20Junk%20King.%20Our%20crew%20is%20about%2020%20minutes%20away.%20See%20you%20soon!');
console.log('PASS Waypoint ETA text: first-name greeting, fallback, sms draft href with encoded body.');
