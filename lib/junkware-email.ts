const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type JunkwareEmailSubmission = {
  email?: string;
  controlValue: string;
};

// JunkWare accepts a valid address or a blank input. Its ASP.NET form submits
// every named control, so controlValue is blank when the email is omitted from
// the logical submission rather than preserving an invalid value.
export function prepareJunkwareEmailSubmission(value: unknown): JunkwareEmailSubmission {
  const trimmed = String(value || "").trim();
  if (!trimmed || !EMAIL_PATTERN.test(trimmed)) return { controlValue: "" };
  return { email: trimmed, controlValue: trimmed };
}
