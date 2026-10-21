import React from 'react';
import { dataService } from '../../services/dataService';
import { useAuth } from '../../contexts/AuthContext';
import { canEditCompanyFiles } from '../../lib/permissions';
import {
  categoriesForSubfolder,
  CLIENT_SUBFOLDERS,
  COMPANY_SUBFOLDERS,
  fileCategoryLabel,
  type ClientSubfolder,
  type CompanySubfolder,
} from '../../lib/folders';
import type { FileCategory } from '../../types/folders';
import { useEntities } from './driveUtils';
import { defaultDestination, type Destination } from './destinationUtils';

interface Props {
  value: Destination;
  onChange: (d: Destination) => void;
  /** Hide the scope / client / branch pickers (destination owner is fixed). */
  lockOwner?: boolean;
  /** Keep the same client but allow another branch / folder. */
  lockClient?: boolean;
}

/** Where a file goes: Client vs Company (IKPM), which client / branch, subfolder and type. */
export const FolderDestination: React.FC<Props> = ({ value, onChange, lockOwner, lockClient }) => {
  const { effectiveRole } = useAuth();
  const { companies, clients, branches } = useEntities();
  const canCompany = canEditCompanyFiles(effectiveRole);
  const subfolders = (value.ownerScope === 'company' ? COMPANY_SUBFOLDERS : CLIENT_SUBFOLDERS) as readonly (ClientSubfolder | CompanySubfolder)[];
  const clientBranches = branches.filter((b) => b.companyId === value.clientId);
  const categories = categoriesForSubfolder(value.subfolder, value.ownerScope);
  const set = (patch: Partial<Destination>) => onChange({ ...value, ...patch });

  return (
    <div className="form-grid-2">
      {!lockOwner && !lockClient && (
        <div className="form-group" style={{ gridColumn: '1 / -1' }}>
          <label className="form-label">Belongs to</label>
          <div className="chip-row" style={{ marginBottom: 0 }}>
            <button type="button" className={`chip ${value.ownerScope === 'client' ? 'chip-on' : ''}`} onClick={() => onChange(defaultDestination({ ownerScope: 'client', clientId: value.clientId }))}>
              A client
            </button>
            {canCompany && (
              <button type="button" className={`chip ${value.ownerScope === 'company' ? 'chip-on' : ''}`} onClick={() => onChange(defaultDestination({ ownerScope: 'company' }))}>
                Company (IKPM)
              </button>
            )}
          </div>
        </div>
      )}

      {value.ownerScope === 'client' && !lockOwner && (
        <>
          {!lockClient && (
            <div className="form-group">
              <label className="form-label">Client <span className="required">*</span></label>
              <select className="form-select" value={value.clientId || ''} onChange={(e) => set({ clientId: e.target.value || undefined, branchId: undefined })}>
                <option value="">Choose a client…</option>
                <optgroup label="Companies">
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </optgroup>
                <optgroup label="Individuals">
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name} ({c.id})</option>)}
                </optgroup>
              </select>
            </div>
          )}
          {clientBranches.length > 0 && (
            <div className="form-group">
              <label className="form-label">Branch</label>
              <select className="form-select" value={value.branchId || ''} onChange={(e) => set({ branchId: e.target.value || undefined })}>
                <option value="">Head office / whole company</option>
                {clientBranches.map((b) => <option key={b.id} value={b.id}>{dataService.getBranchById(b.id)?.branchName || b.name}</option>)}
              </select>
            </div>
          )}
        </>
      )}

      <div className="form-group">
        <label className="form-label">Folder</label>
        <select
          className="form-select"
          value={value.subfolder}
          onChange={(e) => {
            const subfolder = e.target.value as Destination['subfolder'];
            set({ subfolder, category: categoriesForSubfolder(subfolder, value.ownerScope)[0] });
          }}
        >
          {subfolders.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>
      <div className="form-group">
        <label className="form-label">Type</label>
        <select className="form-select" value={value.category} onChange={(e) => set({ category: e.target.value as FileCategory })} disabled={categories.length < 2}>
          {categories.map((c) => <option key={c} value={c}>{fileCategoryLabel(c)}</option>)}
        </select>
      </div>
    </div>
  );
};
