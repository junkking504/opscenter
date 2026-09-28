import { useCallback, useEffect, useState } from 'react';

/** Each notice gets four seconds, including consecutive identical messages. */
export function useTransientNotice() {
  const [notice, setNotice] = useState({ message: '' });
  const showNotice = useCallback((message: string) => setNotice({ message }), []);

  useEffect(() => {
    if (!notice.message) return;
    const timer = window.setTimeout(() => setNotice({ message: '' }), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return [notice.message, showNotice] as const;
}
