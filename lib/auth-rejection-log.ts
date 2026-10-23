// Process-local, anonymous diagnostics only. This never participates in authorization.
const REASONS = ['session_absent', 'session_malformed', 'session_signature_mismatch', 'session_payload_unreadable', 'session_identity_invalid', 'session_identity_retired', 'session_expired', 'session_issued_at_invalid', 'session_unknown'] as const;
const SUMMARY_MS = 5 * 60_000;
const IDLE_MS = 15 * 60_000;
const MAX_BUCKETS = 256;
type Input = { reason: string; pathname: string; method: string; headers: Pick<Headers, 'get'> };
type Fields = Record<string, string | number | null>;
type Bucket = { fields: Fields; first: number; last: number; reported: number; total: number; suppressed: number };

function category(input: Input): Fields {
  const ua = (input.headers.get('user-agent') || '').slice(0, 512);
  const path = input.pathname;
  const route = /^\/(api\/desktop\/)?(command)(\/|$)/.test(path) ? 'command'
    : /^\/(api\/(desktop\/)?|)(schedule|control|appointments|jobs)(\/|$)/.test(path) ? 'control'
    : /^\/(api\/(desktop\/)?|)(crew|crew-jobs|krewe|my-pay)(\/|$)/.test(path) ? 'crew'
    : /^\/(api\/(desktop\/)?|)(fleet|convoy)(\/|$)/.test(path) ? 'fleet'
    : /^\/(api\/(desktop\/)?|)(finance|accounting|capital)(\/|$)/.test(path) ? 'finance' : 'other';
  return {
    reason: REASONS.includes(input.reason as typeof REASONS[number]) ? input.reason : 'session_unknown',
    route, requestKind: path.startsWith('/api/') ? 'api' : 'page',
    method: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'].includes(input.method) ? input.method : 'other',
    browser: /Edg\//.test(ua) ? 'edge' : /Firefox\/|FxiOS\//.test(ua) ? 'firefox' : /Chrome\/|CriOS\//.test(ua) ? 'chrome' : /Version\/.*Safari\//.test(ua) ? 'safari' : 'unknown',
    os: /Android/.test(ua) ? 'android' : /iPhone|iPad|iPod/.test(ua) ? 'ios' : /Windows/.test(ua) ? 'windows' : /Macintosh|Mac OS X/.test(ua) ? 'macos' : /Linux/.test(ua) ? 'linux' : 'unknown',
    device: /Mobile|Android|iPhone|iPad|iPod/.test(ua) ? 'mobile' : /Windows|Macintosh|X11/.test(ua) ? 'desktop' : 'unknown',
  };
}

export function createAuthRejectionLogger(emit: (entry: Fields) => void, now = Date.now) {
  const buckets = new Map<string, Bucket>();
  // Fixed reason-only overflow preserves new reasons even at the bucket cap.
  const overflow = new Map<string, Bucket>();
  const write = (fields: Fields) => { try { emit(fields); } catch { /* Logging must not change rejection. */ } };
  function summary(bucket: Bucket, time: number) {
    if (bucket.suppressed) write({ ...bucket.fields, event: 'session_rejection_summary', at: new Date(time).toISOString(), firstAt: new Date(bucket.first).toISOString(), lastAt: new Date(bucket.last).toISOString(), total: bucket.total, suppressed: bucket.suppressed });
    bucket.total = 0; bucket.suppressed = 0; bucket.first = time; bucket.reported = time;
  }
  return {
    record(input: Input) {
      const time = now();
      // Request-driven flush avoids background timers in middleware. Idle summaries
      // flush on the next rejection; a process restart can lose pending counts.
      for (const map of [buckets, overflow]) for (const [key, bucket] of map) {
        if (time - bucket.last >= IDLE_MS) { summary(bucket, time); map.delete(key); }
        else if (time - bucket.reported >= SUMMARY_MS) summary(bucket, time);
      }
      let fields = category(input);
      let key = JSON.stringify(fields);
      let map = buckets;
      if (!map.has(key) && map.size >= MAX_BUCKETS) { map = overflow; key = String(fields.reason); fields = { reason: fields.reason, category: 'overflow' }; }
      let bucket = map.get(key);
      if (!bucket) {
        bucket = { fields, first: time, last: time, reported: time, total: 1, suppressed: 0 }; map.set(key, bucket);
        const ray = input.headers.get('cf-ray') || '';
        write({ ...fields, event: 'session_rejected', at: new Date(time).toISOString(), requestId: /^[a-f0-9]{16,32}-[A-Z]{3}$/.test(ray) ? ray : null, total: 1 });
      } else {
        if (!bucket.total) bucket.first = time;
        bucket.last = time; bucket.total++; bucket.suppressed++;
      }
    },
    size: () => ({ buckets: buckets.size, overflow: overflow.size }),
  };
}
