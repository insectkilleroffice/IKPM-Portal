// Files the risk assessment report PDF in the client's "Leads & Inspections" folder.

import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import type { Lead } from '../../types/crm';
import type { PortalDocument } from '../../types/document';

export async function fileInspectionReport(lead: Lead, user: { email?: string; displayName?: string }): Promise<PortalDocument | null> {
  if (!lead.inspection || !integrations.cloudinary || (typeof navigator !== 'undefined' && !navigator.onLine)) return null;
  const fileName = pdfGenerator.inspectionReportFileName(lead);
  const stored = await uploadFile(await pdfGenerator.inspectionReportPDFBlob(lead), {
    scope: dataService.uploadScopeFor({ kind: 'lead', id: lead.id }, 'risk_assessment'),
    subPath: `${lead.id}/risk-assessment`,
    fileName,
  });
  return dataService.saveDocument(
    {
      id: `DOC-${Date.now()}-${lead.inspection.id}`,
      title: lead.inspection.reportTitle || `Risk Assessment Report - ${lead.companyName || lead.title}`,
      category: 'service_report',
      fileCategory: 'risk_assessment',
      owner: { kind: 'lead', id: lead.id },
      source: 'generated',
      file: stored,
      uploadedBy: user.email || 'admin',
      uploadedByName: user.displayName || 'Staff',
      uploadedAt: new Date().toISOString(),
    },
    user.email
  );
}
