import { MetricDetail } from './metric-detail';
import { MetricValue } from './metric-value';
import { DeltaChip, type MetricComparison } from './delta-chip';
import { metricNumber } from './command-revenue-hero';
import type { ReactNode } from 'react';
import { ArrowUpRight, type LucideIcon } from 'lucide-react';

export function CapitalPageHeader({ eyebrow, title, description, action }: { eyebrow: string; title: string; description?: string; action?: ReactNode }) {
  return <header className="capital-page-header"><div><span className="capital-eyebrow">{eyebrow}</span><h2>{title}</h2>{description && <p>{description}</p>}</div>{action && <div className="capital-page-actions">{action}</div>}</header>;
}
export function CapitalStat({ label, value, detail, icon: Icon, primary, warning, onClick, comparison, lowerIsBetter }: { label: string; value: ReactNode; detail: ReactNode; icon: LucideIcon; primary?: boolean; warning?: boolean; onClick?: () => void; comparison?: MetricComparison; lowerIsBetter?: boolean }) {
  const Tag = onClick ? 'button' : 'article';
  return <Tag onClick={onClick} className={`capital-stat${onClick ? ' capital-stat-action' : ''}${primary ? ' capital-stat-primary' : ''}${warning ? ' capital-stat-warning' : ''}`}><span><Icon size={16}/>{label}</span><DeltaChip current={typeof value === 'number' ? value : typeof value === 'string' ? metricNumber(value) : null} comparison={comparison} lowerIsBetter={lowerIsBetter} /><strong><MetricValue value={value} /></strong>{typeof detail === 'string' ? <MetricDetail detail={detail} /> : <small>{detail}</small>}</Tag>;
}
export function CapitalEmpty({ icon: Icon, title, description, action }: { icon: LucideIcon; title: string; description: string; action?: ReactNode }) {
  return <div className="capital-empty"><span className="capital-empty-icon"><Icon size={24}/></span><h3>{title}</h3><p>{description}</p>{action}</div>;
}
export function CapitalSourceLink({ href, children }: { href: string; children: ReactNode }) {
  return <a className="capital-button" href={href} target="_blank" rel="noreferrer">{children}<ArrowUpRight size={14}/></a>;
}
