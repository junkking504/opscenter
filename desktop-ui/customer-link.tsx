import { desktopCustomerHref } from './lib/desktop-links';
export function CustomerLink({ id, name, busy = false }: { id?: string; name: string; busy?: boolean }) {
  const date = typeof window !== 'undefined' ? new URLSearchParams(window.location.search).get('date') || undefined : undefined;
  return !busy && id && /^\d{1,12}$/.test(id) ? <a className="customer-account-link" href={desktopCustomerHref(id, date)} title={`Open customer account for ${name}`}>{name}</a> : <>{name}</>;
}
