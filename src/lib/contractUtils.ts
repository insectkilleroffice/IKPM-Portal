import type { Contract } from '../types/operations';

/**
 * Returns effective display status for a contract.
 * Active contracts whose endDate has passed are shown as 'expired' without
 * modifying the stored record — avoids silent side-effect writes on page load.
 */
export function effectiveContractStatus(
  c: Pick<Contract, 'status' | 'endDate'>,
  today: string,
): Contract['status'] {
  if (c.status === 'active' && c.endDate < today) return 'expired';
  return c.status;
}
