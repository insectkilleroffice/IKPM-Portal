// "Add old client" form (super admin): one client served before the portal, entered step by step.
// The visits of each contract are scheduled automatically from its start to its end date (or its
// cancel date) and can then be edited. Past visits are answered right there: done or not, which old
// invoice billed them, what was paid. Saving creates normal records:
//   done + invoice no. → approved old invoice with its payment   done, no invoice → Invoices → Completed jobs
//   not done → not created                                         future → scheduled visit

import { dataService } from '../../services/dataService';
import { normalizePakistaniPhone } from '../../lib/formatters';
import { planVisits } from '../../lib/visitSchedule';
import type { CompanyMaster, SiteAddress } from '../../types/customer';
import type { ContractCancelCategory } from '../../types/operations';
import { cancelCategory, createOldClientRecords, type PlannedClient, type PlannedVisit } from './oldClientRecords';
import { checkOldData, saveOldData, type OldInvoiceAnswer } from './oldData';

export type OldClientKind = 'company' | 'individual' | 'residential';
export type Province = CompanyMaster['province'];
export type PropertyType = SiteAddress['propertyType'];

export interface DraftSite { key: string; name: string; address: string; area: string; city: string; propertyType: PropertyType }
export interface DraftContract {
  key: string; siteKey: string; type: 'amc_recurring' | 'one_time'; start: string; end: string;
  monthlyRate: string; value: string; taxPercent: string; taxInclusive: boolean; visitsPerMonth: string; cycle: number; paymentDays: string;
  services: string; po: string; status: 'running' | 'ended' | 'cancelled'; cancelledOn: string; cancelReason: string; supervisorUid: string;
}
export interface DraftVisit { key: string; contractKey: string; date: string; done: boolean; invoiceNo: string; challan: string; supervisorUid: string; notes: string }
export interface DraftInvoice { number: string; date: string; total: string; tax: string; pay: 'paid' | 'part' | 'unpaid'; paid: string; paidOn: string; touched?: boolean }

export interface OldClientDraft {
  kind: OldClientKind;
  name: string; contact: string; phone: string; email: string; address: string; area: string; city: string; province: Province;
  ntn: string; strn: string; former: boolean;
  sites: DraftSite[];
  contracts: DraftContract[];
  visits: DraftVisit[];
  /** Keyed by invoice number (lower case). */
  invoices: Record<string, DraftInvoice>;
  openingBalance: string; openingAsOf: string; openingNote: string;
}

export const today = () => new Date().toISOString().slice(0, 10);
const uid = () => Math.random().toString(36).slice(2, 9);
export const num = (s: string) => Number(String(s ?? '').replace(/[,\s]/g, '')) || 0;

export function blankDraft(kind: OldClientKind): OldClientDraft {
  const site: DraftSite = { key: uid(), name: kind === 'company' ? 'Head office' : kind === 'residential' ? 'Home' : '', address: '', area: '', city: '', propertyType: kind === 'company' ? 'commercial_office' : kind === 'residential' ? 'residential_house' : 'commercial_office' };
  return {
    kind, name: '', contact: '', phone: '', email: '', address: '', area: '', city: '', province: 'Sindh', ntn: '', strn: '', former: false,
    sites: [site], contracts: [blankContract(kind, site.key)], visits: [], invoices: {}, openingBalance: '', openingAsOf: '', openingNote: '',
  };
}

export function blankContract(kind: OldClientKind, siteKey: string): DraftContract {
  return {
    key: uid(), siteKey, type: 'amc_recurring', start: '', end: '', monthlyRate: '', value: '', taxPercent: kind === 'company' ? '15' : '0', taxInclusive: false,
    visitsPerMonth: '1', cycle: 0, paymentDays: '', services: '', po: '', status: 'running', cancelledOn: '', cancelReason: '', supervisorUid: '',
  };
}

export const newSite = (): DraftSite => ({ key: uid(), name: '', address: '', area: '', city: '', propertyType: 'commercial_office' });

/** Last day the contract is serviced: its cancel date, else its end. */
export const lastServiceDay = (k: DraftContract) => (k.status === 'cancelled' && k.cancelledOn ? k.cancelledOn : k.end);

