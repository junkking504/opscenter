export function searchKingsPhoneHref(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 10 ? `tel:+1${digits.slice(-10)}` : "";
}
