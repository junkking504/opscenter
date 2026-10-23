import type { PushJournalHealth } from '../../lib/web-push-journal-health';
const names={ready:'Ready and quarantine',pending:'Pending and pending quarantine',uncertain:'Uncertain evidence'};
const mib=(bytes:number)=>(bytes/(1024*1024)).toFixed(2);
export function PushJournalStatus({health}:{health:PushJournalHealth|null}) {
  if(!health)return <p>Notification queue measurements are unknown.</p>;
  return <div aria-label="Notification queue status">
    <h4>Notification queue status</h4>
    <p>{health.retention.status==='observed'
      ?`Unscopable evidence at last retention scan: ${health.retention.unscopableRetained} files. Scan recorded ${new Date(health.retention.scannedAt!).toLocaleString()}. Current count may differ.`
      :'Unscopable evidence count is unknown; no readable retention scan is available.'}</p>
    <ul>{health.capacity.map(group=><li key={group.key}>{names[group.key]}: {group.status==='observed'
      ?`${group.files} files / ${group.limitFiles}; ${group.bytes!.toLocaleString()} bytes / ${mib(group.limitBytes)} MiB. Remaining admission headroom: ${group.remainingFiles} files and ${group.remainingBytes!.toLocaleString()} bytes.${group.remainingFiles===0||group.remainingBytes===0?' Admission limit reached.':''}`
      :'headroom unknown; measurement unavailable or changed during sampling.'}</li>)}</ul>
    <small>Sampled {new Date(health.sampledAt).toLocaleString()}. Refresh status for a new sample. Queue admission headroom is not disk space, CPU or database capacity. Concurrent writes may change these values. Runtime capacity remains unmeasured.</small>
  </div>;
}
