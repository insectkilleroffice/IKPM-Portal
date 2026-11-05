/**
 * Is a YYYY-MM-DD date inside the picked range (both ends included)?
 * No end date means the start date only. Dates entered the wrong way round still work.
 */
export function inDateRange(date: string, from: string, to: string): boolean {
  if (!from && !to) return true;
  const start = from || to;
  const end = to || from;
  return start <= end ? date >= start && date <= end : date >= end && date <= start;
}
