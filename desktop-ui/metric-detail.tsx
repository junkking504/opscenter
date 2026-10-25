/** Compact known provenance clauses without concealing data-quality warnings. */
export function compactMetricDetail(detail: string): string {
  return detail.split(' · ').filter(part =>
    !/^(?:Source|Snapshot) [A-Z][a-z]{2} \d/.test(part)
    && !/^\d+(?:h \d+)?m old$|^\d+h \d+m old$/.test(part)
    && !/^Last recorded /.test(part)
    && !['Recorded payroll', 'Recorded daily expenses', 'After all recorded daily costs'].includes(part)
  ).join(' · ').replace(/^revenue ratio unavailable/, 'Revenue ratio unavailable')
    .replace('Fuel from posted WEX transactions', 'Posted WEX fuel');
}

export function MetricDetail({detail}: {detail: string}) {
  const compact = compactMetricDetail(detail);
  return <small title={detail} aria-label={detail}>{compact || <span className="sr-only">{detail}</span>}</small>;
}
