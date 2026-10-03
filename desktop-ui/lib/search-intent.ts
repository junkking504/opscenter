/** Enter defaults to the assistant, without a vocabulary of question phrases.
 * Exact workspace/record matches retain launcher shortcuts. */
export function searchSubmission(query: string, assistantAllowed: boolean, commandMatches: string[], records: Array<{title:string}>): 'assistant'|'record'|'command'|'none' {
  const text = query.trim().toLowerCase();
  if (text.length < 2) return 'none';
  if (commandMatches.some(label => label.toLowerCase() === text)) return 'command';
  if (records.some(row => row.title.toLowerCase() === text || (/^jk\d+$/.test(text) && new RegExp(`\\b${text}\\b`, 'i').test(row.title)))) return 'record';
  if (assistantAllowed) return 'assistant';
  return records.length ? 'record' : commandMatches.length ? 'command' : 'none';
}
