import { createHash } from 'node:crypto';
export function closeoutSourceVersion(closeout: Record<string, unknown>): string { return createHash('sha256').update(JSON.stringify(closeout)).digest('hex'); }
type Row = Record<string, unknown>;
function amount(value: unknown): number {
  const text = String(value ?? '').replace(/[$,\s]/g, '');
  if (!text) return 0;
  if (!/^-?\d+(?:\.\d+)?$/.test(text)) throw new Error('A source closeout amount could not be verified.');
  const number = Number(text); if (!Number.isFinite(number)) throw new Error('A source closeout amount could not be verified.'); return number;
}
const sameAmount = (a: unknown, b: unknown) => Math.abs(amount(a) - amount(b)) <= .005;
const normalized = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
function rows(source: Row, name: string): Row[] { if (!Array.isArray(source[name])) throw new Error(`Source ${name} rows are unavailable for verification.`); return source[name] as Row[]; }
/** Multiset subtraction detects changed/deleted original rows as well as duplicate additions. */
function addedRows(before: Row[], after: Row[], key: (row: Row) => string): Row[] {
  const remaining = after.slice();
  for (const row of before) { const index = remaining.findIndex(item => key(item) === key(row)); if (index < 0) throw new Error('An existing source payment or charge changed during closeout.'); remaining.splice(index, 1); }
  return remaining;
}
function paymentMethod(row: Row, source: Row): string {
  if (row.methodId) return String(row.methodId);
  const description = normalized(row.description);
  const candidates = (Array.isArray(source.paymentMethods) ? source.paymentMethods as Row[] : []).filter(option => option.value && normalized(option.label) && (description === normalized(option.label) || description.startsWith(`${normalized(option.label)} `))).sort((a, b) => normalized(b.label).length - normalized(a.label).length);
  if (!candidates.length || candidates.length > 1 && normalized(candidates[0].label) === normalized(candidates[1].label)) throw new Error('The added payment method could not be verified from the source row.');
  return String(candidates[0].value);
}
export function verifyAddedCloseoutCharges(closeout: Row, before: Row, requested: Row[], allowSourceCalculatedPrice = false): Row[] {
  const options = Array.isArray(before.otherChargeOptions) ? before.otherChargeOptions as Row[] : [];
  // Existing percentage fees legitimately recalculate when the operator changes base charges.
  const percentageLabels = new Set(options.filter(option => String(option.value).split('|')[2] === '1').map(option => normalized(option.label)));
  const chargeKey = (row: Row) => percentageLabels.has(normalized(row.label)) ? JSON.stringify([normalized(row.label), amount(row.quantity)]) : JSON.stringify([normalized(row.label), amount(row.quantity), amount(row.price), amount(row.total)]);
  const added = addedRows(rows(before, 'otherCharges'), rows(closeout, 'otherCharges'), chargeKey);
  if (added.length !== requested.length) throw new Error('JunkWare did not retain exactly the requested added charges.');
  return requested.map(request => {
    const option = options.find(option => String(option.value) === String(request.typeValue));
    if (!option) throw new Error('The requested charge type is missing from the source options.');
    const index = added.findIndex(row => normalized(row.label) === normalized(option.label) && sameAmount(row.quantity, request.quantity));
    if (index < 0) throw new Error('JunkWare did not retain the requested charge type and quantity.');
    const row = added.splice(index, 1)[0];
    const percentage = String(request.typeValue).split('|')[2] === '1';
    if (!percentage && !sameAmount(row.price, request.price)) throw new Error('JunkWare did not retain the requested charge price.');
    if (percentage) {
      if (request.sourceCalculatedPrice !== undefined && !allowSourceCalculatedPrice) { if (!sameAmount(row.price, request.sourceCalculatedPrice)) throw new Error('The source-calculated charge price changed before final verification.'); }
      else if (!allowSourceCalculatedPrice) throw new Error('The percentage charge requires its source-calculated price evidence.');
      amount(row.price); amount(row.total);
    }
    return row;
  });
}
export function verifyCloseoutFields(closeout: Row, input: Row, before?: Row): void {
  for (const key of ['loadQuantity', 'loadPrice', 'bedloadQuantity', 'bedloadPrice', 'discount', 'tip']) if (!sameAmount(closeout[key], input[key])) throw new Error(`JunkWare did not retain ${key}.`);
  for (const [key, inputKey] of [['loadSize', 'loadSize'], ['bedloadSize', 'bedloadSize'], ['jobCategory', 'jobCategoryId'], ['actualStartHour', 'actualStartHour'], ['actualStartMinute', 'actualStartMinute'], ['actualEndHour', 'actualEndHour'], ['actualEndMinute', 'actualEndMinute']]) {
    const actual = closeout[key] as { value?: unknown } | undefined; if (String(actual?.value ?? '') !== String(input[inputKey] ?? '')) throw new Error(`JunkWare did not retain ${key}.`);
  }
  if (input.appointmentType && normalized((closeout.appointmentType as Row | undefined)?.label) !== normalized(input.appointmentType)) throw new Error('JunkWare did not retain the appointment category.');
  if (input.addPayment) {
    if (!before) throw new Error('The payment needs a source baseline before verification.');
    const key = (row: Row) => JSON.stringify([normalized(row.description), amount(row.amount), String(row.methodId || '')]);
    const added = addedRows(rows(before, 'payments'), rows(closeout, 'payments'), key), request = input.addPayment as Row;
    if (added.length !== 1 || !sameAmount(added[0].amount, request.amount)) throw new Error('The added payment amount did not match the source read-back.');
    if (!request.methodId || paymentMethod(added[0], before) !== String(request.methodId)) throw new Error('JunkWare did not retain the requested payment method.');
  } else if (before) {
    const key = (row: Row) => JSON.stringify([normalized(row.description), amount(row.amount)]);
    if (addedRows(rows(before, 'payments'), rows(closeout, 'payments'), key).length) throw new Error('An unexpected payment appeared during closeout.');
  }
  const charges = Array.isArray(input.otherChargesToAdd) ? input.otherChargesToAdd as Row[] : [];
  if (before) verifyAddedCloseoutCharges(closeout, before, charges);
  else if (charges.length) throw new Error('The charges need a source baseline before verification.');
}
