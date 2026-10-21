import type { StoredFile } from './document';
// Customer profile types for Individual Clients, Companies, Branches, Sites, and Contacts

export type CustomerType = 'individual' | 'company';

export type TaxStatus = 'active_filer' | 'non_filer' | 'exempt';

export interface DocumentAttachment {
  id: string;
  title: string;
  category: 'contract' | 'tax_cert' | 'site_map' | 'msds_chemical' | 'id_card' | 'inspection_photo' | 'other';
  fileName: string;
  fileSize: number;
  fileType: string;
  fileUrl: string; // Secure storage or data URL
  uploadedBy: string;
  uploadedByName: string;
  uploadedAt: string;
  linkedEntityType: 'client' | 'company' | 'branch' | 'job' | 'proposal';
  linkedEntityId: string;
  notes?: string;
}

export interface CustomerNote {
  id: string;
  content: string;
  isPrivate: boolean; // Private notes visible only to author
  authorId: string;
  authorName: string;
  createdAt: string;
  updatedAt?: string;
  isRetracted?: boolean;
}

export interface SiteAddress {
  id: string;
  siteName: string;
  customerType: CustomerType;
  customerId: string;
  branchId?: string; // If linked to a corporate branch
  propertyType: 'residential_house' | 'apartment' | 'commercial_office' | 'restaurant_kitchen' | 'factory' | 'warehouse' | 'hospital' | 'school';
  addressLine1: string;
  addressLine2?: string;
  area: string;
  city: string;
  province: 'Sindh' | 'Punjab' | 'Islamabad_ICT' | 'KPK' | 'Balochistan';
  areaSqFt?: number;
  contactPersonName: string;
  contactPersonPhone: string;
  specialInstructions?: string;
  isActive: boolean;
  createdAt: string;
}

export interface CustomerContact {
  id: string;
  fullName: string;
  designation?: string;
  department?: string;
  phone: string;
  mobile: string;
  email?: string;
  isPrimary: boolean;
  notes?: string;
}

// 1. Individual Client Profile
export interface IndividualClient {
  id: string; // Permanent ID: CL-2026-0001
  type: 'individual';
  fullName: string;
  cnic?: string; // Pakistani CNIC 42101-xxxxxxx-x
  primaryPhone: string;
  secondaryPhone?: string;
  email?: string;
  residentialAddress: string;
  city: string;
  area: string;
  province: 'Sindh' | 'Punjab' | 'Islamabad_ICT' | 'KPK' | 'Balochistan';
  taxStatus: TaxStatus;
  status: 'active' | 'inactive' | 'lead';
  assignedRepresentativeId?: string;
  assignedRepresentativeName?: string;
  balance: number; // Current outstanding balance (PKR)
  notes?: CustomerNote[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

// 2. Company Master Profile
export interface CompanyMaster {
  id: string; // Permanent ID: CO-2026-0001
  type: 'company';
  legalCompanyName: string;
  tradeName?: string;
  industrySegment:
    | 'food_restaurant'
    | 'manufacturing_factory'
    | 'corporate_office'
    | 'warehouse_logistics'
    | 'healthcare_pharma'
    | 'hospitality_hotel'
    | 'retail_mall'
    | 'education'
    | 'other';
  ntn?: string; // Pakistani National Tax Number (7 digits + 1 check digit)
  strn?: string; // Sales Tax Registration Number
  headOfficeAddress: string;
  /** Floor plan for the device register / pest management layout (Step 12). */
  floorPlan?: StoredFile;
  city: string;
  province: 'Sindh' | 'Punjab' | 'Islamabad_ICT' | 'KPK' | 'Balochistan';
  website?: string;
  primaryContact: CustomerContact;
  additionalContacts: CustomerContact[];
  billingPreference: 'centralized' | 'branch_wise'; // Centralized company billing or branch-level billing
  taxStatus: TaxStatus;
  totalBranchesCount: number;
  totalActiveContracts: number;
  totalBalance: number; // Consolidated balance across all branches (PKR)
  assignedAccountManagerId?: string;
  assignedAccountManagerName?: string;
  status: 'active' | 'inactive' | 'lead';
  notes?: CustomerNote[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

// 3. Dedicated Company Branch Profile
export interface CompanyBranch {
  id: string; // Permanent ID: BR-2026-0001
  companyId: string; // Ref to Master Company
  companyName: string;
  branchName: string; // e.g. "Gulberg Outlet", "Korangi Plant", "F-7 Branch"
  branchCode?: string; // e.g. "KHI-01", "LHR-03"
  city: string;
  area: string;
  province: 'Sindh' | 'Punjab' | 'Islamabad_ICT' | 'KPK' | 'Balochistan';
  physicalAddress: string;
  /** Floor plan for the device register / pest management layout (Step 12). */
  floorPlan?: StoredFile;
  /** Visit scheduling (Step 14): branch closing time and allowed visit window, "HH:MM". */
  closingTime?: string;
  visitWindowStart?: string;
  visitWindowEnd?: string;
  branchPhone: string;
  branchEmail?: string;
  branchManagerName: string;
  branchManagerPhone: string;
  localNtn?: string; // If branch has separate tax registration
  billingType: 'company_invoice' | 'branch_invoice'; // Whether invoiced to HQ or branch directly
  balance: number; // Branch-specific balance (PKR)
  contacts: CustomerContact[];
  assignedSupervisorId?: string;
  assignedSupervisorName?: string;
  status: 'active' | 'inactive';
  notes?: CustomerNote[];
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}
