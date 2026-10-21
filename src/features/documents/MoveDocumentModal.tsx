import React, { useState } from 'react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { dataService } from '../../services/dataService';
import { documentFolderCategory, parseFolderPath, type ClientSubfolder, type CompanySubfolder } from '../../lib/folders';
import type { PortalDocument } from '../../types/document';
import { FolderDestination } from './FolderDestination';
import { defaultDestination, ownerFor, subfolderOverride, type Destination } from './destinationUtils';

interface Props {
  doc: PortalDocument;
  onClose: () => void;
  onMoved?: (folderPath: string) => void;
}

/**
 * Moves a file to another folder. A filed file stays with its client (or with IKPM);
 * an unfiled one can be given its owner here.
 */
export const MoveDocumentModal: React.FC<Props> = ({ doc, onClose, onMoved }) => {
  const { success, error } = useNotification();
  const { userProfile } = useAuth();
  const filed = Boolean(doc.ownerScope);
  const [dest, setDest] = useState<Destination>(() => {
    const parsed = parseFolderPath(doc.folderPath);
    const current = documentFolderCategory(doc);
    const scope = doc.ownerScope ?? (doc.owner.kind === 'library' ? 'company' : 'client');
    const ownerId = 'id' in doc.owner ? doc.owner.id : undefined;
    const branch = doc.owner.kind === 'branch' && ownerId ? dataService.getBranchById(ownerId) : undefined;
    return defaultDestination({
      ownerScope: scope,
      clientId: doc.clientId ?? (branch ? branch.companyId : doc.owner.kind === 'company' || doc.owner.kind === 'client' ? ownerId : undefined),
      branchId: doc.branchId ?? branch?.id,
      subfolder: (parsed?.subfolder as ClientSubfolder | CompanySubfolder | undefined) ?? current.subfolder,
      category: current.category,
    });
  });

  const owner = ownerFor(dest);

  const move = () => {
    if (!owner) return error('Choose a client', 'Pick the client this file belongs to.');
    try {
      const moved = dataService.moveDocument(
        doc.id,
        { owner, fileCategory: dest.category, subfolder: subfolderOverride(dest), folder: undefined },
        userProfile?.email
      );
      success('Moved', `"${doc.title}" is now in ${dest.subfolder}.`);
      if (moved.folderPath) onMoved?.(moved.folderPath);
      onClose();
    } catch (err) {
      error('Could not move', err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={filed ? 'Move file' : 'Move to folder'}
      subtitle={doc.title}
      maxWidth="560px"
      footer={
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={move} disabled={!owner}>Move here</button>
        </>
      }
    >
      {filed && <div className="info-hint" style={{ marginBottom: '1rem' }}>Files stay with their {doc.ownerScope === 'company' ? 'Company (IKPM) area' : 'client'}. To give a client a copy, upload it in that client's folder.</div>}
      <FolderDestination value={dest} onChange={setDest} lockOwner={filed && doc.ownerScope === 'company'} lockClient={filed} />
    </Modal>
  );
};

export default MoveDocumentModal;
