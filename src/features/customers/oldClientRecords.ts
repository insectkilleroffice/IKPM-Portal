// Creates the records of an OLD client (served before the portal): client, branches / sites,
// contracts, its visits and opening balance, tagged with an import batch. Used by the
// "Add old client" form (super admin). Old invoices and payments are then saved by oldData.saveOldData.
// It only creates normal records; every screen and workflow treats them like anything entered in the portal.

import { dataService } from '../../services/dataService';
import type { CompanyBranch, CompanyMaster, IndividualClient, SiteAddress } from '../../types/customer';
import type { Contract, ContractCancelCategory, ServiceJob } from '../../types/operations';
import type { Invoice } from '../../types/finance';
import type { ServicePlanItem } from '../../lib/proposalPlan';

type Province = CompanyMaster['province'];

// ---------------------------------------------------------------------------
// What gets created
// ---------------------------------------------------------------------------

export interface PlannedSite { name: string; address: string; area: string; city: string; province: Province; propertyType: SiteAddress['propertyType']; contact: string; phone: string }
export interface PlannedContract {
  row: number; siteName: string; type: Contract['contractType']; start: string; end: string; running: boolean;
  monthlyRate?: number; taxPercent: number; taxInclusive: boolean; visitsPerMonth?: number; cycle: number; paymentDays?: number;
  services: string[]; value?: number; po?: string;
  /** Cancelled before its end: last service day and why. */
  cancelled?: { on: string; reason: string; category: ContractCancelCategory };
}
export interface PlannedVisit {
  row: number; siteName: string; date: string; done: boolean; services: string[]; challan?: string; supervisorUid?: string; supervisorName?: string;
  pcoIds: string[]; pcoNames: string[]; chemicals?: string; notes?: string; invoicedOutside: boolean;
  /** Done: waits for its old invoice / payment answers (oldData.saveOldData), not billed meanwhile. */
  pending?: boolean;
}
export interface PlannedOpening { row: number; amount: number; asOf: string; due: string; reference: string }

export interface PlannedClient {
  ref: string;
  row: number;
  type: 'company' | 'individual';
  name: string;
  contact: string;
  phone: string;
  email?: string;
  address: string;
  area: string;
  city: string;
  province: Province;
  ntn?: string;
  strn?: string;
  former: boolean;
  sites: PlannedSite[];
  contracts: PlannedContract[];
  visits: PlannedVisit[];
  openings: PlannedOpening[];
}

export const cancelCategory = (reason: string): ContractCancelCategory => {
  const t = reason.toLowerCase();
  if (/competitor|other company|another company/.test(t)) return 'moved_to_competitor';
  if (/price|budget|expensive|cost|cheap/.test(t)) return 'price';
  if (/pay|dues|unpaid/.test(t)) return 'non_payment';
  if (/quality|complain|not satisf|result/.test(t)) return 'service_quality';
  if (/closed|relocat|shift|moving|moved|sold/.test(t)) return 'business_closed';
  if (/client|request|customer/.test(t)) return 'client_request';
  return 'other';
};

// ---------------------------------------------------------------------------
// Importing
// ---------------------------------------------------------------------------

