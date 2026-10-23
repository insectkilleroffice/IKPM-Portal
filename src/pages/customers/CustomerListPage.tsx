import React, { useState, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Building2,
  User,
  Search,
  ChevronRight,
  GitFork,
  MapPin,
  Phone,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { formatPKR, formatNTN, formatCNIC, generatePermanentId } from '../../lib/formatters';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { CompanyMaster, IndividualClient } from '../../types/customer';
import { useDataStore } from '../../hooks/useDataStore';

export const CustomerListPage: React.FC = () => {
  useDataStore(); // re-render when Firestore data arrives
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { success, warning } = useNotification();
  const { userProfile } = useAuth();

  const [activeTab, setActiveTab] = useState<'all' | 'companies' | 'individuals'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCity, setSelectedCity] = useState('all');

  // Modals for creating new profiles
  const [showCompanyModal, setShowCompanyModal] = useState(searchParams.get('action') === 'new_company');
  const [showIndividualModal, setShowIndividualModal] = useState(searchParams.get('action') === 'new_individual');

  // New Company Form state
  const [newCompany, setNewCompany] = useState({
    legalCompanyName: '',
    tradeName: '',
    industrySegment: 'food_restaurant' as const,
    ntn: '',
    strn: '',
    headOfficeAddress: '',
    city: 'Karachi',
    province: 'Sindh' as const,
    billingPreference: 'centralized' as const,
    contactName: '',
    contactPhone: '',
    contactEmail: '',
  });

  // New Individual Form state
  const [newIndividual, setNewIndividual] = useState({
    fullName: '',
    cnic: '',
    primaryPhone: '',
    secondaryPhone: '',
    email: '',
    residentialAddress: '',
    area: '',
    city: 'Karachi',
    province: 'Sindh' as const,
    taxStatus: 'active_filer' as const,
  });

  const companies = dataService.getCompanies();
  const clients = dataService.getClients();

  const filteredCompanies = useMemo(() => {
    return companies.filter((c) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        c.legalCompanyName.toLowerCase().includes(q) ||
        (c.tradeName && c.tradeName.toLowerCase().includes(q)) ||
        c.id.toLowerCase().includes(q) ||
        (c.ntn && c.ntn.includes(q)) ||
        c.primaryContact.phone.includes(q) ||
        c.primaryContact.mobile.includes(q);

      const matchCity = selectedCity === 'all' || c.city === selectedCity;
      return matchSearch && matchCity;
    });
  }, [companies, searchQuery, selectedCity]);

  const filteredClients = useMemo(() => {
    return clients.filter((cl) => {
      const q = searchQuery.toLowerCase();
      const matchSearch =
        cl.fullName.toLowerCase().includes(q) ||
        cl.id.toLowerCase().includes(q) ||
        (cl.cnic && cl.cnic.includes(q)) ||
        cl.primaryPhone.includes(q) ||
        (cl.email && cl.email.toLowerCase().includes(q));

      const matchCity = selectedCity === 'all' || cl.city === selectedCity;
      return matchSearch && matchCity;
    });
  }, [clients, searchQuery, selectedCity]);

  // Handle Company Submission
  const handleCreateCompany = (e: React.FormEvent) => {
    e.preventDefault();
    const dups = dataService.checkDuplicates(newCompany.contactPhone, newCompany.contactEmail, newCompany.ntn);
    if (dups.length > 0) {
      warning('Potential Duplicate Customer Detected', dups[0]);
    }

    const nextId = generatePermanentId('CO', companies.length + 1);
    const created: CompanyMaster = {
      id: nextId,
      type: 'company',
      legalCompanyName: newCompany.legalCompanyName,
      tradeName: newCompany.tradeName || newCompany.legalCompanyName,
      industrySegment: newCompany.industrySegment,
      ntn: newCompany.ntn,
      strn: newCompany.strn,
      headOfficeAddress: newCompany.headOfficeAddress,
      city: newCompany.city,
      province: newCompany.province,
      billingPreference: newCompany.billingPreference,
      taxStatus: 'active_filer',
      totalBranchesCount: 0,
      totalActiveContracts: 0,
      totalBalance: 0,
      status: 'active',
      primaryContact: {
        id: `cont_${Date.now()}`,
        fullName: newCompany.contactName,
        phone: newCompany.contactPhone,
        mobile: newCompany.contactPhone,
        email: newCompany.contactEmail,
        isPrimary: true,
      },
      additionalContacts: [],
      createdAt: new Date().toISOString(),
      createdBy: userProfile?.displayName || 'Admin',
      updatedAt: new Date().toISOString(),
    };

    dataService.saveCompany(created, userProfile?.email);
    success('Company Master Profile Created', `${created.legalCompanyName} (${created.id})`);
    setShowCompanyModal(false);
    navigate(`/customers/company/${created.id}`);
  };

  // Handle Individual Client Submission
  const handleCreateIndividual = (e: React.FormEvent) => {
    e.preventDefault();
    const dups = dataService.checkDuplicates(newIndividual.primaryPhone, newIndividual.email, newIndividual.cnic);
    if (dups.length > 0) {
      warning('Potential Duplicate Client Detected', dups[0]);
    }

    const nextId = generatePermanentId('CL', clients.length + 1);
    const created: IndividualClient = {
      id: nextId,
      type: 'individual',
      fullName: newIndividual.fullName,
      cnic: newIndividual.cnic,
      primaryPhone: newIndividual.primaryPhone,
      secondaryPhone: newIndividual.secondaryPhone,
      email: newIndividual.email,
      residentialAddress: newIndividual.residentialAddress,
      area: newIndividual.area,
      city: newIndividual.city,
      province: newIndividual.province,
      taxStatus: newIndividual.taxStatus,
      status: 'active',
      balance: 0,
      createdAt: new Date().toISOString(),
      createdBy: userProfile?.displayName || 'Admin',
      updatedAt: new Date().toISOString(),
    };

    dataService.saveClient(created, userProfile?.email);
    success('Individual Client Profile Created', `${created.fullName} (${created.id})`);
    setShowIndividualModal(false);
    navigate(`/customers/individual/${created.id}`);
  };

  return (
    <div className="animate-fade-in">
      {/* Breadcrumb Trail */}
      <Breadcrumbs items={[{ label: 'Customer Accounts' }]} />

      {/* Page Header */}
      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Structured Customer Accounts</h1>
          <p className="page-subtitle">
            Master corporate organizations, multi-branch hierarchies, and individual residential profiles.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            className="btn btn-secondary"
            onClick={() => setShowIndividualModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <User size={16} />
            <span>+ Individual Client</span>
          </button>

          <button
            className="btn btn-primary"
            onClick={() => setShowCompanyModal(true)}
            style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Building2 size={16} />
            <span>+ Company Master</span>
          </button>
        </div>
      </div>

      {/* Tabs & Search Filters */}
      <div className="card" style={{ marginBottom: '1.5rem', padding: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '1rem' }}>
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              className={`btn ${activeTab === 'all' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.45rem 1rem', fontSize: '0.825rem' }}
              onClick={() => setActiveTab('all')}
            >
              All Customer Accounts ({companies.length + clients.length})
            </button>
            <button
              className={`btn ${activeTab === 'companies' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.45rem 1rem', fontSize: '0.825rem' }}
              onClick={() => setActiveTab('companies')}
            >
              <Building2 size={15} style={{ marginRight: '4px' }} />
              Companies ({companies.length})
            </button>
            <button
              className={`btn ${activeTab === 'individuals' ? 'btn-primary' : 'btn-secondary'}`}
              style={{ padding: '0.45rem 1rem', fontSize: '0.825rem' }}
              onClick={() => setActiveTab('individuals')}
            >
              <User size={15} style={{ marginRight: '4px' }} />
              Individual Clients ({clients.length})
            </button>
          </div>

          {/* Search Inputs */}
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <div style={{ position: 'relative', width: '260px' }}>
              <Search size={15} style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Filter by name, ID, phone..."
                className="form-input"
                style={{ paddingLeft: '2.2rem', paddingRight: '0.75rem', height: '36px', fontSize: '0.825rem' }}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="form-select"
              style={{ width: '150px', height: '36px', fontSize: '0.825rem' }}
              value={selectedCity}
              onChange={(e) => setSelectedCity(e.target.value)}
            >
              <option value="all">All Cities</option>
              <option value="Karachi">Karachi</option>
              <option value="Lahore">Lahore</option>
              <option value="Islamabad">Islamabad</option>
              <option value="Rawalpindi">Rawalpindi</option>
              <option value="Faisalabad">Faisalabad</option>
            </select>
          </div>
        </div>
      </div>

      {/* Customer Tables */}
      {(activeTab === 'all' || activeTab === 'companies') && filteredCompanies.length > 0 && (
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Building2 size={20} color="var(--ikpm-navy-700)" />
              Master Corporate Companies
            </h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              1 Master Profile per Organization • Multi-Branch Child Hierarchy
            </span>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Company ID & Name</th>
                  <th>Industry / Segment</th>
                  <th>NTN / STRN</th>
                  <th>Head Office / City</th>
                  <th>Branches</th>
                  <th>Primary Contact</th>
                  <th>Outstanding Balance</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredCompanies.map((co) => (
                  <tr key={co.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{co.legalCompanyName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                        {co.id}
                      </div>
                    </td>
                    <td>
                      <span className="badge-status badge-slate">
                        {co.industrySegment.replace('_', ' ')}
                      </span>
                    </td>
                    <td>
                      <div>NTN: {co.ntn ? formatNTN(co.ntn) : '—'}</div>
                      {co.strn && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>STRN: {co.strn}</div>}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <MapPin size={13} color="var(--text-muted)" />
                        <span>{co.city}</span>
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{co.headOfficeAddress}</div>
                    </td>
                    <td>
                      <span className="badge-status badge-navy" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                        <GitFork size={12} />
                        {co.totalBranchesCount} Branches
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{co.primaryContact.fullName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{co.primaryContact.mobile}</div>
                    </td>
                    <td style={{ fontWeight: 700, color: co.totalBalance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                      {formatPKR(co.totalBalance)}
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-emerald"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                        onClick={() => navigate(`/customers/company/${co.id}`)}
                      >
                        <span>View Master & Branches</span>
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {(activeTab === 'all' || activeTab === 'individuals') && filteredClients.length > 0 && (
        <div style={{ marginBottom: '2.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1.15rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <User size={20} color="var(--ikpm-emerald-600)" />
              Individual Clients (Residential & Commercial Single Premises)
            </h2>
            <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
              Complete Individual Profiles & Linked Documents
            </span>
          </div>

          <div className="table-container">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Client ID & Name</th>
                  <th>CNIC Identity</th>
                  <th>Phone & Email</th>
                  <th>Residential Address / Area</th>
                  <th>City</th>
                  <th>Tax Status</th>
                  <th>Balance</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredClients.map((cl) => (
                  <tr key={cl.id}>
                    <td>
                      <div style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{cl.fullName}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--ikpm-emerald-600)', fontFamily: 'monospace' }}>
                        {cl.id}
                      </div>
                    </td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                      {cl.cnic ? formatCNIC(cl.cnic) : '—'}
                    </td>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Phone size={12} color="var(--text-muted)" />
                        <span>{cl.primaryPhone}</span>
                      </div>
                      {cl.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cl.email}</div>}
                    </td>
                    <td>
                      <div>{cl.area}</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{cl.residentialAddress}</div>
                    </td>
                    <td>{cl.city}</td>
                    <td>
                      <span className={`badge-status ${cl.taxStatus === 'active_filer' ? 'badge-emerald' : 'badge-slate'}`}>
                        {cl.taxStatus.replace('_', ' ')}
                      </span>
                    </td>
                    <td style={{ fontWeight: 700, color: cl.balance > 0 ? 'var(--ikpm-rose-500)' : 'var(--ikpm-emerald-600)' }}>
                      {formatPKR(cl.balance)}
                    </td>
                    <td>
                      <button
                        className="btn btn-outline-emerald"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.78rem' }}
                        onClick={() => navigate(`/customers/individual/${cl.id}`)}
                      >
                        <span>View Profile</span>
                        <ChevronRight size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal: New Company Master */}
      <Modal
        isOpen={showCompanyModal}
        onClose={() => setShowCompanyModal(false)}
        title="Create Master Corporate Company Profile"
        subtitle="Every corporate customer has one master profile. Branches are linked children with dedicated profiles."
        maxWidth="680px"
      >
        <form onSubmit={handleCreateCompany}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">
                Legal Company Name <span className="required">*</span>
              </label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. Shan Foods (Private) Limited"
                value={newCompany.legalCompanyName}
                onChange={(e) => setNewCompany({ ...newCompany, legalCompanyName: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Trade / Brand Name</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. Shan Foods"
                value={newCompany.tradeName}
                onChange={(e) => setNewCompany({ ...newCompany, tradeName: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Industry Segment</label>
              <select
                className="form-select"
                value={newCompany.industrySegment}
                onChange={(e) => setNewCompany({ ...newCompany, industrySegment: e.target.value as any })}
              >
                <option value="food_restaurant">Food & Restaurant</option>
                <option value="manufacturing_factory">Factory / Manufacturing</option>
                <option value="corporate_office">Corporate Office</option>
                <option value="warehouse_logistics">Warehouse / Logistics</option>
                <option value="retail_mall">Retail Mall / Supermarket</option>
                <option value="healthcare_pharma">Healthcare / Pharma</option>
                <option value="hospitality_hotel">Hotel & Hospitality</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Pakistani NTN</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. 1234567-8"
                value={newCompany.ntn}
                onChange={(e) => setNewCompany({ ...newCompany, ntn: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">STRN (Sales Tax Reg)</label>
              <input
                type="text"
                className="form-input"
                placeholder="e.g. 17-00-9822-001"
                value={newCompany.strn}
                onChange={(e) => setNewCompany({ ...newCompany, strn: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Head Office City <span className="required">*</span></label>
              <select
                className="form-select"
                value={newCompany.city}
                onChange={(e) => setNewCompany({ ...newCompany, city: e.target.value })}
              >
                <option value="Karachi">Karachi</option>
                <option value="Lahore">Lahore</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Rawalpindi">Rawalpindi</option>
                <option value="Faisalabad">Faisalabad</option>
                <option value="Multan">Multan</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Billing Invoicing Preference</label>
              <select
                className="form-select"
                value={newCompany.billingPreference}
                onChange={(e) => setNewCompany({ ...newCompany, billingPreference: e.target.value as any })}
              >
                <option value="centralized">Centralized (Consolidated to HQ)</option>
                <option value="branch_wise">Branch-Wise (Invoiced Directly to Branches)</option>
              </select>
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Head Office Address <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="e.g. Sector 23, Korangi Industrial Area"
              value={newCompany.headOfficeAddress}
              onChange={(e) => setNewCompany({ ...newCompany, headOfficeAddress: e.target.value })}
            />
          </div>

          {/* Primary Contact */}
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '1rem', marginTop: '1rem' }}>
            <h4 style={{ fontSize: '0.875rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--ikpm-navy-900)' }}>
              Primary Corporate Contact Person
            </h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '1rem' }}>
              <div className="form-group">
                <label className="form-label">Contact Name <span className="required">*</span></label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="e.g. Tariq Mehmood"
                  value={newCompany.contactName}
                  onChange={(e) => setNewCompany({ ...newCompany, contactName: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Mobile Phone <span className="required">*</span></label>
                <input
                  type="text"
                  required
                  className="form-input"
                  placeholder="03001234567"
                  value={newCompany.contactPhone}
                  onChange={(e) => setNewCompany({ ...newCompany, contactPhone: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Official Email</label>
                <input
                  type="email"
                  className="form-input"
                  placeholder="contact@company.com"
                  value={newCompany.contactEmail}
                  onChange={(e) => setNewCompany({ ...newCompany, contactEmail: e.target.value })}
                />
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowCompanyModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Company Master Profile
            </button>
          </div>
        </form>
      </Modal>

      {/* Modal: New Individual Client */}
      <Modal
        isOpen={showIndividualModal}
        onClose={() => setShowIndividualModal(false)}
        title="Create Individual Client Profile"
        subtitle="For residential homeowners, tenants, and single-proprietor clients."
        maxWidth="620px"
      >
        <form onSubmit={handleCreateIndividual}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Full Name <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. Dr. Asadullah Khan"
                value={newIndividual.fullName}
                onChange={(e) => setNewIndividual({ ...newIndividual, fullName: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">CNIC Identity Number</label>
              <input
                type="text"
                className="form-input"
                placeholder="42101-1234567-1"
                value={newIndividual.cnic}
                onChange={(e) => setNewIndividual({ ...newIndividual, cnic: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Primary Mobile Phone <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="03001234567"
                value={newIndividual.primaryPhone}
                onChange={(e) => setNewIndividual({ ...newIndividual, primaryPhone: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Secondary / Landline Phone</label>
              <input
                type="text"
                className="form-input"
                placeholder="021-35840000"
                value={newIndividual.secondaryPhone}
                onChange={(e) => setNewIndividual({ ...newIndividual, secondaryPhone: e.target.value })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Email Address</label>
              <input
                type="email"
                className="form-input"
                placeholder="client@gmail.com"
                value={newIndividual.email}
                onChange={(e) => setNewIndividual({ ...newIndividual, email: e.target.value })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Tax Filer Status</label>
              <select
                className="form-select"
                value={newIndividual.taxStatus}
                onChange={(e) => setNewIndividual({ ...newIndividual, taxStatus: e.target.value as any })}
              >
                <option value="active_filer">Active Filer</option>
                <option value="non_filer">Non-Filer</option>
                <option value="exempt">Tax Exempt</option>
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">City <span className="required">*</span></label>
              <select
                className="form-select"
                value={newIndividual.city}
                onChange={(e) => setNewIndividual({ ...newIndividual, city: e.target.value })}
              >
                <option value="Karachi">Karachi</option>
                <option value="Lahore">Lahore</option>
                <option value="Islamabad">Islamabad</option>
                <option value="Rawalpindi">Rawalpindi</option>
                <option value="Faisalabad">Faisalabad</option>
                <option value="Multan">Multan</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Area / Locality <span className="required">*</span></label>
              <input
                type="text"
                required
                className="form-input"
                placeholder="e.g. DHA Phase 5 / Gulberg"
                value={newIndividual.area}
                onChange={(e) => setNewIndividual({ ...newIndividual, area: e.target.value })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Residential Street Address <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              placeholder="e.g. House 42, 12th Street, Khayaban-e-Mujahid"
              value={newIndividual.residentialAddress}
              onChange={(e) => setNewIndividual({ ...newIndividual, residentialAddress: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowIndividualModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Individual Client
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
