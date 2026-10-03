export type RouteLoadState<T> = { data: T | null; loading: boolean; error: boolean };

/** One in-flight read per selection. Snapshot changes queue a follow-up instead
 * of aborting useful work. Only changing selection/disposal cancels the read. */
export function createRouteLoader<T>(read: (signal: AbortSignal) => Promise<T>, publish: (state: RouteLoadState<T>) => void, visible = () => true) {
  const abort = new AbortController();
  let state: RouteLoadState<T> = { data: null, loading: false, error: false };
  let pending = false;
  let queued = false;
  const refresh = async () => {
    if (abort.signal.aborted || !visible()) return;
    if (pending) { queued = true; return; }
    pending = true;
    state = { ...state, loading: true, error: false };
    publish(state);
    try {
      const data = await read(abort.signal);
      if (!abort.signal.aborted) { state = { data, loading: false, error: false }; publish(state); }
    } catch {
      if (!abort.signal.aborted) { state = { ...state, loading: false, error: true }; publish(state); }
    } finally {
      pending = false;
      if (queued && !abort.signal.aborted) { queued = false; void refresh(); }
    }
  };
  return { refresh, dispose: () => abort.abort() };
}
