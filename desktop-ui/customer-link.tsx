import { desktopCustomerHref } from './lib/desktop-links';
export function CustomerLink({ id, name, busy = false }: { id?: string; name: string; busy?: boolean }) {
  return !busy && id && /^\d{1,12}$/.test(id) ? <a className="customer-account-link" href={desktopCustomerHref(id)} title={`Open customer account for ${name}`}>{name}</a> : <>{name}</>;
}
