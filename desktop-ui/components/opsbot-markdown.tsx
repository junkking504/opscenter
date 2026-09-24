import type { ReactNode } from 'react';

function inlineMarkdown(value: string): ReactNode[] {
  const pieces = value.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^\s)]+\))/g).filter(Boolean);
  return pieces.map((piece, index) => {
    if (/^\*\*[^*]+\*\*$/.test(piece)) return <strong key={index}>{piece.slice(2, -2)}</strong>;
    if (/^`[^`]+`$/.test(piece)) return <code key={index}>{piece.slice(1, -1)}</code>;
    const link = piece.match(/^\[([^\]]+)\]\(([^\s)]+)\)$/);
    if (link && /^(https?:\/\/|\/)/i.test(link[2])) return <a key={index} href={link[2]} target={link[2].startsWith('http') ? '_blank' : undefined} rel={link[2].startsWith('http') ? 'noreferrer' : undefined}>{link[1]}</a>;
    return <span key={index}>{piece}</span>;
  });
}

export default function OpsBotMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let paragraph: string[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flushParagraph = () => { if (paragraph.length) { blocks.push(<p key={`p-${blocks.length}`}>{inlineMarkdown(paragraph.join(' '))}</p>); paragraph = []; } };
  const flushList = () => { if (!list) return; const Tag = list.ordered ? 'ol' : 'ul'; blocks.push(<Tag key={`l-${blocks.length}`}>{list.items.map((item, index) => <li key={index}>{inlineMarkdown(item)}</li>)}</Tag>); list = null; };
  lines.forEach(line => {
    if (!line.trim()) { flushParagraph(); flushList(); return; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) { flushParagraph(); flushList(); const Tag = heading[1].length <= 2 ? 'h3' : 'h4'; blocks.push(<Tag key={`h-${blocks.length}`}>{inlineMarkdown(heading[2])}</Tag>); return; }
    const item = line.match(/^\s*(?:([-*+])|(\d+\.))\s+(.+)$/);
    if (item) { flushParagraph(); const ordered = Boolean(item[2]); if (!list || list.ordered !== ordered) { flushList(); list = { ordered, items: [] }; } list.items.push(item[3]); return; }
    flushList(); paragraph.push(line.trim());
  });
  flushParagraph(); flushList();
  return <div className="opsbot-answer-markdown">{blocks}</div>;
}
