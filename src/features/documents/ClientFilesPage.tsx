import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { DriveExplorer } from './DriveExplorer';

export const ClientFilesPage: React.FC = () => {
  const [params] = useSearchParams();
  const initialPath = params.get('path') || undefined;

  return (
    <div className="animate-fade-in">
      <Breadcrumbs items={[{ label: 'Files' }]} />

      <div className="page-header" style={{ marginBottom: '1.25rem' }}>
        <div className="page-title-wrap">
          <h1>Files</h1>
          <p className="page-subtitle">
            Every client has its own folder (proposals, contracts, documents, service reports, monitoring sheets, invoices, payments and branches). IKPM's own files are kept apart under Company (IKPM).
          </p>
        </div>
      </div>

      <div className="card" style={{ padding: '1.25rem' }}>
        <DriveExplorer key={initialPath || 'root'} initialPath={initialPath} />
      </div>
    </div>
  );
};

export default ClientFilesPage;
