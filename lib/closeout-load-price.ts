type Option = { value: string; label: string };

/** JunkWare's first size option means no partial load, not no full trucks. */
export function automaticSizePrice(size: string, quantity: string, options: Option[], prices: number[], kind: 'load' | 'bedload', dryRunFee?: string): string {
  // Dry Run is an extra dropdown option, not an entry in JunkWare's Prices array.
  if (kind === 'load' && size === 'Dry Run') {
    if (!options.some(option => option.value === size) || !dryRunFee?.trim()) return '';
    const fee = Number(dryRunFee);
    return Number.isFinite(fee) && fee >= 0 ? fee.toFixed(2) : '';
  }
  const pricedOptions = kind === 'load' ? options.filter(option => option.value !== 'Dry Run') : options;
  const index = pricedOptions.findIndex((option) => option.value === size);
  if (index < 0 || !prices.length) return '';
  const units = Number.parseInt(quantity, 10);
  const countedUnits = Number.isFinite(units) && units > 0 ? units : 0;
  let price = countedUnits * prices.at(-1)!;
  if (kind === 'load' && size === 'Bag(s)' && countedUnits) price = countedUnits * prices[0];
  else if (index > 0 && size !== 'Bag(s)') {
    const partial = prices[index - 1];
    if (!Number.isFinite(partial) || partial < 0) return '';
    price += partial;
  }
  return price > 0 ? price.toFixed(2) : '';
}
