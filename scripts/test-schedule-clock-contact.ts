import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {scheduleCurrentTime} from '../desktop-ui/lib/schedule-current-time';
import {scheduleFactValue} from '../desktop-ui/lib/schedule-fact-value';

const range = {start: 420, duration: 600};
const current = (time: string, day = '2026-10-06', bounds = range) => scheduleCurrentTime(day, bounds, Date.parse(time));
assert.deepEqual(current('2026-10-06T17:18:00Z'), {progress: .53, label: '12:18 PM'});
assert.equal(current('2026-10-06T17:18:00Z', '2026-10-05'), null);
assert.equal(current('2026-10-06T17:18:00Z', '2026-10-07'), null);
assert.equal(current('2026-10-06T11:59:00Z'), null);
assert.equal(current('2026-10-06T22:01:00Z'), null);
assert.equal(current('2026-10-06T12:00:00Z')?.progress, 0);
assert.equal(current('2026-10-06T22:00:00Z')?.progress, 1);
assert.equal(current('2026-10-06T17:19:00Z')?.label, '12:19 PM');
assert.ok(current('2026-10-06T17:19:00Z')!.progress > current('2026-10-06T17:18:00Z')!.progress);
assert.equal(current('2026-10-06T17:18:00Z', '2026-10-06', {start: 780, duration: 120}), null);
assert.equal(current('2026-10-07T04:30:00Z', '2026-10-06', {start: 0, duration: 1440})?.label, '11:30 PM', 'UTC next day still belongs to the Chicago operating day');
assert.equal(current('2026-10-07T04:30:00Z', '2026-10-07', {start: 0, duration: 1440}), null);
assert.equal(current('2026-10-07T05:00:00Z', '2026-10-07', {start: 0, duration: 1440})?.label, '12:00 AM');
assert.equal(current('2026-01-06T18:18:00Z', '2026-01-06')?.label, '12:18 PM', 'Chicago winter offset');
assert.equal(current('2026-11-01T06:30:00Z', '2026-11-01', {start: 0, duration: 1440})?.label, '1:30 AM');
assert.equal(current('2026-11-01T07:30:00Z', '2026-11-01', {start: 0, duration: 1440})?.label, '1:30 AM', 'Chicago DST repeated hour');
assert.equal(scheduleCurrentTime('2026-10-06', range, NaN), null);
assert.equal(current('2026-10-06T17:18:00Z', '2026-10-06', {start: 420, duration: 0}), null);

const phone = createElement('a', {href: 'tel:+15550101001'}, '(555) 010-1001');
const address = createElement('a', {href: 'https://www.google.com/maps/search/?api=1&query=100%20Example%20St'}, '100 Example St');
for (const node of [phone, address]) {
  assert.equal(scheduleFactValue(node), node, 'React contact elements retain identity');
  const html = renderToStaticMarkup(createElement('strong', null, scheduleFactValue(node)));
  assert.match(html, /<a href=/);
  assert.doesNotMatch(html, /object Object/);
}
for (const empty of [null, undefined, '', false, true]) assert.equal(scheduleFactValue(empty), 'Unavailable');
assert.equal(scheduleFactValue(0), 0, 'Zero is a valid fact, not unavailable');
assert.equal(scheduleFactValue(4096056), 4096056);
assert.equal(scheduleFactValue('Truck 8'), 'Truck# 8');
assert.equal(scheduleFactValue('Confirmed'), 'Confirmed');
console.log('Schedule clock and fact rendering PASS: Chicago/DST/day/range boundaries, advancing time, React links, primitive and empty values.');
