import assert from 'node:assert/strict';
import { JUNKWARE_DISPATCH_TRUCKS, sameTruck, truckDisplayLabel, truckDisplayText } from '../lib/junkware-trucks';
import { formatSlackMessage } from '../lib/slack-message-format';
import { truckSlackChannelId } from '../lib/slack-truck-channels';
for (let number=1;number<=9;number++) {
  const key=`Truck ${number}`, label=`Truck# ${number}`;
  for(const alias of [key,label,`Truck #${number}`,`truck # ${number}`,`T${number}`,`${number}`]) {
    assert.equal(sameTruck(key,alias),true);
    assert.equal(truckDisplayLabel(alias),label);
    assert.equal(sameTruck(alias,`Truck ${number+1}`),false);
  }
  assert.equal(JUNKWARE_DISPATCH_TRUCKS[number-1],key,'Existing persistence and phone identities stay stable');
  assert.equal(truckSlackChannelId(key,'fallback'),truckSlackChannelId(label,'fallback'));
}
for (const bad of ['',null,'Unassigned','Truck 0','Truck 1 / Truck 2','Truck 1 retired','Truck -1','Pickup 1']) {
  assert.equal(sameTruck(bad,bad),false,'Unknown identities never grant access');
  assert.equal(sameTruck('Truck 1',bad),false);
}
assert.equal(truckDisplayText('Truck 1 → Truck #2 · Truck# 3'),'Truck# 1 → Truck# 2 · Truck# 3');
assert.equal(truckDisplayText('Truck-1 #truck-1 https://example.invalid/Truck1?id=1'),'Truck-1 #truck-1 https://example.invalid/Truck1?id=1');
assert.equal(truckDisplayText('Truck 1A / Truck 1000 / Truck 0'),'Truck 1A / Truck 1000 / Truck 0');
const message=formatSlackMessage({icon:':truck:',title:'Truck 1 Arrival',fields:[{label:'Truck',value:'Truck #1',href:'https://example.invalid/?truck=Truck%201'}],body:'Truck 1 on site',nextAction:'Review Truck 1'});
assert.ok(message.includes('Truck# 1 Arrival'));
assert.ok(message.includes('<https://example.invalid/?truck=Truck%201|Truck# 1>'));
assert.ok(message.includes('Truck# 1 on site'));
console.log('PASS: nine trucks, source aliases, rejected ambiguous identity, stable Slack routing/links.');
