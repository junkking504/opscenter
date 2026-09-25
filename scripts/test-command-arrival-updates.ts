import assert from 'node:assert/strict';
import fs from 'node:fs';
import {subscribeArrivalUpdates,subscribeCommandArrivalUpdates} from '../desktop-ui/lib/arrival-updates';

class FakeEventSource extends EventTarget {
  static instances:FakeEventSource[]=[];
  closed=false;
  constructor(readonly url:string){super();FakeEventSource.instances.push(this);}
  close(){this.closed=true;}
}
const previous=globalThis.EventSource;
globalThis.EventSource=FakeEventSource as unknown as typeof EventSource;
try {
  let day='2026-09-25',historical=0,current=0,future=0,schedule=0;
  const offHistorical=subscribeCommandArrivalUpdates('2026-09-24',()=>historical++,()=>day);
  const offCurrent=subscribeCommandArrivalUpdates('2026-09-25',()=>current++,()=>day);
  const offFuture=subscribeCommandArrivalUpdates('2026-09-26',()=>future++,()=>day);
  const offSchedule=subscribeArrivalUpdates(()=>schedule++);
  assert.equal(FakeEventSource.instances.length,1,'Consumers share one existing local stream');
  const stream=FakeEventSource.instances[0];
  assert.equal(stream.url,'/api/desktop/events');
  stream.dispatchEvent(new Event('open'));
  for(let i=0;i<20;i++)stream.dispatchEvent(new Event('change'));
  assert.equal(historical,0,'Historical Command must not rebuild on current GPS/photo events or stream open');
  assert.equal(current,21,'Current-day Command still receives every source hint');
  assert.equal(future,0,'Future dates retain normal polling instead of current-day hints');
  assert.equal(schedule,21,'Schedule delivery is unchanged');
  day='2026-09-26';
  stream.dispatchEvent(new Event('change'));
  assert.equal(current,21,'Pinned prior day stops receiving live hints at Central midnight');
  assert.equal(future,1,'A pinned future date receives hints when it becomes today');
  offHistorical();offCurrent();offFuture();
  assert.equal(stream.closed,false,'Command unmount cannot close Schedule stream');
  offSchedule();assert.equal(stream.closed,true);
  const before=future;
  stream.dispatchEvent(new Event('change'));
  assert.equal(future,before,'Unmounted Command cannot queue more refreshes');
  const source=fs.readFileSync('desktop-ui/live-command.tsx','utf8');
  assert(source.includes('subscribeCommandArrivalUpdates(date, load)'),'Live component uses date-aware event delivery');
  assert(source.includes('30_000'),'Existing periodic correction refresh remains');
  for(const event of ['focus','online','visibilitychange'])assert(source.includes(`addEventListener('${event}',load)`));
  assert(source.includes('await refresh();'),'Post-action source read-back remains');
  console.log('Command live-hint isolation passed: historical/future suppression, current-day updates, Central rollover, shared Schedule stream, cleanup and correction-refresh paths.');
}finally{globalThis.EventSource=previous;}