/** Visit dates of a contract from its start to its end (or cancel date). Sundays skipped. */
export function scheduleDates(k: DraftContract): string[] {
  const end = lastServiceDay(k);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(k.start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end < k.start) return [];
  const oneTime = k.type === 'one_time';
  return planVisits({
    start: k.start, end, serviceVisitsPerMonth: oneTime ? 1 : Math.max(1, Math.min(31, Math.round(num(k.visitsPerMonth)) || 1)), followUpVisitsPerMonth: 0,
    branches: [{ id: 'site', name: 'site' }], skipSundays: true, maxVisits: oneTime ? Math.max(1, Math.round(num(k.visitsPerMonth)) || 1) : undefined,
  }).filter((v) => v.kind === 'service').map((v) => v.date);
}

/** Replaces the contract's visits with its automatic schedule (past = done, future = scheduled). */
export function withSchedule(d: OldClientDraft, contractKey: string): OldClientDraft {
  const k = d.contracts.find((x) => x.key === contractKey);
  if (!k) return d;
  const keep = d.visits.filter((v) => v.contractKey !== contractKey);
  const t = today();
  const fresh = scheduleDates(k).map((date) => ({ key: uid(), contractKey, date, done: date <= t, invoiceNo: '', challan: '', supervisorUid: k.supervisorUid, notes: '' }));
  return { ...d, visits: [...keep, ...fresh].sort((a, b) => a.date.localeCompare(b.date)) };
}

export const addVisit = (d: OldClientDraft, contractKey: string, date: string): OldClientDraft => {
  const k = d.contracts.find((x) => x.key === contractKey);
  return { ...d, visits: [...d.visits, { key: uid(), contractKey, date, done: date <= today(), invoiceNo: '', challan: '', supervisorUid: k?.supervisorUid ?? '', notes: '' }].sort((a, b) => a.date.localeCompare(b.date)) };
};

/** Active Supervisors (roles based on Supervisor), by name. */
export const supervisors = () => dataService.getTeamLeaders();

/** Invoice numbers typed on done past visits, in visit order: [key, label, visits]. */
export function invoiceGroups(d: OldClientDraft): [string, string, DraftVisit[]][] {
  const m = new Map<string, [string, string, DraftVisit[]]>();
  d.visits.forEach((v) => {
    const n = v.invoiceNo.trim();
    if (!n || !v.done || v.date > today()) return;
    const k = n.toLowerCase();
    if (!m.has(k)) m.set(k, [k, n, []]);
    m.get(k)![2].push(v);
  });
  return [...m.values()];
}

/** Suggested invoice total (incl. tax) and tax for some visits, from their contracts' rates. */
export function suggestInvoice(d: OldClientDraft, visits: DraftVisit[]): { total: number; tax: number } {
  let base = 0;
  let tax = 0;
  visits.forEach((v) => {
    const k = d.contracts.find((x) => x.key === v.contractKey);
    if (!k) return;
    const t = num(k.taxPercent) / 100;
    let b = 0;
    if (k.type === 'one_time') {
      const n = d.visits.filter((x) => x.contractKey === k.key && x.done).length || 1;
      b = (num(k.value) / (1 + t)) / n;
    } else {
      const rate = num(k.monthlyRate) ? (k.taxInclusive ? num(k.monthlyRate) / (1 + t) : num(k.monthlyRate)) : 0;
      const month = v.date.slice(0, 7);
      const inMonth = d.visits.filter((x) => x.contractKey === k.key && x.date.startsWith(month)).length;
      b = rate / Math.max(1, Math.round(num(k.visitsPerMonth)) || 1, inMonth);
    }
    base += b;
    tax += b * t;
  });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { total: r2(base + tax), tax: r2(tax) };
}

/** Invoice form rows for the typed numbers: keeps what was edited, suggests the rest. */
export function syncInvoices(d: OldClientDraft): Record<string, DraftInvoice> {
  const out: Record<string, DraftInvoice> = {};
  invoiceGroups(d).forEach(([k, label, vs]) => {
    const prev = d.invoices[k];
    if (prev?.touched) { out[k] = { ...prev, number: label }; return; }
    const s = suggestInvoice(d, vs);
    out[k] = { number: label, date: vs[vs.length - 1].date, total: s.total ? String(s.total) : '', tax: String(s.tax), pay: prev?.pay ?? 'paid', paid: prev?.paid ?? '', paidOn: prev?.paidOn ?? '' };
  });
  return out;
}

const invoiceAnswers = (d: OldClientDraft): OldInvoiceAnswer[] => Object.values(syncInvoices(d)).map((f) => {
  const total = num(f.total);
  return { number: f.number, date: f.date, total, tax: num(f.tax), paid: f.pay === 'paid' ? total : f.pay === 'part' ? num(f.paid) : 0, paidOn: f.pay === 'unpaid' ? undefined : f.paidOn || undefined };
});

