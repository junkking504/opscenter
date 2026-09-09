/** Shared by the editor and source adapter; payment IDs always come from JunkWare. */
export type CloseoutPayment = { methodId: string; amount: string; reference?: string };
export type PaymentOption = { value: string; label: string };
export function paymentReferenceLabel(method?: PaymentOption): string {
  if (/credit card/i.test(method?.label || '')) return 'Card last four';
  if (/check/i.test(method?.label || '')) return 'Check number';
  return '';
}
export function validateCloseoutPayment(payment: CloseoutPayment, methods: PaymentOption[]): string {
  const method = methods.find(option => option.value && option.value === payment.methodId);
  if (!method) return 'Choose an available JunkWare payment method.';
  if (!/^\d+(?:\.\d{1,2})?$/.test(payment.amount) || Number(payment.amount) <= 0 || Number(payment.amount) > 1_000_000) return 'Enter a payment amount greater than zero with at most two decimal places.';
  const label = paymentReferenceLabel(method);
  if (label === 'Card last four' && !/^\d{4}$/.test(payment.reference || '')) return 'Enter only the four trailing card digits for the recorded payment.';
  if (label === 'Check number' && !/^[A-Za-z0-9-]{1,30}$/.test(payment.reference || '')) return 'Enter the check number (up to 30 letters, digits or hyphens).';
  if (!label && payment.reference) return 'This payment method does not use a payment reference.';
  return '';
}
