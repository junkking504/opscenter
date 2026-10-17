import fs from 'node:fs';
import path from 'node:path';
import { KnowledgeError } from './knowledge-store';
import type { KnowledgeImport } from './knowledge-import';
import type { KnowledgeDraft, KnowledgeKind } from '../desktop-ui/lib/knowledge-contract';

// The Obsidian vault is where knowledge is written. Notes marked `opswiki: publish`
// are converted into the existing history-import manifest, so OpsWiki keeps its
// manager-only access, revision history and review state.
const folderKinds: Record<string, KnowledgeKind> = { Decisions: 'decision', Lessons: 'incident', Knowledge: 'procedure', Systems: 'procedure' };
const skipped = new Set(['Inbox', 'Templates', 'Tasks', '.obsidian', '.trash']);

type Frontmatter = Record<string, string | string[]>;
export function parseNote(text: string): { meta: Frontmatter; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { meta: {}, body: text.trim() };
  const meta: Frontmatter = {};
  let listKey = '';
  for (const line of match[1].split(/\r?\n/)) {
    const item = /^\s+-\s+(.*)$/.exec(line);
    if (item && listKey) { (meta[listKey] as string[]).push(unquote(item[1])); continue; }
    const pair = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (!pair) continue;
    const [, key] = pair;
    const raw = pair[2].replace(/\s+#.*$/, '');
    listKey = '';
    if (!raw) { meta[key] = []; listKey = key; }
    else if (raw.startsWith('[') && raw.endsWith(']')) meta[key] = raw.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else meta[key] = unquote(raw);
  }
  return { meta, body: text.slice(match[0].length).trim() };
}
const unquote = (value: string) => value.trim().replace(/^(['"])(.*)\1$/, '$2');
const text = (meta: Frontmatter, key: string) => typeof meta[key] === 'string' ? meta[key] as string : '';

function notes(root: string, dir = ''): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap(entry => {
    const relative = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) return dir === '' && skipped.has(entry.name) || entry.name.startsWith('.') ? [] : notes(root, relative);
    return entry.isFile() && entry.name.endsWith('.md') ? [relative] : [];
  });
}

export function vaultNoteDraft(relative: string, contents: string): KnowledgeDraft | null {
  const { meta, body } = parseNote(contents);
  if (text(meta, 'opswiki') !== 'publish') return null;
  const where = (message: string) => new KnowledgeError(`${relative}: ${message}`);
  const date = text(meta, 'date');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date))) throw where('add `date: YYYY-MM-DD` to the frontmatter.');
  const kind = (text(meta, 'kind') || folderKinds[relative.split('/')[0]] || 'procedure') as KnowledgeKind;
  const heading = /^#\s+(.+)$/m.exec(body)?.[1];
  const topics = meta.topics;
  return {
    title: text(meta, 'title') || heading || path.posix.basename(relative, '.md'),
    kind, workspace: (text(meta, 'workspace') || 'All') as KnowledgeDraft['workspace'],
    summary: text(meta, 'summary'), body: body.replace(/^#\s+.+\r?\n?/, '').trim(),
    owner: text(meta, 'owner') || 'Unassigned',
    sourceLabel: 'OpsCenter vault', sourceUrl: '', sourceNote: `vault/${relative}`,
    learning: {
      // An explicit id keeps one OpsWiki entry when a note is renamed or moved.
      sourceKey: `vault:${text(meta, 'id') || relative}`, recordedAt: `${date}T00:00:00Z`,
      outcome: (text(meta, 'outcome') || (kind === 'decision' ? 'context' : 'unknown')) as NonNullable<KnowledgeDraft['learning']>['outcome'],
      topics: Array.isArray(topics) ? topics : topics ? [topics] : [],
    },
  };
}

export function vaultKnowledgeManifest(vault: string): KnowledgeImport {
  const records = notes(vault).sort().flatMap(relative => {
    const draft = vaultNoteDraft(relative, fs.readFileSync(path.join(vault, relative), 'utf8'));
    return draft ? [draft] : [];
  });
  return { schema: 1, records };
}
