// Pakistani formatting utilities: Currency, Dates, CNIC, NTN, and Phone Normalization

export function formatPKR(amount: number | undefined | null): string {
  if (amount === undefined || amount === null || isNaN(amount)) return 'PKR 0';
  return new Intl.NumberFormat('en-PK', {
    style: 'currency',
    currency: 'PKR',
    maximumFractionDigits: 0,
  }).format(amount).replace('PKR', 'PKR ');
}

export function formatDate(dateString: string | undefined | null): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-PK', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });
  } catch {
    return dateString;
  }
}

export function formatDateTime(dateString: string | undefined | null): string {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    if (isNaN(d.getTime())) return dateString;
    return d.toLocaleDateString('en-PK', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateString;
  }
}

/**
 * Normalizes Pakistani phone numbers to +923XXXXXXXXX format for exact duplicate detection
 */
export function normalizePakistaniPhone(phone: string): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.startsWith('92')) {
    return `+${digits}`;
  }
  if (digits.startsWith('03')) {
    return `+92${digits.substring(1)}`;
  }
  if (digits.length === 10 && digits.startsWith('3')) {
    return `+92${digits}`;
  }
  return phone.trim();
}

/**
 * Formats Pakistani CNIC to 42101-1234567-1 format
 */
export function formatCNIC(cnic: string): string {
  const digits = cnic.replace(/\D/g, '');
  if (digits.length === 13) {
    return `${digits.slice(0, 5)}-${digits.slice(5, 12)}-${digits.slice(12)}`;
  }
  return cnic;
}

/**
 * Formats Pakistani NTN to 1234567-8 format
 */
export function formatNTN(ntn: string): string {
  const digits = ntn.replace(/\D/g, '');
  if (digits.length === 8) {
    return `${digits.slice(0, 7)}-${digits.slice(7)}`;
  }
  return ntn;
}

/**
 * Generates human-friendly permanent IDs (e.g. CL-2026-0042)
 */
export function generatePermanentId(prefix: 'CL' | 'CO' | 'BR' | 'SITE' | 'LD' | 'P' | 'CT' | 'JOB' | 'INV' | 'REC' | 'CMP', seqNumber: number): string {
  const year = new Date().getFullYear();
  const padded = String(seqNumber).padStart(4, '0');
  return `${prefix}-${year}-${padded}`;
}
