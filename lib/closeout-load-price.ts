type Option = { value: string; label: string };

/** JunkWare's first size option means no partial load, not no full trucks. */
export function automaticSizePrice(size: string, quantity: string, options: Option[], prices: number[], kind: 'load' | 'bedload'): string {
  const index = options.findIndex((option) => option.value === size);
  if (index < 0 || !prices.length) return '';
  const units = Number.parseInt(quantity, 10);
  const countedUnits = Number.isFinite(units) && units > 0 ? units : 0;
  let price = countedUnits * prices.at(-1)!;
  if (kind === 'load' && size === 'Bag(s)' && countedUnits) price = countedUnits * prices[0];
  else if (index > 0 && size !== 'Bag(s)') price += prices[index - 1] || 0;
  return price > 0 ? price.toFixed(2) : '';
}
