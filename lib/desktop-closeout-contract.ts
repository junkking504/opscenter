import { createHash } from 'node:crypto';
type Row = Record<string, unknown>;
function stableUuid(value:string):string {
  const hash=createHash('sha256').update(value).digest('hex');
  return `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-${((parseInt(hash[16],16)&3)|8).toString(16)}${hash.slice(17,20)}-${hash.slice(20,32)}`;
}
/** JunkWare's hidden miscellaneous-charge UUID is regenerated on every form
 * render. Give the phone a deterministic identity for the same semantic row,
 * while retaining the current-render UUID only for the provider click. */
export function stableCloseoutChargeRows(value:unknown):Row[] {
  if(!Array.isArray(value))return [];
  const occurrences=new Map<string,number>();
  return value.map(raw=>{
    const row=raw && typeof raw==='object' && !Array.isArray(raw) ? raw as Row : {};
    const sourceId=String(row.sourceId || row.id || '');
    const signature=JSON.stringify([normalized(row.label),amount(row.quantity),amount(row.price),amount(row.total)]);
    const occurrence=occurrences.get(signature)||0;occurrences.set(signature,occurrence+1);
    return {...row,id:stableUuid(`junkware-closeout-charge-v1\0${signature}\0${occurrence}`),...(sourceId?{sourceId}:{})};
  });
}
/** Payment row UUIDs belong to one form render, just like charge UUIDs. */
export function stableCloseoutPaymentRows(value: unknown): Row[] {
  if (!Array.isArray(value)) return [];
  const occurrences = new Map<string, number>();
  return value.map(raw => {
    const row = raw as Row;
    const signature = JSON.stringify([normalized(row.description), amount(row.amount)]);
    const occurrence = occurrences.get(signature) || 0;
    occurrences.set(signature, occurrence + 1);
    return { ...row, id: stableUuid(`junkware-closeout-payment-v1\0${signature}\0${occurrence}`) };
  });
}

export function requestedPaymentRemovals(before: Row, requested: unknown): Row[] {
  if (requested === undefined) return [];
  if (!Array.isArray(requested) || requested.length > 20 || requested.some(id => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) || new Set(requested).size !== requested.length) throw new Error('Each payment removal must identify one saved source row.');
  return requested.map(id => {
    const matches = rows(before, 'payments').filter(row => row.id === id);
    if (matches.length !== 1 || matches[0].removable !== true) throw new Error('This payment cannot be removed from JunkWare here. Reload and review the source record.');
    return matches[0];
  });
}

