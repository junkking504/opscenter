import { knowledgeStatus, type KnowledgeEntry } from './knowledge-contract';

export type KnowledgeAnswer = {
  entryId: string;
  title: string;
  answer: string;
  detail: string;
  sourceLabel: string;
  sourceNote: string;
  sourceUrl: string;
  workspace: string;
  status: string;
  outcome: NonNullable<KnowledgeEntry['learning']>['outcome'] | null;
  recordedAt: string | null;
  related: Array<{ id: string; title: string; summary: string }>;
  confidence: 'strong' | 'possible';
};

const STOP_WORDS = new Set([
  'a','about','an','and','are','as','at','be','been','being','by','can','could','did','do','does','for','from','had','has','have',
  'i','if','in','into','is','it','its','me','my','of','on','or','our','should','so','that','the','their','them','there','this','to',
  'was','we','were','what','when','where','which','who','will','with','would','you','your','opscenter','please','tell','explain',
]);

const SYNONYMS: Record<string, string[]> = {
  appointment: ['job','booking','schedule'], appointments: ['job','booking','schedule'], job: ['appointment','booking'],
  truck: ['fleet','convoy','vehicle'], vehicle: ['truck','fleet','convoy'], crew: ['krewe','waypoint'], krewe: ['crew'],
  location: ['gps','linxup','address'], gps: ['location','linxup','route'], route: ['trip','map','gps'], trip: ['route','gps'],
  photo: ['photos','image','images'], photos: ['photo','image','images'], picture: ['photo','image'],
  alert: ['notification','slack'], alerts: ['notification','slack'], notification: ['alert','slack'],
  dump: ['unload','disposal','landfill'], unload: ['dump','disposal','landfill'], fuel: ['gas','wex'], gas: ['fuel','wex'],
  payment: ['finance','qbo','charge'], payroll: ['pay','krewe'], repair: ['maintenance','fleet'], maintenance: ['repair','fleet'],
  slow: ['latency','performance','timeout'], failed: ['failure','error'], missing: ['absent','unavailable'],
  move: ['reschedule','reassign'], moved: ['move','reschedule','reassign'], cancel: ['cancellation','cancelled','canceled'],
  phone: ['mobile','waypoint'], closeout: ['checkout','complete'], knowledge: ['brain','history'], brain: ['knowledge','history'],
};

const SECTION_LABELS = ['Source', 'Symptom', 'Cause', 'Action', 'Evidence', 'Remaining work', 'Prevention'];