/** Problems per step (empty = ok to go on / save). */
export function checkDraft(d: OldClientDraft): { client: string[]; contracts: string[]; visits: string[]; invoices: string[] } {
  const client: string[] = [];
  if (!d.name.trim()) client.push('Client name is missing');
  if (!d.phone.trim()) client.push('Phone is missing');
  else if (!normalizePakistaniPhone(d.phone)) client.push('Phone is not a valid number');
  if (!d.address.trim()) client.push('Address is missing');
  if (!d.city.trim()) client.push('City is missing');
  const phone = normalizePakistaniPhone(d.phone);
  if (phone) {
    const co = dataService.getCompanies().find((c) => [c.primaryContact?.mobile, c.primaryContact?.phone].some((p) => normalizePakistaniPhone(p) === phone));
    const cl = dataService.getClients().find((c) => normalizePakistaniPhone(c.primaryPhone) === phone);
    if (co || cl) client.push(`This phone is already in the portal: ${co?.legalCompanyName ?? cl?.fullName}`);
  }
  const ntn = d.ntn.replace(/\D/g, '');
  if (ntn) { const co = dataService.getCompanies().find((c) => (c.ntn ?? '').replace(/\D/g, '') === ntn); if (co) client.push(`This NTN is already in the portal: ${co.legalCompanyName}`); }
  d.sites.forEach((s, i) => { if (!s.name.trim()) client.push(`Site ${i + 1}: name is missing`); });
  if (new Set(d.sites.map((s) => s.name.trim().toLowerCase())).size !== d.sites.length) client.push('Two sites have the same name');

  const contracts: string[] = [];
  d.contracts.forEach((k, i) => {
    const n = `Contract ${i + 1}`;
    if (!k.start || !k.end) contracts.push(`${n}: start and end dates are needed`);
    else if (k.end < k.start) contracts.push(`${n}: end is before start`);
    if (k.type === 'amc_recurring' && !num(k.monthlyRate) && !num(k.value)) contracts.push(`${n}: enter the monthly rate`);
    if (k.type === 'one_time' && !num(k.value)) contracts.push(`${n}: enter the contract value`);
    if (k.status === 'cancelled' && (!k.cancelledOn || !k.cancelReason.trim())) contracts.push(`${n}: cancelled needs the cancel date and reason`);
    if (k.status === 'cancelled' && k.cancelledOn && k.start && k.cancelledOn < k.start) contracts.push(`${n}: cancel date is before the start`);
    if (!d.sites.some((s) => s.key === k.siteKey)) contracts.push(`${n}: choose its site`);
  });

  const visits: string[] = [];
  const seen = new Set<string>();
  d.visits.forEach((v) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.date)) visits.push('A visit has no date');
    const c = v.challan.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
    if (c && (seen.has(c) || dataService.challanNumberUsedBy(v.challan, '__new__'))) visits.push(`Challan No. ${v.challan} is already used`);
    if (c) seen.add(c);
  });
  const t = today();
  d.contracts.filter((k) => k.status === 'cancelled' && k.cancelledOn).forEach((k) => {
    if (d.visits.some((v) => v.contractKey === k.key && v.date > k.cancelledOn && v.date > t)) visits.push('A cancelled contract has upcoming visits after its cancel date');
  });

  const answers = d.visits.filter((v) => v.date <= t).map((v) => ({ jobId: v.key, done: v.done, invoiceNo: v.done ? v.invoiceNo : '' }));
  const invoices = checkOldData(answers, invoiceAnswers(d));
  if (d.openingBalance.trim() && (!(num(d.openingBalance) > 0) || !d.openingAsOf)) invoices.push('Opening balance needs an amount and an "as of" date');
  return { client, contracts, visits, invoices };
}

export function draftSummary(d: OldClientDraft) {
  const t = today();
  const past = d.visits.filter((v) => v.date <= t);
  const inv = invoiceAnswers(d);
  return {
    sites: d.sites.length, contracts: d.contracts.length,
    done: past.filter((v) => v.done).length, notDone: past.filter((v) => !v.done).length, upcoming: d.visits.length - past.length,
    toInvoice: past.filter((v) => v.done && !v.invoiceNo.trim()).length,
    invoices: inv.length, invoiced: inv.reduce((s, i) => s + i.total, 0), due: inv.reduce((s, i) => s + i.total - i.paid, 0) + num(d.openingBalance),
  };
}

