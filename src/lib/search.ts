import { canAccessModule, type ModuleKey, type SystemRole } from './permissions';
import { normalizePakistaniPhone } from './formatters';
import type { CompanyMaster, IndividualClient } from '../types/customer';
import type { Lead } from '../types/crm';
import type { ServiceJob, Contract, Challan } from '../types/operations';
import type { Invoice } from '../types/finance';
import type { Proposal } from '../types/proposal';
import type { Complaint } from '../types/complaints';
import type { Employee } from '../types/hr';

export type SearchCategory =
  | 'customers'
  | 'leads'
  | 'jobs'
  | 'invoices'
  | 'challans'
  | 'proposals'
  | 'contracts'
  | 'complaints'
  | 'employees'
  | 'documents';

export interface SearchResultItem {
  key: string;
  category: SearchCategory;
  title: string;
  subtitle: string;
  to: string;
  folderPath?: string;
  metadata?: Record<string, string | number | undefined>;
}

export interface SearchStoreSource {
  getCompanies?: () => CompanyMaster[];
  getClients?: () => IndividualClient[];
  getLeads?: () => Lead[];
  getJobs?: () => ServiceJob[];
  getInvoices?: () => Invoice[];
  getChallans?: () => Challan[];
  getProposals?: () => Proposal[];
  getContracts?: () => Contract[];
  getComplaints?: () => Complaint[];
  getEmployees?: () => Employee[];
}

