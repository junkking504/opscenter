import { currentOperatingDay } from './operating-day';

const listeners = new Set<() => void>();
let events: EventSource | undefined;
let stopVisibility = () => {};

/** Share one incoming source-change stream between Command and Schedule. */
export function subscribeArrivalUpdates(listener: () => void) {
  listeners.add(listener);
  if (!events) {
    events = new EventSource('/api/desktop/events');
    const notify = () => {
      if (document.visibilityState === 'hidden') return;
      for (const callback of listeners) callback();
    };
    events.addEventListener('change', notify);
    events.addEventListener('open', notify);
    // Hidden tabs need one current read on return, not a backlog of GPS reads.
    document.addEventListener('visibilitychange', notify);
    stopVisibility = () => document.removeEventListener('visibilitychange', notify);
  }
  return () => { listeners.delete(listener); if (!listeners.size) { events?.close(); events = undefined; stopVisibility(); } };
}

/** Command retains its normal polling for historical corrections. */
export function subscribeCommandArrivalUpdates(date: string, listener: () => void, today = currentOperatingDay) {
  // Check on delivery, not subscription: pinned dates can cross Central midnight.
  return subscribeArrivalUpdates(() => { if (date === today()) listener(); });
}
