import type { FuelClaim, ServiceJob } from '../types/operations';

/** Fixed bike average used for every field trip. */
export const FUEL_KM_PER_LITRE = 36;

/** Litres and PKR for one person's trip: (km going + km back) ÷ 36 km/L × petrol price. */
export function fuelCost(kmGoing: number, kmReturn: number, petrolPrice: number, kmPerLitre = FUEL_KM_PER_LITRE) {
  const km = Math.max(0, kmGoing || 0) + Math.max(0, kmReturn || 0);
  const litres = kmPerLitre > 0 ? km / kmPerLitre : 0;
  return { km, litres: Math.round(litres * 100) / 100, amount: Math.round(litres * Math.max(0, petrolPrice || 0)) };
}

/** Fuel is paid for visits QC verified, and for trips where the client blocked access (the team still went). */
export const fuelPayable = (j: ServiceJob) => !!j.supervisorVerification?.isVerified || j.visitOutcome === 'client_blocked';

/** One employee's fuel for the given visits: total km and PKR. */
export function fuelForEmployee(employeeId: string, jobs: ServiceJob[]) {
  let km = 0;
  let amount = 0;
  let trips = 0;
  for (const j of jobs) {
    if (!fuelPayable(j)) continue;
    for (const c of j.fuelClaims ?? []) {
      if (c.employeeId !== employeeId) continue;
      km += (c.kmGoing || 0) + (c.kmReturn || 0);
      amount += c.amount || 0;
      trips++;
    }
  }
  return { km, amount, trips };
}

export type { FuelClaim };
