export const customerFields = {
  firstName: 'FirstNameTB', lastName: 'LastNameTB', phone: 'PhoneTB', secondaryPhone: 'Phone2TB',
  email: 'EmailTB', address: 'AppointmentAddressTB', zip: 'AppointmentZipTB',
} as const;
export type CustomerDetails = Record<keyof typeof customerFields, string>;
export type CustomerChange = {customer: CustomerDetails; expectedSourceVersion: string; protectedVersion: string;appointmentNotes?:string[];estimateOutcome?:CustomerEstimateOutcome};
export function parseCustomerChange(value: Record<string, unknown>): CustomerChange {
  const input = value.customer as Record<string, unknown>;
  if (!input || typeof input !== 'object' || !/^[a-f0-9]{64}$/.test(String(value.expectedSourceVersion)) || !/^[a-f0-9]{64}$/.test(String(value.protectedVersion))) throw new Error('Reload current customer information before saving.');
  const customer = {} as CustomerDetails;
  const limits = {firstName:45,lastName:45,phone:20,secondaryPhone:20,email:100,address:150,zip:7};
  for (const key of Object.keys(customerFields) as Array<keyof CustomerDetails>) {
    if (typeof input[key] !== 'string' || (input[key] as string).length > limits[key] || /[\r\n\x00-\x1f]/.test(input[key] as string)) throw new Error(`A valid ${key} is required.`);
    customer[key] = (input[key] as string).trim();
  }
  if (!customer.firstName || !customer.lastName || !customer.address || !/^\d{5}$/.test(customer.zip)) throw new Error('First name, last name, service address and a five-digit ZIP are required.');
  for (const phone of [customer.phone,customer.secondaryPhone]) if (phone && !/^(?:1)?\d{10}$/.test(phone.replace(/[^0-9]/g,''))) throw new Error('Enter a valid ten-digit phone number.');
  if (!customer.phone) throw new Error('A primary phone number is required.');
  if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new Error('Enter a valid email address or leave it blank.');
  const appointmentNotes=value.appointmentNotes===undefined?[]:value.appointmentNotes;
  if(!Array.isArray(appointmentNotes) || appointmentNotes.length>500 || appointmentNotes.some(note=>typeof note!=='string' || note.length>10000))throw new Error('Current appointment notes are required.');
  let estimateOutcome:CustomerEstimateOutcome|undefined;
  if(value.estimateOutcome!==undefined){
    const outcome=value.estimateOutcome as CustomerEstimateOutcome;
    if(!outcome || !['Price/Budget','Date/Time','Other'].includes(outcome.reason) || typeof outcome.explanation!=='string' || !outcome.explanation.trim() || outcome.explanation.length>2000 || outcome.noDiscountReason!==undefined && (typeof outcome.noDiscountReason!=='string' || outcome.noDiscountReason.length>2000))throw new Error('Confirm the existing estimate outcome before saving.');
    estimateOutcome={reason:outcome.reason,explanation:outcome.explanation.trim(),...(outcome.noDiscountReason?.trim()?{noDiscountReason:outcome.noDiscountReason.trim()}:{})};
  }
  return {customer,appointmentNotes,estimateOutcome,expectedSourceVersion:String(value.expectedSourceVersion),protectedVersion:String(value.protectedVersion)};
}
export function customerMatches(a: CustomerDetails,b: CustomerDetails) {
  return (Object.keys(customerFields) as Array<keyof CustomerDetails>).every(key => key==='phone' || key==='secondaryPhone' ? a[key].replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'')===b[key].replace(/\D/g,'').replace(/^1(?=\d{10}$)/,'') : a[key].trim()===b[key].trim());
}

export type CustomerEstimateOutcome={reason:'Price/Budget'|'Date/Time'|'Other';explanation:string;noDiscountReason?:string};
export function customerOutcomeText(outcome:CustomerEstimateOutcome){return `${outcome.reason}: ${outcome.explanation}${outcome.noDiscountReason ? `, no discount: ${outcome.noDiscountReason}` : ''}`.replace(/\s+/g,' ').trim();}
export function suggestedCustomerOutcome(notes:string[]):CustomerEstimateOutcome|undefined {
  for(const note of [...notes].reverse()){
    const match=note.replace(/\s+\(\d{1,2}\/\d{1,2}\/\d{4}[^)]*\)\s*$/,'').match(/^(Price\/Budget|Date\/Time|Other):\s*(.+)$/);
    if(!match)continue;
    const split=match[2].lastIndexOf(', no discount: '),explanation=split<0?match[2]:match[2].slice(0,split),noDiscountReason=split<0?'':match[2].slice(split+', no discount: '.length);
    return {reason:match[1] as CustomerEstimateOutcome['reason'],explanation,...(noDiscountReason?{noDiscountReason}:{})};
  }
}
/** Preserve every existing note, with at most the explicitly reviewed native
 * outcome confirmation added. A native save need not always add a new note. */
export function customerNotesMatch(before:string[],after:string[],outcome?:CustomerEstimateOutcome){
  const remaining=[...after];for(const note of before){const index=remaining.indexOf(note);if(index<0)return false;remaining.splice(index,1);}
  return remaining.length===0 || Boolean(outcome && remaining.length===1 && remaining[0].startsWith(customerOutcomeText(outcome)+' ('));
}
