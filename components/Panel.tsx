import type { ReactNode } from "react";

type PanelProps = {
  title: ReactNode;
  children: ReactNode;
  action?: ReactNode;
};

export function Panel({ title, children, action }: PanelProps) {
  return (
    <section className="rounded-lg border border-line bg-panel shadow-sm overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {action && <div className="text-sm">{action}</div>}
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}