/** Preserve every unselected payment, including duplicate-looking rows. */
export function verifyCloseoutPayments(closeout: Row, input: Row, before: Row): void {
  const removed = requestedPaymentRemovals(before, input.paymentIdsToRemove);
  const retained = rows(before, 'payments').filter(row => !removed.includes(row));
  const key = (row: Row) => JSON.stringify([normalized(row.description), amount(row.amount), String(row.methodId || '')]);
  const added = addedRows(retained, rows(closeout, 'payments'), key);
  const request = input.addPayment as Row | undefined;
  if (!request) {
    if (added.length) throw new Error('JunkWare did not remove exactly the requested payments, or an unexpected payment appeared.');
    return;
  }
  if (added.length !== 1 || !sameAmount(added[0].amount, request.amount)) throw new Error('The added payment amount did not match the source read-back.');
  if (!request.methodId || paymentMethod(added[0], before) !== String(request.methodId)) throw new Error('JunkWare did not retain the requested payment method.');
  const method = (before.paymentMethods as Row[]).find(option => String(option.value) === String(request.methodId));
  const tail = normalized(added[0].description).slice(normalized(method?.label).length).replace(/^[\s,#*]+/, '');
  if (tail !== normalized(request.reference)) throw new Error('JunkWare did not retain the payment reference.');
}

export function closeoutSourceVersion(closeout: Record<string, unknown>): string {
  const charges=Array.isArray(closeout.otherCharges)
    ? (closeout.otherCharges as Row[]).map(row=>{const {sourceId:_sourceId,...stable}=row;return stable;})
    : closeout.otherCharges;
  const payments = Array.isArray(closeout.payments) ? (closeout.payments as Row[]).map(row => { const { sourceId: _sourceId, id: _id, removable: _removable, ...stable } = row; return stable; }) : closeout.payments;
  return createHash('sha256').update(JSON.stringify({...closeout,otherCharges:charges,payments})).digest('hex');
}
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
  const candidates = (Array.isArray(source.paymentMethods) ? source.paymentMethods as Row[] : []).filter(option => option.value && normalized(option.label) && (description === normalized(option.label) || (description.startsWith(`${normalized(option.label)} `) || description.startsWith(`${normalized(option.label)},`)))).sort((a, b) => normalized(b.label).length - normalized(a.label).length);
  if (!candidates.length || candidates.length > 1 && normalized(candidates[0].label) === normalized(candidates[1].label)) throw new Error('The added payment method could not be verified from the source row.');
  return String(candidates[0].value);
}
/** JunkWare's percentage picker appends the rate; saved rows omit that suffix. */
function chargeLabels(option: Row): string[] {
  const label = normalized(option.label);
  const [, rate, percentage] = String(option.value).split('|');
  const suffix = label.match(/,\s*(\d+(?:\.\d+)?)\s*%$/);
  return percentage === '1' && suffix && Number(suffix[1]) === Number(rate)
    ? [label, label.slice(0, suffix.index).trim()] : [label];
}
export function verifyAddedCloseoutCharges(closeout: Row, before: Row, requested: Row[], allowSourceCalculatedPrice = false, requestedRemovalIds: string[] = []): Row[] {
  const options = Array.isArray(before.otherChargeOptions) ? before.otherChargeOptions as Row[] : [];
  const matchingOptions = (row: Row) => options.filter(option => chargeLabels(option).includes(normalized(row.label)));
  // Existing percentage fees legitimately recalculate when the operator changes base charges.
  const chargeKey = (row: Row) => {
    const matches = matchingOptions(row);
    return matches.length === 1 && String(matches[0].value).split('|')[2] === '1'
      ? JSON.stringify([String(matches[0].value), amount(row.quantity)])
      : JSON.stringify([normalized(row.label), amount(row.quantity), amount(row.price), amount(row.total)]);
  };
  const beforeRows = rows(before, 'otherCharges');
  const afterRows = rows(closeout, 'otherCharges');
  const removalIds = new Set(requestedRemovalIds);
  if (removalIds.size !== requestedRemovalIds.length) throw new Error('The requested charge removals contain duplicates.');
  for (const id of removalIds) {
    if (beforeRows.filter(row => String(row.id || '') === id).length !== 1) throw new Error('The requested source charge is unavailable for removal.');
  }
  const retainedBefore = beforeRows.filter(row => !removalIds.has(String(row.id || '')));
  if(removalIds.size && afterRows.length!==retainedBefore.length+requested.length)throw new Error('JunkWare did not remove exactly the requested source charges.');
  const added = addedRows(retainedBefore, afterRows, chargeKey);
  if (added.length !== requested.length) throw new Error('JunkWare did not retain exactly the requested added charges.');
  return requested.map(request => {
    const option = options.find(option => String(option.value) === String(request.typeValue));
    if (!option) throw new Error('The requested charge type is missing from the source options.');
    const index = added.findIndex(row => {
      const matches = matchingOptions(row);
      return matches.length === 1 && String(matches[0].value) === String(option.value) && sameAmount(row.quantity, request.quantity);
    });
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
  const truckName = (value: unknown) => String(value || '').replace(/Truck#?\s*/i, 'Truck ').trim();
  const expectedTruck = input.truck === undefined ? before?.truck : input.truck;
  if (expectedTruck !== undefined && truckName(closeout.truck) !== truckName(expectedTruck)) throw new Error('JunkWare did not retain the selected truck.');
  if (before?.appointmentWindow && JSON.stringify(closeout.appointmentWindow) !== JSON.stringify(before.appointmentWindow)) throw new Error('JunkWare changed the appointment window while saving.');
  for (const key of ['loadQuantity', 'loadPrice', 'bedloadQuantity', 'bedloadPrice', 'discount', 'tip']) if (!sameAmount(closeout[key], input[key])) throw new Error(`JunkWare did not retain ${key}.`);
  for (const [key, inputKey] of [['loadSize', 'loadSize'], ['bedloadSize', 'bedloadSize'], ['jobCategory', 'jobCategoryId'], ['actualStartHour', 'actualStartHour'], ['actualStartMinute', 'actualStartMinute'], ['actualEndHour', 'actualEndHour'], ['actualEndMinute', 'actualEndMinute']]) {
    if (key === 'jobCategory' && input.appointmentType === 'Estimate' && !((closeout[key] as Row | undefined)?.options as unknown[] | undefined)?.length) continue;
    const actual = closeout[key] as { value?: unknown } | undefined; if (String(actual?.value ?? '') !== String(input[inputKey] ?? '')) throw new Error(`JunkWare did not retain ${key}.`);
  }
  if (input.howHeardId !== undefined && String((closeout.howHeard as Row | undefined)?.value ?? '') !== String(input.howHeardId)) throw new Error('JunkWare did not retain how the customer heard about us.');
  if (input.appointmentType && normalized((closeout.appointmentType as Row | undefined)?.label) !== normalized(input.appointmentType)) throw new Error('JunkWare did not retain the appointment category.');
  if (before) verifyCloseoutPayments(closeout, input, before);
  else if (input.addPayment || (Array.isArray(input.paymentIdsToRemove) && input.paymentIdsToRemove.length)) throw new Error('Payment changes need a source baseline before verification.');
  const charges = Array.isArray(input.otherChargesToAdd) ? input.otherChargesToAdd as Row[] : [];
  const chargeRemovalIds = Array.isArray(input.otherChargeIdsToRemove) ? input.otherChargeIdsToRemove.map(String) : [];
  if (before) verifyAddedCloseoutCharges(closeout, before, charges, false, chargeRemovalIds);
  else if (charges.length || chargeRemovalIds.length) throw new Error('The charge changes need a source baseline before verification.');
}
