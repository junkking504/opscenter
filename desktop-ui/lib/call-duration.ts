export function callDurationLabel(value: string): string {
  const raw = String(value || '').trim();
  if (!raw) return 'Not recorded';
  const match = raw.match(/^(?:(\d+):)?(\d+):(\d{2})$/);
  if (!match) return raw;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (!Number.isSafeInteger(hours) || !Number.isSafeInteger(minutes) || !Number.isSafeInteger(seconds) || seconds > 59 || (hours > 0 && minutes > 59)) return raw;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hr`);
  if (minutes) parts.push(`${minutes} min`);
  if (seconds || parts.length === 0) parts.push(`${seconds} sec`);
  return parts.join(' ');
}
