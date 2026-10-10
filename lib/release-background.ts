import { randomUUID } from 'node:crypto';

type State = { instance: string; pending: number; stopping: boolean; streams: Set<() => void> };
const key = Symbol.for('opscenter.release-background.v1');
const shared = globalThis as typeof globalThis & { [key]?: State };
const state = shared[key] ??= { instance: randomUUID(), pending: 0, stopping: false, streams: new Set() };

// Shared across route bundles in this process; no request, person or job data.
export function releaseBackground() {
  return { instance: state.instance, pending: state.pending, stopping: state.stopping };
}

export function registerBackground(register: (callback: () => Promise<void>) => void, callback: () => unknown) {
  state.pending++;
  let completed = false;
  const finish = () => { if (!completed) { completed = true; state.pending--; } };
  try {
    register(async () => { try { await callback(); } finally { finish(); } });
  } catch (error) { finish(); throw error; }
}

export function closeReadOnlyStreamsOnStop(close: () => void) {
  if (state.stopping) { close(); return () => {}; }
  state.streams.add(close);
  return () => { state.streams.delete(close); };
}

export function beginReleaseStop() {
  state.stopping = true;
  for (const close of [...state.streams]) close();
}

// Next's own SIGTERM handler stops accepting requests and awaits after().
// End only our known read-only EventSource streams so they can reconnect.
const signalKey = Symbol.for('opscenter.release-stop-listener.v1');
const signals = globalThis as typeof globalThis & { [signalKey]?: boolean };
if (!signals[signalKey]) {
  signals[signalKey] = true;
  process.on('SIGTERM', beginReleaseStop);
  process.on('SIGINT', beginReleaseStop);
}
