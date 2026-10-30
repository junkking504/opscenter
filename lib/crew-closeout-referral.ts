type Referral = {value?: string; label?: string; options?: Array<{value: string; label: string}>};
export const CREW_REFERRAL_DEFAULT_LABEL = 'Saw Trucks/Company Vehicle';
export const CREW_REFERRAL_UNAVAILABLE = 'The office must review the missing referral information in JunkWare. The Saw Trucks/Company Vehicle option is unavailable or ambiguous. Checkout has not been submitted.';

/** Owner-directed administrative default. Never overwrite a saved answer or
 * infer an option ID. Reads and draft fingerprints remain the original source. */
export function crewCloseoutReferral(field: Referral | undefined) {
  if (!field) return undefined;
  if (field.value) return {value: field.value, label: field.label || '', defaulted: false};
  const matches = (field.options || []).filter(option => option.value.trim()
    && option.label.trim() === CREW_REFERRAL_DEFAULT_LABEL);
  if (matches.length !== 1) return undefined;
  return {...matches[0], defaulted: true};
}
