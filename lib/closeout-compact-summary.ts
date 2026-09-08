import { money } from './money';

type AnyRecord = Record<string, unknown>;

export type CloseoutCompactSummary = {
  customer: string;
  driver: string;
  navigator: string;
  load?: string;
  labor?: string;
  misc?: string;
  total?: string;
  payment?: string;
};

function firstText(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = String(row?.[key] ?? '').replace(/\s+/g, ' ').trim();
    if (value) return value;
  }
  return '';
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/[$,%\s,]/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(row: AnyRecord, keys: string[]): number | null {
  for (const key of keys) {
    const parsed = finite(row?.[key]);
    if (parsed !== null) return parsed;
  }
  return null;
}

function pricedLoad(closeout: AnyRecord): string | undefined {
  const primaryPrice = firstNumber(closeout, ['loadPrice', 'load_price']) || 0;
  const bedloadPrice = firstNumber(closeout, ['bedloadPrice', 'bedload_price']) || 0;
  const total = primaryPrice + bedloadPrice;
  if (total <= 0) return undefined;

  const descriptions: string[] = [];
  for (const [sizeKeys, quantityKeys, label] of [
    [['loadSize', 'load_size'], ['loadQuantity', 'load_quantity'], ''],
    [['bedloadSize', 'bedload_size'], ['bedloadQuantity', 'bedload_quantity'], 'Bedload'],
  ] as const) {
    const rawSize = firstText(closeout, [...sizeKeys]);
    const size = rawSize.match(/\(([^)]+)\)/)?.[1]?.trim() || rawSize.replace(/^\d+(?:\.\d+)?\s+/, '').trim();
    const quantity = firstNumber(closeout, [...quantityKeys]) || 0;
    if (!size && quantity <= 0) continue;
    const description = `${quantity > 1 ? `${quantity} × ` : ''}${size || 'Size unavailable'}`;
    descriptions.push(label ? `${label} ${description}` : description);
  }
  return `${money(total)}${descriptions.length ? ` (${descriptions.join(' + ')})` : ''}`;
}

function paymentSummary(closeout: AnyRecord): string | undefined {
  const payments = (Array.isArray(closeout.payments) ? closeout.payments : [])
    .filter((payment): payment is AnyRecord => Boolean(payment) && typeof payment === 'object')
    .map(payment => ({
      method: firstText(payment, ['method', 'payment_method', 'paymentMethod']),
      detail: firstText(payment, ['detail', 'payment_detail', 'paymentDetail']),
      amount: firstNumber(payment, ['amount', 'payment_amount', 'paymentAmount']),
    }))
    .filter(payment => payment.method || payment.amount !== null);
  if (!payments.length) return undefined;

  const total = payments.reduce((sum, payment) => sum + (payment.amount || 0), 0);
  const one = payments.length === 1 ? payments[0] : null;
  if (one && /card|credit|debit|visa|master|amex|american express|discover/i.test(one.method)) {
    const lastFour = one.detail.match(/(\d{4})(?!.*\d)/)?.[1];
    return `${money(total)}${lastFour ? ` (xx-${lastFour})` : ' (Card)'}`;
  }
  if (one && /check/i.test(one.method)) {
    const reference = one.detail.replace(/^(?:check\s*)?(?:number|no\.?)?\s*#?\s*/i, '').trim();
    return `${money(total)}${reference ? ` (Check #${reference})` : ' (Check)'}`;
  }
  if (one && /cash/i.test(one.method)) return `${money(total)} (Cash)`;
  if (one?.method) return `${money(total)} (${one.method})`;
  return `${money(total)} (${payments.length} payments)`;
}

export function closeoutCompactSummary(row: AnyRecord): CloseoutCompactSummary {
  const closeout = row?.closeout && typeof row.closeout === 'object' ? row.closeout as AnyRecord : {};
  const otherCharges = (Array.isArray(closeout.otherCharges) ? closeout.otherCharges : [])
    .filter((charge): charge is AnyRecord => Boolean(charge) && typeof charge === 'object')
    .map(charge => ({
      name: firstText(charge, ['name', 'label', 'description']),
      total: firstNumber(charge, ['total', 'amount', 'unitPrice']) || 0,
    }));
  const labor = otherCharges.filter(charge => /\blabor\b/i.test(charge.name)).reduce((sum, charge) => sum + charge.total, 0);
  const miscCharges = otherCharges.filter(charge => !/\blabor\b|(?:cc|card).*(?:3%|surcharge)|surcharge.*card/i.test(charge.name));
  const misc = miscCharges.reduce((sum, charge) => sum + charge.total, 0);
  const total = firstNumber(row, ['revenue', 'job_total', 'jobTotal']) ?? firstNumber(closeout, ['total']);

  return {
    customer: firstText(row, ['customer_name', 'customerName', 'customer', 'name']) || 'Not provided',
    driver: firstText(row, ['driver_normalized_name', 'driver_name', 'driver']) || 'Not provided',
    navigator: firstText(row, ['navigator_normalized_name', 'navigator_name', 'navigator']) || 'Not provided',
    load: pricedLoad(closeout),
    ...(labor > 0 ? {labor: money(labor)} : {}),
    ...(misc !== 0 ? {misc: money(misc)} : {}),
    ...(total !== null ? {total: money(total)} : {}),
    payment: paymentSummary(closeout),
  };
}