const PROPERTY_CUSTOMER = (kind: OldClientKind) => (kind === 'company' ? 'company' : 'individual') as 'company' | 'individual';

/** Saves the old client: records first, then its old invoices / payments. Returns the new client id. */
export async function saveOldClient(d: OldClientDraft, user: { uid: string; email: string; name: string }): Promise<{ customerId: string; summary: ReturnType<typeof draftSummary> }> {
  const problems = Object.values(checkDraft(d)).flat();
  if (problems.length) throw new Error(problems.join('\n'));
  const t = today();
  const staff = dataService.getStaff();
  const siteName = (key: string) => d.sites.find((s) => s.key === key)?.name ?? '';
  const contractOf = (key: string) => d.contracts.find((k) => k.key === key)!;
  const companyBranches = d.kind === 'company' && (d.sites.length > 1 || d.sites[0]?.name.trim().toLowerCase() !== 'head office');

  // Not-done past visits are simply not created
  const kept = d.visits.filter((v) => v.date > t || v.done);
  const plannedVisits: PlannedVisit[] = kept.map((v) => {
    const k = contractOf(v.contractKey);
    const sup = staff.find((u) => u.uid === v.supervisorUid);
    const done = v.date <= t;
    return {
      row: 0, siteName: siteName(k.siteKey), date: v.date, done, services: k.services.split(',').map((x) => x.trim()).filter(Boolean),
      challan: v.challan.trim() || undefined, supervisorUid: sup?.uid, supervisorName: sup?.displayName, pcoIds: [], pcoNames: [],
      notes: v.notes.trim() || undefined, invoicedOutside: false, pending: done,
    };
  });
  const pc: PlannedClient = {
    ref: 'OLD', row: 0, type: PROPERTY_CUSTOMER(d.kind), name: d.name.trim(), contact: d.contact.trim() || d.name.trim(), phone: d.phone.trim(), email: d.email.trim() || undefined,
    address: d.address.trim(), area: d.area.trim(), city: d.city.trim(), province: d.province, ntn: d.ntn.trim() || undefined, strn: d.strn.trim() || undefined, former: d.former,
    sites: (companyBranches || d.kind !== 'company') ? d.sites.map((s) => ({
      name: s.name.trim(), address: s.address.trim() || d.address.trim(), area: s.area.trim() || d.area.trim(), city: s.city.trim() || d.city.trim(), province: d.province,
      propertyType: s.propertyType, contact: d.contact.trim() || d.name.trim(), phone: d.phone.trim(),
    })) : [],
    contracts: d.contracts.map((k) => ({
      row: 0, siteName: siteName(k.siteKey), type: k.type, start: k.start, end: k.end, running: k.status === 'running',
      monthlyRate: k.type === 'amc_recurring' && num(k.monthlyRate) ? num(k.monthlyRate) : undefined, taxPercent: num(k.taxPercent), taxInclusive: k.taxInclusive,
      visitsPerMonth: Math.round(num(k.visitsPerMonth)) || undefined, cycle: k.type === 'one_time' ? 0 : k.cycle, paymentDays: num(k.paymentDays) || undefined,
      services: k.services.split(',').map((x) => x.trim()).filter(Boolean), value: num(k.value) || undefined, po: k.po.trim() || undefined,
      cancelled: k.status === 'cancelled' ? { on: k.cancelledOn, reason: k.cancelReason.trim(), category: cancelCategory(k.cancelReason) as ContractCancelCategory } : undefined,
    })),
    visits: plannedVisits,
    openings: d.openingBalance.trim() && num(d.openingBalance) > 0
      ? [{ row: 0, amount: num(d.openingBalance), asOf: d.openingAsOf, due: d.openingAsOf, reference: d.openingNote.trim() }] : [],
  };
  const report = await createOldClientRecords([pc], user);
  if (report.failed.length) throw new Error(report.failed[0].message);
  const saved = report.saved[0];

  // Past done visits → old invoices with payments (or left to invoice in the portal)
  const answers = kept.map((v, i) => ({ v, jobId: saved.jobIds[i] })).filter(({ v }) => v.date <= t)
    .map(({ v, jobId }) => ({ jobId, done: true, invoiceNo: v.invoiceNo }));
  await saveOldData(saved.customerId, answers, invoiceAnswers(d), user);
  return { customerId: saved.customerId, summary: draftSummary(d) };
}
