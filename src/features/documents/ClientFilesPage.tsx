import React from 'react';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { DriveExplorer } from './DriveExplorer';

export const ClientFilesPage: React.FC = () => {
  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Client Files' }]} />

      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div className="page-title-wrap">
          <h1>Client Files & Records</h1>
          <p className="page-subtitle">
            Google Drive-style client repository: agreements, field reports, invoices, certificates, and legacy scans.
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '1.25rem' }}>
        <DriveExplorer />
      </div>
    </div>
  );
};

export default ClientFilesPage;
