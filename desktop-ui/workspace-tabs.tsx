import { Children, cloneElement, isValidElement, type ButtonHTMLAttributes, type ReactNode } from 'react';

/** Shared page tabs with roving focus and automatic keyboard activation. */
export function WorkspaceTabs({ label, children }: { label: string; children: ReactNode }) {
  return <div className="workspace-tabs shared-workspace-tabs" role="tablist" aria-label={label} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tabs = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0 || !tabs.length) return;
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault(); tabs[next].focus(); tabs[next].click();
  }}>{Children.map(children, child => {
    if (!isValidElement<ButtonHTMLAttributes<HTMLButtonElement>>(child)) return child;
    const selected = child.props.className?.split(' ').includes('active') || false;
    return cloneElement(child, { role: 'tab', 'aria-selected': selected, tabIndex: selected ? 0 : -1 });
  })}</div>;
}
