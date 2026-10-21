import { useEffect, useState } from 'react';
import { desktopAppointmentHref, desktopCustomerHref } from './lib/desktop-links';
import type { CustomerAccount, CustomerDirectory } from './lib/customer-history-contract';
import './customers.css';

const dateLabel = (value: string) => new Date(`${value}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
const phoneLabel = (value: string) => value.length === 10 ? `(${value.slice(0,3)}) ${value.slice(3,6)}-${value.slice(6)}` : value;
const initialCustomer = () => new URLSearchParams(window.location.search).get('customer') || '';
export default function Customers() {
  const [id, setId] = useState(initialCustomer);
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [retry, setRetry] = useState(0);
  const [result, setResult] = useState<{key: string; data?: CustomerAccount | CustomerDirectory; error?: string} | null>(null);
  const key = `${id}|${search}|${offset}|${retry}`;
  useEffect(() => { const timer = setTimeout(() => { setSearch(query.trim()); setOffset(0); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { const change = () => { setId(initialCustomer()); setOffset(0); }; window.addEventListener('popstate', change); return () => window.removeEventListener('popstate', change); }, []);
  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ offset: String(offset) });
    if (id) params.set('customer', id); else if (search) params.set('q', search);
    fetch(`/api/desktop/customers?${params}`, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.coverage || (id ? !Array.isArray(data.records) : !Array.isArray(data.customers))) throw new Error(data?.error || 'Customer information is unavailable.');
      if (!controller.signal.aborted) setResult({key, data});
    }).catch(error => { if (!controller.signal.aborted) setResult({key, error: error instanceof Error ? error.message : 'Customer information is unavailable.'}); });
    return () => controller.abort();
  }, [id, search, offset, retry, key]);
  const current = result?.key === key ? result : null;
  const account = current?.data && 'customer' in current.data ? current.data as CustomerAccount : null;
  const directory = current?.data && 'customers' in current.data ? current.data as CustomerDirectory : null;
  const go = (customer: string) => { window.history.pushState(null, '', desktopCustomerHref(customer)); setId(customer); setOffset(0); setQuery(''); setSearch(''); };
  const data = current?.data;
  const count = account?.records.length ?? directory?.customers.length ?? 0;
  return <section className="control-customers" aria-label={id ? 'Customer account' : 'Customers'}>
    <header className="customers-heading"><div><h2>{account ? account.customer.name : id ? 'Customer account' : 'Customers'}</h2><p>{id ? 'Contact information and appointment history' : 'Find a customer by name, phone, email, address, or appointment number.'}</p></div>{id && <a href={desktopCustomerHref()} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); go(''); }}>← All customers</a>}</header>
    {!id && <label className="customers-search"><span>Search customers</span><input type="search" value={query} maxLength={120} onChange={event => setQuery(event.target.value)} placeholder="Name, phone, email, address, or JK number" /></label>}
    {!current ? <p role="status">Loading saved customer information…</p> : current.error ? <p role="alert">{current.error} <button onClick={() => setRetry(n => n+1)}>Try again</button></p> : <>
      {account && <>
        <div className="customer-profile"><section><h3>Contact</h3>{account.phones.map(phone => <a key={phone} href={`tel:+1${phone}`}>{phoneLabel(phone)}</a>)}{account.emails.map(email => <a key={email} href={`mailto:${email}`}>{email}</a>)}{!account.phones.length && !account.emails.length && <p>Contact information not recorded</p>}</section><section><h3>Service addresses</h3>{account.addresses.map(address => <p key={address}>{address}</p>)}{!account.addresses.length && <p>Address not recorded</p>}</section><section><h3>Appointments</h3><strong>{account.total}</strong><p>Across available saved history</p></section></div>
        <p className="customers-source-note">Grouped by matching customer name and phone or email, plus explicitly linked estimates and jobs. Source accounts have not been merged. Amounts are recorded in JunkWare; billed does not mean collected.</p>
        <div className="customers-table-scroll"><table className="customer-appointments"><caption>All appointments · {account.total}</caption><thead><tr><th>Appointment</th><th>Work &amp; location</th><th>Volume &amp; prices</th><th>Amounts &amp; payment status</th></tr></thead><tbody>{account.records.map(row => <tr key={row.id}>
          <td><time dateTime={row.date}>{dateLabel(row.date)}</time><a href={desktopAppointmentHref(row.jk,row.date,row.id)}>{row.jk || row.id} →</a><span>{row.type || 'Appointment'} · {row.status || 'Status unavailable'}</span>{row.truck && <span>{row.truck}</span>}{row.relationship !== 'contact' && <small>Linked {row.relationship}</small>}</td>
          <td><strong>{row.customer}</strong><span>{row.address || 'Address not recorded'}</span><span>{row.work || 'Work not recorded'}</span></td>
          <td>{row.volumes.length ? row.volumes.map((value,i) => <strong key={i}>{value}</strong>) : <span>Volume not recorded</span>}{row.prices.map((value,i) => <span key={i}>{value}</span>)}{!row.prices.length && <small>Price breakdown not recorded</small>}</td>
          <td>{row.amounts.length ? row.amounts.map((value,i) => <span key={i}>{value}</span>) : <span>Payment details unavailable</span>}<small>{row.observedAt ? `Saved ${new Date(row.observedAt).toLocaleDateString('en-US')}` : 'Saved time unavailable'}</small></td>
        </tr>)}</tbody></table></div>
      </>}
      {directory && <div className="customers-table-scroll"><table className="customer-directory"><caption>{directory.total} {search ? 'matching ' : ''}customers</caption><thead><tr><th>Customer</th><th>Contact</th><th>Latest service address</th><th>Appointments</th><th>Latest appointment</th></tr></thead><tbody>{directory.customers.map(customer => <tr key={customer.id}><td><a href={desktopCustomerHref(customer.id)} onClick={event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); go(customer.id); }}>{customer.name} →</a></td><td><span>{phoneLabel(customer.phone) || 'Phone not recorded'}</span><span>{customer.email}</span></td><td>{customer.address || 'Address not recorded'}</td><td>{customer.appointments}</td><td>{dateLabel(customer.latestDate)}</td></tr>)}</tbody></table>{!directory.customers.length && <p>No customers match this search.</p>}</div>}
      {data && <><nav className="customers-pagination" aria-label="Customer results pages"><span>{data.total ? `${offset+1}–${Math.min(offset+count,data.total)} of ${data.total}` : '0 results'}</span><button disabled={offset === 0} onClick={() => setOffset(n=>Math.max(0,n-50))}>Previous</button><button disabled={offset+count >= data.total} onClick={() => setOffset(n=>n+50)}>Next</button></nav><p className="customers-source-note">Saved history: {dateLabel(data.coverage.from)}–{dateLabel(data.coverage.through)}. {data.coverage.unreadable > 0 ? `${data.coverage.unreadable} archives unavailable; history is incomplete.` : 'Newer saved schedule updates are included when available.'} Missing volume or payment detail means it was not captured in the saved record.</p></>}
    </>}
  </section>;
}
