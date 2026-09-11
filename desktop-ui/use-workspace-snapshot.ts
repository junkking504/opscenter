import { useCallback, useState } from 'react';
import { cachedWorkspace } from './lib/workspace-cache';

export function useWorkspaceSnapshot<T>(key: string) {
  const [state, setState] = useState<{ key: string; value: T | null }>(() => ({ key, value: cachedWorkspace<T>(key)?.value ?? null }));
  // A changed date/view must never render the previous key's records.
  const value = state.key === key ? state.value : cachedWorkspace<T>(key)?.value || null;
  const accept = useCallback((value: T | null) => setState({ key, value }), [key]);
  return [value, accept] as const;
}
