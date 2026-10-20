import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FileSignature,
  Plus,
  Search,
  Calendar,
  AlertTriangle,
  CheckCircle,
  Truck,
  RotateCw,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { StatusBadge } from '../../components/common/StatusBadge';
import { formatPKR, formatDate } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { Contract } from '../../types/operations';

export const ContractsListPage: React.FC = () => {
  const navigate = useNavigate();
  const { success, info } = useNotification();
  const { userProfile } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const contracts = dataService.getContracts();

  const filtered = contracts.filter((c) => {
    const q = searchQuery.toLowerCase();
    return (
      c.id.toLowerCase().includes(q) ||
      c.customerName.toLowerCase().includes(q) ||
      (c.branchName && c.branchName.toLowerCase().includes(q))
    );
  });

  const handleRenewContract = (contract: Contract) => {
    const updated: Contract = {
      ...contract,
      isRenewalInitiated: true,
      status: 'renewed',
    };
    dataService.saveContract(updated, userProfile?.email);
    success('AMC Renewal Initiated', `Renewal process started for contract ${contract.id}.`);
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Contracts & AMC Renewals' }]} />

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Contracts & AMC Maintenance Agreements</h1>
          <p className="page-subtitle">
            Annual maintenance contracts, recurring inspection schedules, and automated 30/60/90-day renewal tracking.
          </p>
        </div>
      </div>

      {/* Contracts Table */}
      <div className="table-container">
        <table className="data-table">
          <thead>
            <tr>
              <th>Contract ID</th>
              <th>Customer Name</th>
              <th>Branch / Location</th>
              <th>Contract Type</th>
              <th>Service Frequency</th>
              <th>Term Period</th>
              <th>Contract Value</th>
              <th>Job Execution</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td style={{ fontWeight: 700, fontFamily: 'monospace' }}>{c.id}</td>
                <td>
                  <div style={{ fontWeight: 600 }}>{c.customerName}</div>
                  <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', textTransform: 'capitalize' }}>
                    {c.customerType}
                  </div>
                </td>
                <td>{c.branchName || 'Company HQ / Primary'}</td>
                <td>
                  <span className={`badge-status ${c.contractType === 'amc_recurring' ? 'badge-emerald' : 'badge-slate'}`}>
                    {c.contractType === 'amc_recurring' ? 'Annual AMC' : 'One-Time'}
                  </span>
                </td>
                <td><span className="badge-status badge-navy">{c.frequency}</span></td>
                <td style={{ fontSize: '0.8rem' }}>
                  <div>Start: {formatDate(c.startDate)}</div>
                  <div style={{ color: 'var(--text-muted)' }}>End: {formatDate(c.endDate)}</div>
                </td>
                <td style={{ fontWeight: 700 }}>{formatPKR(c.totalContractValue)}</td>
                <td>
                  <div style={{ fontSize: '0.8rem', fontWeight: 600 }}>
                    {c.totalJobsCompleted} of {c.totalJobsScheduled} completed
                  </div>
                </td>
                <td><StatusBadge status={c.status} /></td>
                <td>
                  <button
                    className="btn btn-outline-emerald"
                    style={{ padding: '0.3rem 0.65rem', fontSize: '0.75rem' }}
                    onClick={() => handleRenewContract(c)}
                  >
                    <RotateCw size={12} />
                    <span>Renew AMC</span>
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
