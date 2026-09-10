import type { EstimateRow } from './lib/estimate-contract';
const money = (value: number | null) => value === null ? 'Not recorded' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

export default function EstimateCharges({ row }: { row: EstimateRow }) {
  const charges = row.charges;
  return <section className="estimate-charges" aria-label="Itemized estimate charges"><h4>Itemized charges</h4>
    {charges?.items.length ? <table><thead><tr><th scope="col">Charge</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Amount</th></tr></thead><tbody>
      {charges.items.map((item, index) => <tr key={index}><th scope="row">{item.name}</th><td>{item.quantity || '—'}</td><td>{item.unitPrice === null ? '—' : money(item.unitPrice)}</td><td>{money(item.total)}</td></tr>)}
      {charges.discount !== null && <tr><th scope="row">Discount</th><td /><td /><td>{money(-Math.abs(charges.discount))}</td></tr>}
      {charges.tip !== null && <tr><th scope="row">Tip</th><td /><td /><td>{money(charges.tip)}</td></tr>}
    </tbody><tfoot><tr><th scope="row" colSpan={3}>Quoted total</th><td>{money(row.quote)}</td></tr></tfoot></table> : <p>Itemized charges are unavailable in this saved estimate. The quoted total alone does not provide a breakdown.</p>}
    {Boolean(charges?.items.length) && <small>Saved estimate charges from JunkWare. Amounts are line totals; — means no quantity or unit price was recorded.</small>}
  </section>;
}
