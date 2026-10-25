import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from 'react';

export type DisplayedRefreshReader = (signal: AbortSignal) => Promise<void>;

/** Explicit mounted snapshot readers only. Registering never starts a read. */
export function createDisplayedRefreshRegistry(timeoutMs = 30_000) {
  type Reader = { callback: DisplayedRefreshReader; disabled: boolean; controller?: AbortController };
  const readers = new Map<string, Set<Reader>>();
  const flights = new Map<string, Promise<void>>();
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const available = (workspace: string) => {
    const mounted = readers.get(workspace);
    return Boolean(mounted?.size && [...mounted].every(reader => !reader.disabled));
  };
  const register = (workspace: string, callback: DisplayedRefreshReader, disabled = false) => {
    const reader: Reader = { callback, disabled };
    const mounted = readers.get(workspace) || new Set<Reader>();
    readers.set(workspace, mounted); mounted.add(reader); notify();
    return {
      update(next: DisplayedRefreshReader, blocked: boolean) {
        reader.callback = next;
        if (reader.disabled === blocked) return;
        reader.disabled = blocked;
        if (blocked) reader.controller?.abort(new Error('Refresh paused while editing or loading.'));
        notify();
      },
      unregister() {
        reader.controller?.abort(new Error('The displayed reader was closed.'));
        mounted.delete(reader);
        if (!mounted.size && readers.get(workspace) === mounted) readers.delete(workspace);
        notify();
      },
    };
  };
  const refresh = (workspace: string): Promise<void> => {
    // Also check here: a caller may retain the callback after navigation/editing.
    if (!available(workspace)) return Promise.reject(new Error('Displayed data cannot refresh while unavailable or busy.'));
    const existing = flights.get(workspace);
    if (existing) return existing;
    const mounted = [...readers.get(workspace)!];
    const task = Promise.allSettled(mounted.map(reader => {
      const controller = new AbortController(); reader.controller = controller;
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(timeoutMs)]);
      return new Promise<void>((resolve, reject) => {
        const aborted = () => reject(signal.reason);
        signal.addEventListener('abort', aborted, { once: true });
        // Deferral lets the whole batch reserve its flight before any callback runs.
        void Promise.resolve().then(() => { signal.throwIfAborted(); return reader.callback(signal); })
          .then(() => { signal.throwIfAborted(); resolve(); }, reject)
          .catch(reject)
          .finally(() => signal.removeEventListener('abort', aborted));
      }).finally(() => { if (reader.controller === controller) reader.controller = undefined; });
    })).then(results => {
      const failure = results.find(result => result.status === 'rejected');
      if (failure?.status === 'rejected') throw failure.reason;
    }).finally(() => { if (flights.get(workspace) === task) flights.delete(workspace); });
    flights.set(workspace, task);
    return task;
  };
  return { register, refresh, available, subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; } };
}

const displayedReaders = createDisplayedRefreshRegistry();

export function useRegisterDisplayedRefresh(workspace: string, callback: DisplayedRefreshReader, disabled = false, scope = '') {
  const latest = useRef({ callback, disabled }); latest.current = { callback, disabled };
  const registration = useRef<ReturnType<typeof displayedReaders.register> | null>(null);
  const read = useCallback(async (signal: AbortSignal) => {
    if (latest.current.disabled) throw new Error('Refresh paused while editing or loading.');
    await latest.current.callback(signal);
  }, []);
  useLayoutEffect(() => {
    const entry = displayedReaders.register(workspace, read, latest.current.disabled);
    registration.current = entry;
    return () => { entry.unregister(); if (registration.current === entry) registration.current = null; };
  }, [workspace, scope, read]);
  useLayoutEffect(() => { registration.current?.update(read, disabled); }, [read, disabled]);
}

/** Undefined until every explicitly registered reader in this workspace is ready. */
export function useDisplayedRefresh(workspace: string): (() => Promise<void>) | undefined {
  const getSnapshot = useCallback(() => displayedReaders.available(workspace), [workspace]);
  const available = useSyncExternalStore(displayedReaders.subscribe, getSnapshot, () => false);
  const refresh = useCallback(() => displayedReaders.refresh(workspace), [workspace]);
  return available ? refresh : undefined;
}
