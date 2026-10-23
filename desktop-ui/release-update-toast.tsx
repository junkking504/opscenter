import { useEffect, useRef, useState } from 'react';

export const RELEASE_CHECK_MS = 60_000;
export function ReleaseUpdateToast({ busy = false }: { busy?: boolean }) {
  const baseline = useRef<string | null>(null);
  const dismissed = useRef<string | null>(null);
  const [ready,setReady] = useState<string | null>(null);
  useEffect(()=>{
    let disposed = false;
    let flight: AbortController | null = null;
    const check = async () => {
      if (disposed || flight || document.visibilityState === 'hidden') return;
      const controller = new AbortController(); flight = controller;
      try {
        // Static same-origin HEAD: no health aggregation, collectors or provider calls.
        const response = await fetch('/opscenter-wordmark.png?release-check=1',{method:'HEAD',cache:'no-store',credentials:'same-origin',signal:AbortSignal.any([controller.signal,AbortSignal.timeout(8_000)])});
        const release = response.headers.get('x-opscenter-release')?.trim();
        if (disposed || !response.ok || !release || !/^[a-f0-9]{40}$/i.test(release)) return;
        if (baseline.current == null) baseline.current = release;
        else if (release !== baseline.current && release !== dismissed.current) setReady(release);
        else if (release === baseline.current) setReady(null);
      } catch { /* Offline and header-less origins do not imply a new release. */ }
      finally { if(flight===controller) flight=null; }
    };
    const poll = () => { void check(); };
    poll(); const timer=window.setInterval(poll,RELEASE_CHECK_MS);
    document.addEventListener('visibilitychange',poll);
    window.addEventListener('online',poll);
    return()=>{disposed=true;flight?.abort();window.clearInterval(timer);document.removeEventListener('visibilitychange',poll);window.removeEventListener('online',poll);};
  },[]);
  if (!ready || busy) return null;
  return <aside className="release-update-toast" role="status" aria-live="polite" aria-label="Update ready"><p>OpsCenter was updated. Refresh when convenient.</p><div><button type="button" onClick={()=>{dismissed.current=ready;setReady(null);}}>Later</button><button type="button" onClick={()=>window.location.reload()}>Refresh now</button></div></aside>;
}