function normalize(value: string): string {
  return value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function stem(value: string): string {
  if (value.length > 6 && value.endsWith('ing')) return value.slice(0, -3);
  if (value.length > 5 && value.endsWith('ied')) return `${value.slice(0, -3)}y`;
  if (value.length > 5 && value.endsWith('ed')) return value.slice(0, -2);
  if (value.length > 5 && value.endsWith('es')) return value.slice(0, -2);
  if (value.length > 4 && value.endsWith('s')) return value.slice(0, -1);
  return value;
}

function terms(value: string): string[] {
  const values = normalize(value).split(/\s+/).filter(token => token.length > 1 && !STOP_WORDS.has(token));
  return [...new Set(values.flatMap(token => [token, stem(token), ...(SYNONYMS[token] || [])].map(stem)))];
}

function tokenSet(value: string): Set<string> { return new Set(terms(value)); }
function overlap(query: string[], values: Set<string>): number { return query.filter(term => values.has(term)).length; }

function score(entry: KnowledgeEntry, query: string, queryTerms: string[]) {
  const title = tokenSet(entry.title), summary = tokenSet(entry.summary), topics = tokenSet((entry.learning?.topics || []).join(' '));
  const body = tokenSet(entry.body), metadata = tokenSet(`${entry.workspace} ${entry.kind} ${entry.owner} ${entry.sourceLabel} ${entry.sourceNote}`);
  const matched = new Set(queryTerms.filter(term => title.has(term) || summary.has(term) || topics.has(term) || body.has(term) || metadata.has(term)));
  const normalizedQuery = normalize(query);
  let value = overlap(queryTerms, title) * 12 + overlap(queryTerms, topics) * 11 + overlap(queryTerms, summary) * 8
    + overlap(queryTerms, body) * 3 + overlap(queryTerms, metadata) * 2;
  if (normalizedQuery.length > 4 && normalize(`${entry.title} ${entry.summary}`).includes(normalizedQuery)) value += 30;
  if (entry.status === 'verified' || entry.status === 'documented') value += 2;
  if (entry.learning?.outcome === 'fixed') value += 2;
  return { value, coverage: queryTerms.length ? matched.size / queryTerms.length : 0 };
}

function requestedSection(query: string): string | null {
  const value = normalize(query);
  if (/\bwhy\b|\bcause\b|\breason\b/.test(value)) return 'Cause';
  if (/\bevidence\b|\bverify\b|\bverified\b|\bproof\b/.test(value)) return 'Evidence';
  if (/\bremaining\b|\bnext\b|\bstill\b|\bpending\b|\bleft\b/.test(value)) return 'Remaining work';
  if (/\bprevent\b|\bavoid\b|\bstop\b.*\bagain\b/.test(value)) return 'Prevention';
  if (/\bsymptom\b|\bproblem\b|\bhappen/.test(value)) return 'Symptom';
  if (/\bhow\b|\bfix\b|\bresolve\b|\baction\b|\bprocedure\b/.test(value)) return 'Action';
  return null;
}

function section(body: string, label: string): string {
  const escaped = SECTION_LABELS.map(value => value.replace(' ', '\\s+')).join('|');
  const match = body.match(new RegExp(`${label.replace(' ', '\\s+')}:\\s*([\\s\\S]*?)(?=\\s+(?:${escaped}):|$)`, 'i'));
  return match?.[1]?.trim() || '';
}

function clip(value: string, max = 520): string {
  if (value.length <= max) return value;
  const clipped = value.slice(0, max);
  const sentence = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('; '));
  return `${clipped.slice(0, sentence > max * .55 ? sentence + 1 : max).trim()}…`;
}

function answerDetail(entry: KnowledgeEntry, query: string, queryTerms: string[]): string {
  const wanted = requestedSection(query);
  const direct = wanted ? section(entry.body, wanted) : '';
  if (direct) return `${wanted}: ${clip(direct)}`;
  const sentences = entry.body.split(/(?<=[.!?])\s+/).map(value => value.trim()).filter(Boolean);
  const ranked = sentences.map((value, index) => ({ value, index, matches: overlap(queryTerms, tokenSet(value)) }))
    .sort((a, b) => b.matches - a.matches || a.index - b.index);
  const best = ranked[0]?.matches ? ranked[0].value : sentences[0] || '';
  return clip(best === entry.summary ? '' : best);
}

export function answerKnowledgeQuestion(entries: KnowledgeEntry[], query: string, now: number): KnowledgeAnswer | null {
  const queryTerms = terms(query);
  if (!query.trim() || !queryTerms.length) return null;
  const ranked = entries.filter(entry => entry.status !== 'archived').map(entry => ({ entry, ...score(entry, query, queryTerms) }))
    .filter(row => row.value >= 8 && (row.coverage >= .34 || row.value >= 28))
    .sort((a, b) => b.value - a.value || b.coverage - a.coverage || (b.entry.learning?.recordedAt || b.entry.updatedAt).localeCompare(a.entry.learning?.recordedAt || a.entry.updatedAt));
  const best = ranked[0];
  if (!best) return null;
  return {
    entryId: best.entry.id,
    title: best.entry.title,
    answer: best.entry.summary,
    detail: answerDetail(best.entry, query, queryTerms),
    sourceLabel: best.entry.sourceLabel,
    sourceNote: best.entry.sourceNote,
    sourceUrl: best.entry.sourceUrl,
    workspace: best.entry.workspace,
    status: knowledgeStatus(best.entry, now),
    outcome: best.entry.learning?.outcome || null,
    recordedAt: best.entry.learning?.recordedAt || null,
    related: ranked.slice(1, 4).map(row => ({ id: row.entry.id, title: row.entry.title, summary: row.entry.summary })),
    confidence: best.coverage >= .66 || best.value >= 45 ? 'strong' : 'possible',
  };
}
