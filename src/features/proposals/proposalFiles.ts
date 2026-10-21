// Saves a proposal's PDF into the client's Proposals folder (src/lib/folders.ts decides the path).

import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import type { Proposal } from '../../types/proposal';
import type { PortalDocument } from '../../types/document';

/**
 * Generates the PDF and files it as a document of the proposal. Returns null when file storage
 * isn't configured (the PDF can still be downloaded).
 */
export async function fileProposalPdf(proposal: Proposal, user: { email?: string; displayName?: string }): Promise<PortalDocument | null> {
  if (!integrations.cloudinary || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  const fileName = pdfGenerator.proposalFileName(proposal);
  const stored = await uploadFile(await pdfGenerator.proposalPDFBlob(proposal), {
    scope: dataService.uploadScopeFor({ kind: 'proposal', id: proposal.id }, 'proposal'),
    subPath: proposal.id,
    fileName,
  });
  return dataService.saveDocument(
    {
      id: `DOC-${Date.now()}-${proposal.id}-R${proposal.revisionNumber}`,
      title: `Proposal ${proposal.id} R${proposal.revisionNumber} (${proposal.customerName})`,
      category: 'other',
      fileCategory: 'proposal',
      owner: { kind: 'proposal', id: proposal.id },
      source: 'generated',
      file: stored,
      uploadedBy: user.email || 'admin',
      uploadedByName: user.displayName || 'Staff',
      uploadedAt: new Date().toISOString(),
    },
    user.email
  );
}
