/** Current-time position shared by the mobile and desktop schedule. */
export function scheduleCurrentTime(date: string, range: {start: number; duration: number}, timestamp: number) {
  if (!Number.isFinite(timestamp) || !Number.isFinite(range.start) || !Number.isFinite(range.duration) || range.duration <= 0) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  if (date !== `${values.year}-${values.month}-${values.day}`) return null;
  const hour = Number(values.hour), minute = Number(values.minute);
  const progress = (hour * 60 + minute - range.start) / range.duration;
  if (progress < 0 || progress > 1) return null;
  return {progress, label: `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`};
}
