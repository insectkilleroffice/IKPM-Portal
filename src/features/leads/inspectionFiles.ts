// Files risk assessment and meeting reports into the client's / lead's "Leads & Inspections" folder.
// Works seamlessly with Cloudinary cloud storage or local fallback storage.

import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import type { Lead } from '../../types/crm';
import type { PortalDocument, DocumentOwner, StoredFile } from '../../types/document';

export async function fileInspectionReport(
  lead: Lead,
  user: { email?: string; displayName?: string }
): Promise<PortalDocument | null> {
  const insp = lead.siteInspection || lead.inspection;
  if (!insp) return null;

  try {
    const blob = await pdfGenerator.inspectionReportPDFBlob(lead);
    const fileName = pdfGenerator.inspectionReportFileName(lead);
    const owner: DocumentOwner = lead.existingCustomerId
      ? { kind: 'client', id: lead.existingCustomerId }
      : { kind: 'lead', id: lead.id };

    let stored: StoredFile = {
      url: typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '',
      fileName,
      fileSize: blob.size,
      fileType: blob.type || 'application/pdf',
      storage: 'local',
    };

    if (integrations.cloudinary && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        stored = await uploadFile(blob, {
          scope: dataService.uploadScopeFor(owner, 'risk_assessment'),
          subPath: `${lead.id}/risk-assessment`,
          fileName,
        });
      } catch (err) {
        console.warn('Cloudinary upload fallback to local storage:', err);
      }
    }

    const title = insp.reportTitle || `Site Inspection Report - ${lead.companyName || lead.title}`;
    return dataService.saveDocument(
      {
        id: `DOC-${Date.now()}-${insp.id || lead.id}`,
        title,
        category: 'service_report',
        fileCategory: 'risk_assessment',
        owner,
        source: 'generated',
        file: stored,
        uploadedBy: user.email || 'admin',
        uploadedByName: user.displayName || 'Operations Coordinator',
        uploadedAt: new Date().toISOString(),
      },
      user.email
    );
  } catch (err) {
    console.error('Error generating and filing inspection report:', err);
    return null;
  }
}

export async function fileMeetingReport(
  lead: Lead,
  user: { email?: string; displayName?: string }
): Promise<PortalDocument | null> {
  const mtg = lead.inspection;
  if (!mtg) return null;

  try {
    const blob = await pdfGenerator.meetingReportPDFBlob(lead);
    const fileName = pdfGenerator.meetingReportFileName(lead);
    const owner: DocumentOwner = lead.existingCustomerId
      ? { kind: 'client', id: lead.existingCustomerId }
      : { kind: 'lead', id: lead.id };

    let stored: StoredFile = {
      url: typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : '',
      fileName,
      fileSize: blob.size,
      fileType: blob.type || 'application/pdf',
      storage: 'local',
    };

    if (integrations.cloudinary && (typeof navigator === 'undefined' || navigator.onLine)) {
      try {
        stored = await uploadFile(blob, {
          scope: dataService.uploadScopeFor(owner, 'inspection_report'),
          subPath: `${lead.id}/meeting-reports`,
          fileName,
        });
      } catch (err) {
        console.warn('Cloudinary upload fallback to local storage:', err);
      }
    }

    const title = mtg.reportTitle || `Client Meeting Report - ${lead.companyName || lead.title}`;
    return dataService.saveDocument(
      {
        id: `DOC-${Date.now()}-MTG-${lead.id}`,
        title,
        category: 'service_report',
        fileCategory: 'inspection_report',
        owner,
        source: 'generated',
        file: stored,
        uploadedBy: user.email || 'admin',
        uploadedByName: user.displayName || 'CRO / Operations',
        uploadedAt: new Date().toISOString(),
      },
      user.email
    );
  } catch (err) {
    console.error('Error generating and filing meeting report:', err);
    return null;
  }
}
