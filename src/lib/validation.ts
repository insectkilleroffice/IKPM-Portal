// Shared input checks for every form. Optional fields may be left empty, but anything typed in must
// be valid. Each check returns a short message for the person, or undefined when the value is fine.

interface Opts {
  /** The field must be filled in. */
  required?: boolean;
  /** Field name used in the message, e.g. "Contact email". */
  label?: string;
}

const digitsOf = (v: string) => v.replace(/\D/g, '');
const empty = (v?: string | null) => !v || !v.trim();

export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function emailProblem(value: string | undefined | null, { required, label = 'Email' }: Opts = {}): string | undefined {
  if (empty(value)) return required ? `${label} is required.` : undefined;
  return EMAIL_PATTERN.test(value!.trim()) ? undefined : `${label} is not a valid email address (e.g. name@company.com).`;
}

/** Pakistani mobile: 03XX XXXXXXX, +92 3XX XXXXXXX or 92 3XX XXXXXXX. */
export function mobileProblem(value: string | undefined | null, { required, label = 'Mobile number' }: Opts = {}): string | undefined {
  if (empty(value)) return required ? `${label} is required.` : undefined;
  const d = digitsOf(value!);
  const ok = /^03\d{9}$/.test(d) || /^923\d{9}$/.test(d);
  return ok ? undefined : `${label} must be a Pakistani mobile number (03XX XXXXXXX).`;
}

/** Any Pakistani phone, mobile or landline (021-1234567, 042 12345678, 03XX…): 10 to 12 digits. */
export function phoneProblem(value: string | undefined | null, { required, label = 'Phone' }: Opts = {}): string | undefined {
  if (empty(value)) return required ? `${label} is required.` : undefined;
  const d = digitsOf(value!);
  const ok = (d.startsWith('0') && d.length >= 10 && d.length <= 11) || (d.startsWith('92') && d.length >= 11 && d.length <= 12);
  return ok ? undefined : `${label} is not a valid phone number (e.g. 03001234567 or 021-1234567).`;
}

/** CNIC: 13 digits, written 12345-1234567-1. */
export function cnicProblem(value: string | undefined | null, { required, label = 'CNIC' }: Opts = {}): string | undefined {
  if (empty(value)) return required ? `${label} is required.` : undefined;
  return /^\d{13}$/.test(digitsOf(value!)) ? undefined : `${label} must have 13 digits (12345-1234567-1).`;
}

/** NTN: 7 digits + check digit (1234567-8); individuals may use their 13-digit CNIC. */
export function ntnProblem(value: string | undefined | null, { required, label = 'NTN' }: Opts = {}): string | undefined {
  if (empty(value)) return required ? `${label} is required.` : undefined;
  const d = digitsOf(value!);
  return d.length === 7 || d.length === 8 || d.length === 13 ? undefined : `${label} must be 1234567-8 (or a 13-digit CNIC for individuals).`;
}

/** Sales tax registration: FBR STRN has 13 digits; SRB registrations are written S1234567-8. */
export function strnProblem(value: string | undefined | null, { required, label = 'STRN' }: Opts = {}): string | undefined {
  if (empty(value)) return required ? `${label} is required.` : undefined;
  const v = value!.trim().replace(/[\s-]/g, '');
  return /^\d{13}$/.test(v) || /^S\d{7,8}$/i.test(v) ? undefined : `${label} must have 13 digits (or the SRB format S1234567-8).`;
}

/** Keeps the messages that are set. */
export const problemsOf = (...checks: (string | undefined | false | null)[]): string[] => checks.filter((c): c is string => !!c);
