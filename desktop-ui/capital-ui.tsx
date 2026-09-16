import type { ReactNode } from 'react';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';

export function CapitalPageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <header className="capital-page-header"><div><span className="capital-eyebrow">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{action && <div className="capital-page-actions">{action}</div>}</header>;
}
export function CapitalStat({ label, value, detail, icon: Icon, primary, warning }: { label: string; value: ReactNode; detail: ReactNode; icon: LucideIcon; primary?: boolean; warning?: boolean }) {
  return <article className={`capital-stat${primary ? ' capital-stat-primary' : ''}${warning ? ' capital-stat-warning' : ''}`}><span><Icon size={16}/>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}
export function CapitalEmpty({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="capital-empty"><span className="capital-empty-icon"><Icon size={24}/></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function CapitalSourceLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="capital-button" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14}/></a>;
}
