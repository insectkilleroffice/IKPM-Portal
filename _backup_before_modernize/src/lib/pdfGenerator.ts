// Client-side PDF generator for Proposals, Tax Invoices, and Service Reports

import jsPDF from 'jspdf';
import { Proposal } from '../types/proposal';
import { Invoice } from '../types/finance';
import { ServiceJob } from '../types/operations';
import { formatPKR, formatDate } from './formatters';

export const pdfGenerator = {
  // Generate Official IKPM Proposal Document
  generateProposalPDF(proposal: Proposal): void {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const primaryColor = [6, 21, 43]; // IKPM Navy
    const emeraldColor = [16, 185, 129]; // IKPM Emerald
    const textDark = [15, 23, 42];

    // Header Background Accent
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 36, 'F');

    // Brand Title
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('INSECT KILLER PEST MANAGEMENT (IKPM)', 14, 16);

    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(emeraldColor[0], emeraldColor[1], emeraldColor[2]);
    doc.text('PROFESSIONAL INTEGRATED PEST MANAGEMENT & FUMIGATION SERVICES', 14, 22);

    doc.setTextColor(226, 232, 240);
    doc.setFontSize(8);
    doc.text('Web: www.insectkiller.pk | Karachi - Lahore - Islamabad | UAN: +92 300 8291023', 14, 28);

    // Proposal Meta Badge
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(145, 8, 52, 20, 2, 2, 'F');
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`PROPOSAL: ${proposal.id}`, 148, 14);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`Revision: R${proposal.revisionNumber} | ${formatDate(proposal.createdAt)}`, 148, 20);
    doc.text(`Status: ${proposal.status.toUpperCase()}`, 148, 25);

    // Section 1: Client Information
    let y = 46;
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('CLIENT & SITE INFORMATION', 14, y);

    doc.setDrawColor(226, 232, 240);
    doc.line(14, y + 2, 196, y + 2);

    y += 8;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text('Client / Organization:', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(`${proposal.customerName} (${proposal.customerType.toUpperCase()})`, 54, y);

    if (proposal.branchName) {
      y += 5;
      doc.setFont('helvetica', 'bold');
      doc.text('Branch / Location:', 14, y);
      doc.setFont('helvetica', 'normal');
      doc.text(proposal.branchName, 54, y);
    }

    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('Service Site Address:', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(proposal.siteAddress || 'Main Premises', 54, y);

    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.text('Prepared By:', 14, y);
    doc.setFont('helvetica', 'normal');
    doc.text(proposal.preparedByName, 54, y);

    // Section 2: Scope of Work
    y += 10;
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('SCOPE OF WORK & TREATMENT METHODOLOGY', 14, y);
    doc.line(14, y + 2, 196, y + 2);

    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    const splitScope = doc.splitTextToSize(proposal.scopeOfWork, 182);
    doc.text(splitScope, 14, y);
    y += splitScope.length * 4.5 + 4;

    // Section 3: Line Items Table
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('SERVICE PRICING BREAKDOWN', 14, y);
    doc.line(14, y + 2, 196, y + 2);

    y += 6;
    // Table Header
    doc.setFillColor(241, 245, 249);
    doc.rect(14, y, 182, 7, 'F');
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.text('Service & Target Pest', 16, y + 4.5);
    doc.text('Method & Chemical Preset', 80, y + 4.5);
    doc.text('Qty', 142, y + 4.5);
    doc.text('Unit Price', 155, y + 4.5);
    doc.text('Total (PKR)', 180, y + 4.5);

    y += 7;
    doc.setFont('helvetica', 'normal');
    proposal.lineItems.forEach((item) => {
      doc.text(item.serviceName, 16, y + 4.5);
      doc.text(`${item.treatmentMethod} (${item.chemicalsSuggested})`.slice(0, 36), 80, y + 4.5);
      doc.text(String(item.quantity), 142, y + 4.5);
      doc.text(formatPKR(item.unitPrice).replace('PKR ', ''), 155, y + 4.5);
      doc.text(formatPKR(item.totalPrice).replace('PKR ', ''), 180, y + 4.5);
      y += 6;
    });

    // Summary Totals Box
    y += 4;
    doc.setDrawColor(203, 213, 225);
    doc.line(125, y, 196, y);
    y += 5;

    doc.setFontSize(8.5);
    doc.text('Subtotal:', 125, y);
    doc.text(formatPKR(proposal.subtotal), 170, y);

    if (proposal.discountPercent > 0) {
      y += 5;
      doc.text(`Discount (${proposal.discountPercent}%):`, 125, y);
      doc.text(`- ${formatPKR(proposal.discountAmount)}`, 170, y);
    }

    if (proposal.taxPercent > 0) {
      y += 5;
      doc.text(`Sales Tax (${proposal.taxPercent}%):`, 125, y);
      doc.text(formatPKR(proposal.taxAmount), 170, y);
    }

    y += 6;
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(125, y - 4, 71, 8, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text('Grand Total:', 128, y + 1.5);
    doc.text(formatPKR(proposal.totalAmount), 165, y + 1.5);

    // Terms & Conditions
    y += 14;
    doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text('TERMS & WARRANTY CONDITIONS', 14, y);
    doc.line(14, y + 2, 196, y + 2);

    y += 6;
    doc.setTextColor(textDark[0], textDark[1], textDark[2]);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`1. Payment Terms: ${proposal.paymentTerms}`, 14, y);
    doc.text(`2. Proposal Validity: ${proposal.validityDays} Days from submission.`, 14, y + 4);
    doc.text(`3. Warranty Coverage: ${proposal.warrantyPeriodMonths || 12} Months free revisit guarantee against targeted pest recurrence.`, 14, y + 8);
    doc.text('4. Official Tax: Rates are subject to applicable provincial sales tax rules (SRB / PRA / FBR).', 14, y + 12);

    // Signatures
    y += 24;
    doc.setDrawColor(148, 163, 184);
    doc.line(14, y, 74, y);
    doc.line(136, y, 196, y);

    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('For: Insect Killer Pest Management (IKPM)', 14, y + 4);
    doc.text('Client Acceptance Signature & Stamp', 136, y + 4);

    // Save and download
    doc.save(`IKPM_Proposal_${proposal.id}_R${proposal.revisionNumber}.pdf`);
  },

  // Generate Service Job Verified Report PDF
  generateJobReportPDF(job: ServiceJob): void {
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const primaryColor = [6, 21, 43];
    doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
    doc.rect(0, 0, 210, 30, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text('IKPM FIELD SERVICE & CHEMICAL VERIFICATION REPORT', 14, 16);

    doc.setFontSize(8);
    doc.text(`JOB ID: ${job.id} | Date: ${formatDate(job.scheduledDate)} | Status: ${job.status.toUpperCase()}`, 14, 23);

    let y = 40;
    doc.setTextColor(15, 23, 42);
    doc.setFontSize(9);
    doc.text(`Customer: ${job.customerName}`, 14, y);
    doc.text(`Site: ${job.siteName} (${job.siteAddress})`, 14, y + 5);
    doc.text(`Lead PCO: ${job.leadPcoName}`, 14, y + 10);
    doc.text(`Assigned Technicians: ${job.assignedTechnicianNames.join(', ')}`, 14, y + 15);

    y += 24;
    doc.setFont('helvetica', 'bold');
    doc.text('CHEMICAL DOSAGE & APPLICATION LOG', 14, y);
    doc.line(14, y + 2, 196, y + 2);

    y += 6;
    doc.setFontSize(8);
    job.chemicalsUsed.forEach((chem) => {
      doc.text(`• ${chem.chemicalName} (${chem.activeIngredient}) - Qty: ${chem.quantityUsed} ${chem.unit} | Batch: ${chem.batchNumber} | Target: ${chem.targetPest}`, 14, y);
      y += 5;
    });

    y += 10;
    doc.setFont('helvetica', 'bold');
    doc.text('SUPERVISOR QUALITY VERIFICATION', 14, y);
    doc.line(14, y + 2, 196, y + 2);

    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.text(`Supervisor: ${job.supervisorVerification?.supervisorName || 'Pending QC Inspection'}`, 14, y);
    doc.text(`Rating: ${job.supervisorVerification?.qcRating?.toUpperCase() || 'Pending'}`, 14, y + 5);
    doc.text(`Customer Sign-Off: ${job.customerSignOff?.acknowledgedByName || 'Acknowledged Digitally'} (Rating: ${job.customerSignOff?.feedbackRating || 5}/5)`, 14, y + 10);

    doc.save(`IKPM_Service_Report_${job.id}.pdf`);
  },
};