export function searchAll(
  rawQuery: string,
  role: SystemRole | undefined,
  store: SearchStoreSource,
  options?: { limitPerCategory?: number }
): SearchResultItem[] {
  const q = (rawQuery || '').toLowerCase().trim();
  if (q.length < 2) return [];

  const limit = options?.limitPerCategory || 50;
  const results: SearchResultItem[] = [];
  const can = (m: ModuleKey) => canAccessModule(role, m);

  const phone = normalizePakistaniPhone(q);
  const phoneHit = (p?: string) => Boolean(phone && p && normalizePakistaniPhone(p).includes(phone));
  const cleanQ = q.replace(/[^a-z0-9]/g, '');

  // 1. Customers
  if (can('customers')) {
    let count = 0;
    const companies = store.getCompanies ? store.getCompanies() : [];
    companies.forEach((co: CompanyMaster) => {
      if (count >= limit) return;
      if (
        co.legalCompanyName.toLowerCase().includes(q) ||
        co.id.toLowerCase().includes(q) ||
        co.ntn?.includes(q) ||
        phoneHit(co.primaryContact?.mobile)
      ) {
        results.push({
          key: co.id,
          category: 'customers',
          title: co.legalCompanyName,
          subtitle: `Company • ${co.city || 'Pakistan'} • NTN: ${co.ntn || '—'}`,
          to: `/customers/company/${co.id}`,
        });
        count++;
      }
    });

    const clients = store.getClients ? store.getClients() : [];
    clients.forEach((c: IndividualClient) => {
      if (count >= limit) return;
      if (
        c.fullName.toLowerCase().includes(q) ||
        c.id.toLowerCase().includes(q) ||
        c.cnic?.includes(q) ||
        phoneHit(c.primaryPhone)
      ) {
        results.push({
          key: c.id,
          category: 'customers',
          title: c.fullName,
          subtitle: `Individual Client • ${c.primaryPhone || '—'}`,
          to: `/customers/individual/${c.id}`,
        });
        count++;
      }
    });
  }

  // 2. Leads (CRM)
  if (can('crm')) {
    let count = 0;
    const leads = store.getLeads ? store.getLeads() : [];
    leads.forEach((lead: Lead) => {
      if (count >= limit) return;
      if (
        lead.title.toLowerCase().includes(q) ||
        lead.companyName?.toLowerCase().includes(q) ||
        lead.id.toLowerCase().includes(q) ||
        lead.phone?.includes(q) ||
        phoneHit(lead.phone)
      ) {
        results.push({
          key: lead.id,
          category: 'leads',
          title: lead.title,
          subtitle: `Lead • Stage: ${lead.stage} • ${lead.phone || ''}`,
          to: `/crm?lead=${lead.id}`,
        });
        count++;
      }
    });
  }

  // 3. Service Jobs
  if (can('jobs') || can('pco')) {
    let count = 0;
    const jobs = store.getJobs ? store.getJobs() : [];
    jobs.forEach((job: ServiceJob) => {
      if (count >= limit) return;
      if (
        job.id.toLowerCase().includes(q) ||
        job.customerName.toLowerCase().includes(q) ||
        job.contractId?.toLowerCase().includes(q) ||
        (job.challanNumber && job.challanNumber.toLowerCase().includes(q))
      ) {
        results.push({
          key: job.id,
          category: 'jobs',
          title: `Job ${job.id} — ${job.customerName}`,
          subtitle: `Status: ${job.status} • Date: ${job.scheduledDate} ${job.challanNumber ? `• Challan: ${job.challanNumber}` : ''}`,
          to: `/operations/jobs?job=${job.id}`,
        });
        count++;
      }
    });
  }

  // 4. Invoices
  if (can('invoices')) {
    let count = 0;
    const invoices = store.getInvoices ? store.getInvoices() : [];
    invoices.forEach((inv: Invoice) => {
      if (count >= limit) return;
      if (
        inv.id.toLowerCase().includes(q) ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.customerName.toLowerCase().includes(q)
      ) {
        results.push({
          key: inv.id,
          category: 'invoices',
          title: `Invoice ${inv.invoiceNumber} — ${inv.customerName}`,
          subtitle: `Gross: PKR ${inv.grossPayable?.toLocaleString() ?? 0} • Status: ${inv.status}`,
          to: `/finance/invoices?invoice=${inv.id}`,
        });
        count++;
      }
    });
  }

  // 5. Challans
  if (can('challans') || can('jobs') || can('invoices')) {
    let count = 0;
    const challans = store.getChallans ? store.getChallans() : [];
    challans.forEach((ch: Challan) => {
      if (count >= limit) return;
      if (
        ch.challanNumber.toLowerCase().includes(q) ||
        ch.challanKey.includes(cleanQ) ||
        ch.customerName.toLowerCase().includes(q) ||
        ch.jobId.toLowerCase().includes(q)
      ) {
        results.push({
          key: ch.id,
          category: 'challans',
          title: `Challan ${ch.challanNumber}`,
          subtitle: `Client: ${ch.customerName} • Job: ${ch.jobId} • Date: ${ch.challanDate}`,
          to: `/operations/challans?q=${encodeURIComponent(ch.challanNumber)}`,
        });
        count++;
      }
    });
  }

  // 6. Proposals & Contracts
  if (can('proposals')) {
    let count = 0;
    const proposals = store.getProposals ? store.getProposals() : [];
    proposals.forEach((prop: Proposal) => {
      if (count >= limit) return;
      if (
        prop.id.toLowerCase().includes(q) ||
        prop.customerName.toLowerCase().includes(q) ||
        prop.leadId?.toLowerCase().includes(q)
      ) {
        results.push({
          key: prop.id,
          category: 'proposals',
          title: `Proposal ${prop.id} — ${prop.customerName}`,
          subtitle: `Status: ${prop.status} • Total: PKR ${prop.totalAmount?.toLocaleString() ?? 0}`,
          to: `/proposals?proposal=${prop.id}`,
        });
        count++;
      }
    });
  }

  if (can('contracts')) {
    let count = 0;
    const contracts = store.getContracts ? store.getContracts() : [];
    contracts.forEach((con: Contract) => {
      if (count >= limit) return;
      if (
        con.id.toLowerCase().includes(q) ||
        con.customerName.toLowerCase().includes(q) ||
        con.proposalId?.toLowerCase().includes(q)
      ) {
        results.push({
          key: con.id,
          category: 'contracts',
          title: `Contract ${con.id} — ${con.customerName}`,
          subtitle: `Status: ${con.status} • Visits: ${con.frequency}`,
          to: `/contracts?contract=${con.id}`,
        });
        count++;
      }
    });
  }

  // 7. Complaints
  if (can('complaints')) {
    let count = 0;
    const complaints = store.getComplaints ? store.getComplaints() : [];
    complaints.forEach((comp: Complaint) => {
      if (count >= limit) return;
      if (
        comp.id.toLowerCase().includes(q) ||
        comp.customerName.toLowerCase().includes(q) ||
        comp.description?.toLowerCase().includes(q)
      ) {
        results.push({
          key: comp.id,
          category: 'complaints',
          title: `Complaint ${comp.id} — ${comp.customerName}`,
          subtitle: `Status: ${comp.status} • Priority: ${comp.priority} • Category: ${comp.category}`,
          to: `/complaints?complaint=${comp.id}`,
        });
        count++;
      }
    });
  }

  // 8. Employees (HR & Accounts & Super Admin only)
  if (can('hr') || role === 'super_admin' || role === 'admin') {
    let count = 0;
    const employees = store.getEmployees ? store.getEmployees() : [];
    employees.forEach((emp: Employee) => {
      if (count >= limit) return;
      if (
        emp.name.toLowerCase().includes(q) ||
        emp.id.toLowerCase().includes(q) ||
        emp.phone.includes(q) ||
        phoneHit(emp.phone)
      ) {
        results.push({
          key: emp.id,
          category: 'employees',
          title: `Employee ${emp.name} (${emp.id})`,
          subtitle: `Role: ${emp.role} • Dept: ${emp.department} • Status: ${emp.status}`,
          to: `/hr/employees?emp=${emp.id}`,
        });
        count++;
      }
    });
  }

  return results;
}
