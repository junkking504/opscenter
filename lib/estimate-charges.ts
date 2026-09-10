export type EstimateCharge = { name: string; quantity: string; unitPrice: number | null; total: number | null };
export type EstimateCharges = { items: EstimateCharge[]; discount: number | null; tip: number | null };
const text = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
function amount(value: unknown): number | null {
  const raw = text(value).replace(/[$,]/g, '');
  return /^-?\d+(?:\.\d{1,2})?$/.test(raw) && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

// Saved load prices are extended amounts, not unit rates. Never multiply them
// by quantity again or invent missing prices from the quoted total.
export function estimateCharges(value: unknown): EstimateCharges {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const items: EstimateCharge[] = [];
  for (const [key, label] of [['load', 'Load'], ['bedload', 'Bedload']] as const) {
    const size = text(row[`${key}Size`]);
    const total = amount(row[`${key}Price`]);
    if ((size && !/^none$/i.test(size)) || total !== null) items.push({ name: `${label}${size && !/^none$/i.test(size) ? ` · size ${size}` : ''}`, quantity: text(row[`${key}Quantity`]), unitPrice: null, total });
  }
  for (const value of Array.isArray(row.otherCharges) ? row.otherCharges : []) {
    if (!value || typeof value !== 'object') continue;
    const charge = value as Record<string, unknown>;
    items.push({ name: text(charge.name) || 'Other charge', quantity: text(charge.quantity), unitPrice: amount(charge.unitPrice), total: amount(charge.total) });
  }
  return { items, discount: amount(row.discount), tip: amount(row.tip) };
}