export interface ImportReport {
  batchId: string;
  created: { clients: number; sites: number; contracts: number; visits: number; openings: number };
  failed: { client: string; message: string }[];
  /** Per client: its new id and the job id of each planned visit (same order as `visits`). */
  saved: { ref: string; customerId: string; jobIds: string[] }[];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const monthsBetween = (a: string, b: string) => Math.max(1, Math.round((new Date(`${b}T00:00:00Z`).getTime() - new Date(`${a}T00:00:00Z`).getTime()) / (30.44 * 86400000)));

/** Creates everything in the plan (clients that are not duplicates). Each client is imported on its own. */
export async function createOldClientRecords(clients: PlannedClient[], user: { uid: string; email: string; name: string }, onProgress?: (done: number, total: number) => void): Promise<ImportReport> {
  const batchId = `IMP-${new Date().toISOString().slice(0, 19).replace(/\D/g, '')}`;
  const tag = { importBatchId: batchId };
  const ts = () => new Date().toISOString();
  const report: ImportReport = { batchId, created: { clients: 0, sites: 0, contracts: 0, visits: 0, openings: 0 }, failed: [], saved: [] };
  const todo = clients;

  for (let i = 0; i < todo.length; i++) {
    const c = todo[i];
    onProgress?.(i, todo.length);
    try {
      const isCo = c.type === 'company';
      const contact = { id: 'cont_primary', fullName: c.contact, phone: c.phone, mobile: c.phone, email: c.email, isPrimary: true };
      // 1. Client account
      const customerId = isCo
        ? await dataService.newRecordId('CO', 'company', dataService.getCompanies().map((x) => x.id), 'companies')
        : await dataService.newRecordId('CL', 'client', dataService.getClients().map((x) => x.id), 'clients');
      if (isCo) {
        const company: CompanyMaster = {
          id: customerId, type: 'company', legalCompanyName: c.name, ntn: c.ntn, strn: c.strn, headOfficeAddress: c.address, city: c.city,
          province: c.province, primaryContact: contact, additionalContacts: [], industrySegment: 'other', billingPreference: 'centralized',
          taxStatus: c.ntn ? 'active_filer' : 'non_filer', totalBranchesCount: Math.max(1, c.sites.length), totalActiveContracts: c.contracts.filter((k) => k.running).length,
          totalBalance: 0, status: c.former ? 'inactive' : 'active', createdAt: ts(), createdBy: user.name, updatedAt: ts(), ...tag,
        };
        dataService.saveCompany(company, user.email);
      } else {
        const client: IndividualClient = {
          id: customerId, type: 'individual', fullName: c.name, primaryPhone: c.phone, email: c.email, residentialAddress: c.address,
          city: c.city, area: c.area, province: c.province, taxStatus: 'non_filer', status: c.former ? 'inactive' : 'active', balance: 0,
          createdAt: ts(), createdBy: user.name, updatedAt: ts(), ...tag,
        };
        dataService.saveClient(client, user.email);
      }
      report.created.clients++;

      // 2. Branches (companies) and sites; the client address when no site is listed
      const siteRows: PlannedSite[] = c.sites.length ? c.sites : [{ name: isCo ? 'Head office' : 'Home', address: c.address, area: c.area, city: c.city, province: c.province,
        propertyType: isCo ? 'commercial_office' : 'residential_house', contact: c.contact, phone: c.phone }];
      const placed = new Map<string, { siteId: string; branchId?: string; branchName?: string; site: PlannedSite }>();
      for (const s of siteRows) {
        let branchId: string | undefined;
        if (isCo && c.sites.length) {
          branchId = await dataService.newRecordId('BR', 'branch', dataService.getBranches().map((b) => b.id), 'branches');
          const branch: CompanyBranch = {
            id: branchId, companyId: customerId, companyName: c.name, branchName: s.name, city: s.city, area: s.area, province: s.province,
            physicalAddress: s.address, branchPhone: s.phone, branchEmail: c.email, branchManagerName: s.contact, branchManagerPhone: s.phone,
            billingType: 'company_invoice', balance: 0, contacts: [], status: 'active', createdAt: ts(), createdBy: user.name, updatedAt: ts(),
          };
          dataService.saveBranch(branch, user.email);
        }
        const siteId = await dataService.newRecordId('SITE', 'site', dataService.getSites().map((x) => x.id), 'sites');
        const site: SiteAddress = {
          id: siteId, siteName: s.name, customerType: c.type, customerId, branchId, propertyType: s.propertyType, addressLine1: s.address,
          area: s.area, city: s.city, province: s.province, contactPersonName: s.contact, contactPersonPhone: s.phone, isActive: true, createdAt: ts(),
        };
        dataService.saveSite(site);
        placed.set(s.name.toLowerCase(), { siteId, branchId, branchName: branchId ? s.name : undefined, site: s });
        report.created.sites++;
      }
      const firstPlace = [...placed.values()][0];
      const placeOf = (name: string) => (name ? placed.get(name.toLowerCase()) : undefined) ?? firstPlace;

      // 3. Contracts
      const contractIds: { id: string; place: ReturnType<typeof placeOf>; start: string; end: string; planned: PlannedContract }[] = [];
      for (const k of c.contracts) {
        const place = placeOf(k.siteName);
        const id = await dataService.newRecordId('CT', 'contract', dataService.getContracts().map((x) => x.id), 'contracts');
        const months = monthsBetween(k.start, k.end);
        const t = k.taxPercent / 100;
        const monthlyBase = k.monthlyRate ? (k.taxInclusive ? k.monthlyRate / (1 + t) : k.monthlyRate) : undefined;
        const before = k.type === 'one_time'
          ? (k.value ? k.value / (1 + t) : (monthlyBase ?? 0))
          : monthlyBase ? monthlyBase * months : (k.value ?? 0) / (1 + t);
        const total = k.value ?? round2(before * (1 + t));
        const servicePlan: ServicePlanItem[] = k.services.map((service, j) => ({ id: `imp_${j}`, service, frequency: k.type === 'one_time' ? 'Once' : 'As per contract' }));
        const contract: Contract = {
          id, contractType: k.type, customerType: c.type, customerId, customerName: c.name, branchId: place.branchId, branchName: place.branchName,
          siteIds: [place.siteId], startDate: k.start, endDate: k.end,
          frequency: k.type === 'one_time' ? 'one_off' : (k.visitsPerMonth ?? 1) >= 4 ? 'weekly' : (k.visitsPerMonth ?? 1) >= 2 ? 'fortnightly' : 'monthly',
          totalContractValue: round2(total), valueBeforeTax: round2(before),
          billingTerm: k.type === 'one_time' ? 'per_service' : 'monthly_billing', billingCycleDays: k.type === 'one_time' ? 0 : k.cycle,
          serviceScope: k.services.join(', ') || (k.type === 'one_time' ? 'One-time treatment' : 'Integrated Pest Management (IPM) maintenance'),
          servicePlan: servicePlan.length ? servicePlan : undefined, serviceVisitsPerMonth: k.visitsPerMonth,
          monthlyRate: k.type === 'amc_recurring' ? k.monthlyRate : undefined, taxMode: k.taxInclusive ? 'inclusive' : 'exclusive', taxPercent: k.taxPercent,
          tenureMonths: months, paymentTermsDays: k.paymentDays, clientPoNumber: k.po, warrantyPeriodMonths: 0,
          totalJobsScheduled: 0, totalJobsCompleted: 0, status: k.cancelled ? 'cancelled' : k.running ? 'active' : 'expired',
          ...(k.cancelled ? { cancellation: {
            category: k.cancelled.category, reason: k.cancelled.reason, effectiveDate: k.cancelled.on,
            requestedBy: user.uid, requestedByName: `${user.name} (imported record)`, requestedAt: ts(),
            approvedBy: user.uid, approvedByName: user.name, cancelledAt: `${k.cancelled.on}T12:00:00.000Z`,
          } } : {}),
          renewalAlertDate: new Date(new Date(`${k.end}T00:00:00Z`).getTime() - 60 * 86400000).toISOString().slice(0, 10),
          createdAt: ts(), updatedAt: ts(), ...tag,
        };
        dataService.saveContract(contract, user.email);
        contractIds.push({ id, place, start: k.start, end: k.end, planned: k });
        report.created.contracts++;
      }

      // 4. Visits: done (wait for the old invoice answers) and scheduled
      const visits: PlannedVisit[] = c.visits;
      const jobIds: string[] = [];
      for (const v of visits) {
        const place = placeOf(v.siteName);
        const contract = contractIds.find((k) => k.place.siteId === place.siteId && v.date >= k.start && v.date <= k.end)
          ?? contractIds.find((k) => v.date >= k.start && v.date <= k.end);
        const id = await dataService.newRecordId('JOB', 'job', dataService.getJobs().map((x) => x.id), 'service_jobs');
        const unmatchedPcos = v.pcoNames.length > v.pcoIds.length ? v.pcoNames.join(', ') : '';
        const notes = [
          v.done ? 'Visit carried out before the portal (imported record).' : '',
          unmatchedPcos ? `PCOs: ${unmatchedPcos}.` : '',
          v.chemicals ? `Chemicals used: ${v.chemicals}.` : '',
          v.notes ?? '',
        ].filter(Boolean).join('\n');
        const job: ServiceJob = {
          id, contractId: contract?.id, customerType: c.type, customerId, customerName: c.name, branchId: place.branchId, branchName: place.branchName,
          siteId: place.siteId, siteName: place.site.name, siteAddress: [place.site.address, place.site.area, place.site.city].filter(Boolean).join(', '),
          serviceType: v.services.join(', ') || 'Pest control service', visitServices: v.services.length ? v.services : undefined,
          targetPests: [], scheduledDate: v.date, timeSlot: 'morning',
          assignedTechnicianIds: v.supervisorUid ? [v.supervisorUid] : [], assignedTechnicianNames: v.supervisorName ? [v.supervisorName] : [],
          leadPcoId: v.supervisorUid || '', leadPcoName: v.supervisorName || 'Unassigned',
          assignedTeamLeaderId: v.supervisorUid, assignedTeamLeaderName: v.supervisorName,
          status: v.done ? 'completed' : 'scheduled', checklists: [], chemicalsUsed: [], photoEvidence: [],
          ...(v.done ? {
            supervisorVerification: { isVerified: true, supervisorId: user.uid, supervisorName: `${user.name} (imported record)`, verifiedAt: `${v.date}T12:00:00.000Z`, qcRating: 'satisfactory' as const, supervisorNotes: 'Visit imported from records before the portal' },
          } : {}),
          ...(notes ? { executionNotes: notes } : {}),
          ...(v.pcoIds.length ? { assignedPcoEmployeeIds: v.pcoIds, leadPcoEmployeeId: v.pcoIds[0], ...(v.done ? { performedByPcoIds: v.pcoIds } : {}) } : {}),
          ...(v.challan ? { challanNumber: v.challan } : {}),
          ...(v.invoicedOutside ? { invoicedOutside: true } : {}),
          ...(v.pending ? { oldDataPending: true } : {}),
          createdAt: ts(), updatedAt: ts(), ...tag,
        } as ServiceJob;
        dataService.saveJob(job, user.email);
        jobIds.push(id);
        if (v.challan) {
          dataService.saveChallan({
            id: `CHL-${id}`, challanNumber: v.challan, challanKey: '', jobId: id, contractId: contract?.id, customerId, customerName: c.name,
            clientType: c.type, branchId: place.branchId, challanDate: v.date, fileUrl: '', fileName: `Challan_${v.challan}.pdf`,
            uploadedBy: user.email, uploadedByName: user.name, uploadedAt: ts(), status: 'active',
          }, user.email);
        }
        report.created.visits++;
      }
      // Keep each contract's visit counters right
      for (const k of contractIds) {
        const ct = dataService.getContractById(k.id);
        const scheduled = dataService.getJobs().filter((j) => j.contractId === k.id && j.status !== 'cancelled').length;
        if (ct && scheduled) dataService.saveContract({ ...ct, totalJobsScheduled: scheduled, updatedAt: ts() }, user.email);
      }

      // 5. Opening balance: approved, no tax, own number series
      for (const o of c.openings) {
        const id = await dataService.newRecordId('INV', 'invoice', dataService.getAllInvoices().map((x) => x.id), 'invoices');
        const year = o.asOf.slice(0, 4);
        const seq = await dataService.nextSequence(`opening_balance_${year}`,
          dataService.maxSeqOf(dataService.getAllInvoices().filter((x) => x.invoiceNumber.startsWith(`OB-${year}-`)).map((x) => x.invoiceNumber)));
        const number = `OB-${year}-${String(seq).padStart(4, '0')}`;
        const description = `Opening balance as of ${o.asOf}${o.reference ? ` (${o.reference})` : ''}`;
        const inv: Invoice = {
          id, invoiceNumber: number, invoiceType: 'standard_service', billingAccount: isCo ? 'tax' : 'cash', isOpeningBalance: true,
          customerType: c.type, customerId, customerName: c.name, customerNtn: c.ntn, customerStrn: c.strn, billingAddress: c.address,
          issueDate: o.asOf, dueDate: o.due, jurisdiction: 'sindh_srb',
          lineItems: [{ id: `li_${id}`, description, serviceCategory: 'Opening balance', quantity: 1, unitPrice: o.amount, amount: o.amount, taxRatePercent: 0, taxAmount: 0, totalWithTax: o.amount }],
          subtotal: o.amount, taxTotal: 0, grossPayable: o.amount, amountPaid: 0, customerWhtTotal: 0, balanceDue: o.amount,
          status: 'posted', isPosted: true, postedAt: ts(), postedBy: user.name, isApproved: true, approvedBy: user.name, approvedAt: ts(),
          notes: `${description}. Imported from records before the portal.`, createdAt: ts(), updatedAt: ts(), ...tag,
        };
        dataService.saveInvoice(inv, user.email);
        report.created.openings++;
      }
      report.saved.push({ ref: c.ref, customerId, jobIds });
    } catch (err) {
      report.failed.push({ client: `${c.ref} ${c.name}`, message: err instanceof Error ? err.message : String(err) });
    }
  }
  onProgress?.(todo.length, todo.length);
  dataService.logAudit({
    userId: user.uid, userEmail: user.email, action: 'create', entityType: 'client', entityId: batchId, entityTitle: `Old client ${batchId}`,
    details: `Added old client: ${report.created.clients} client(s), ${report.created.sites} site(s), ${report.created.contracts} contract(s), ${report.created.visits} visit(s), ${report.created.openings} opening balance(s)${report.failed.length ? `; ${report.failed.length} failed` : ''}`,
  });
  return report;
}
