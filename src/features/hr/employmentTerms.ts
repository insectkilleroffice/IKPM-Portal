// Standard wording of the employment letters.
//   Every employee          → general terms (Employment Contract) or probation terms (Probation Letter)
//   CRO, Entomologist,
//   Supervisor, PCO         → their own role-specific terms on top
// issueLetter() saves the result on the letter, so changing this file never changes a letter already issued.

import { formatDate } from '../../lib/formatters';
import type {
  EmployeeLetterKind, EmployeeLetterTerms, EmployeeRole, EmployeeTermsProfile, LetterClause, LetterClauseSection,
} from '../../types/hr';

export const TERMS_PROFILE_LABELS: Record<EmployeeTermsProfile, string> = {
  cro: 'CRO',
  entomologist: 'Entomologist',
  supervisor: 'Supervisor',
  pco: 'PCO / Technician',
  general: 'General terms only',
};

export const termsProfileForRole = (role: EmployeeRole): EmployeeTermsProfile => {
  if (role === 'cro') return 'cro';
  if (role === 'entomologist') return 'entomologist';
  if (role === 'team_leader' || role === 'operations_coordinator') return 'supervisor';
  if (role === 'pco') return 'pco';
  return 'general';
};

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** "two (02) months" */
export function monthsInWords(months: number): string {
  const n = String(months).padStart(2, '0');
  const unit = months === 1 ? 'month' : 'months';
  return NUMBER_WORDS[months] ? `${NUMBER_WORDS[months]} (${n}) ${unit}` : `${months} ${unit}`;
}

export const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`;
const clause = (title: string, body: string): LetterClause => ({ title, body });

// ---------------------------------------------------------------------------
// General terms: every employee, whatever their position
// ---------------------------------------------------------------------------
const generalClauses = (t: EmployeeLetterTerms): LetterClause[] => [
  clause('Working Hours', 'Every employee must complete their assigned working hours and follow the official duty schedule established by the organization.'),
  clause('Punctuality & Attendance', 'Employees must maintain punctuality, regular attendance, and comply with company attendance and leave policies.'),
  clause('Task Completion', 'All assigned tasks and responsibilities must be completed within the allocated time and given deadlines. Any delay, difficulty, or inability to complete a task must be communicated to the reporting officer in advance.'),
  clause('Reporting & Communication', 'Employees must maintain transparent, honest, and professional communication with their designated reporting officer and provide timely updates regarding their work and responsibilities.'),
  clause('Mandatory Reporting', 'Any unusual situation, complaint, conflict, misconduct, policy violation, suspicious activity, or matter affecting the organization must be immediately reported to the designated reporting officer before taking independent action, except in emergencies requiring immediate action.'),
  clause('Professional Behaviour', 'Every employee must maintain respectful and professional conduct towards management, colleagues, clients, and all other stakeholders. Harassment, bullying, discrimination, abusive language, threats, or misbehaviour are strictly prohibited.'),
  clause('Confidentiality', 'Employees must not disclose, share, copy, or misuse confidential company information, client records, financial information, documents, passwords, or internal matters with unauthorized persons, during or after employment.'),
  clause('Honesty & Transparency', 'Employees must provide accurate information, maintain truthful records, disclose mistakes, and avoid false reporting, concealment, fraud, or unauthorized activities.'),
  clause('Reporting Hierarchy', "All employees must follow the organization's designated reporting structure and respect the authority and responsibilities of their reporting officers."),
  clause('Company Policies', 'Employees must comply with all applicable company policies, procedures, instructions, and standard operating procedures (SOPs) issued by authorized management.'),
  clause('Protection of Company Interests', "Employees must not engage in any activity that may harm the organization's reputation, financial interests, business relationships, operations, or assets. Proven misconduct or negligence may result in disciplinary action and recovery of actual losses in accordance with applicable law."),
  clause('Company Property', 'All company-provided equipment, documents, records, devices, accounts, and other resources must be used responsibly and returned whenever requested or upon separation from employment.'),
  clause('Salary & Payment Method', "Salary shall be paid according to the organization's approved payroll schedule. The organization reserves the right to determine the payment method, whether through bank transfer to the employee's designated account or in cash, subject to applicable laws and proper payment records."),
  clause('Leave & Absence', 'Employees must obtain prior approval for planned leave. Any emergency absence must be communicated to the reporting officer as soon as reasonably possible.'),
  clause('No Unauthorized Commitments', 'Employees must not make unauthorized financial commitments, promises, agreements, discounts, or official representations on behalf of the organization without management approval.'),
  clause('Teamwork & Cooperation', 'Employees are expected to cooperate with colleagues, maintain workplace discipline, respect others, and contribute positively towards organizational objectives.'),
  clause('Resignation & Notice Period', `Employees must submit written resignation and fulfil the applicable notice period in accordance with their employment agreement and applicable law, being ${days(t.noticeDaysProbation)} during probation and ${days(t.noticeDaysPermanent)} after confirmation.`),
  clause('Handover & Clearance', 'Upon resignation or termination, employees must properly hand over all assigned responsibilities, pending work, records, documents, access credentials, and company property to the authorized replacement or representative.'),
  clause('Disciplinary Action', 'Any violation of these terms, misconduct, negligence, dishonesty, or failure to fulfil assigned responsibilities may result in appropriate disciplinary action in accordance with company policy and applicable law.'),
  clause('Probation & Confirmation', t.probationMonths > 0
    ? `Permanent employment will be considered after successful completion of ${monthsInWords(t.probationMonths)}, subject to satisfactory performance, attendance, conduct, and management approval. Confirmation will be communicated in writing.`
    : 'No probation period applies to this appointment. Employment remains subject to satisfactory performance, attendance, conduct, and compliance with these terms.'),
  clause('Policy Compliance & Amendments', 'Employees must comply with reasonable organizational policies and any amendments communicated by management, subject to applicable laws.'),
  clause('General Responsibility', 'Every employee is expected to act honestly, responsibly, professionally, and in the best interests of the organization throughout their employment.'),
];

// ---------------------------------------------------------------------------
// Probation terms: every employee during probation
// ---------------------------------------------------------------------------
const probationGeneralClauses = (t: EmployeeLetterTerms): LetterClause[] => [
  clause('Working Hours', "Employees must complete their assigned daily working hours and follow the organization's official duty schedule."),
  clause('Punctuality & Attendance', 'Employees must maintain punctuality, regular attendance, and comply with company attendance and leave policies.'),
  clause('Task Completion & Responsibility', 'All assigned tasks must be completed within the allocated time and deadlines. Any delay, difficulty, or inability to complete a task must be communicated to the reporting officer in advance.'),
  clause('Reporting & Communication', 'Employees must maintain transparent, honest, and professional communication with their designated reporting officer and provide timely updates regarding assigned work.'),
  clause('Mandatory Reporting', 'Any unusual situation, complaint, conflict, misconduct, policy violation, suspicious activity, or matter affecting the organization must immediately be reported to the designated reporting officer before taking independent action, except in emergencies requiring immediate action.'),
  clause('Professional Behaviour', 'Employees must treat management, colleagues, clients, and other stakeholders respectfully. Harassment, bullying, discrimination, threats, abusive language, or misbehaviour are strictly prohibited.'),
  clause('Confidentiality & Non-Disclosure', 'Employees must not disclose, share, copy, or misuse confidential company information, client records, financial information, documents, passwords, or internal matters with unauthorized persons during or after employment.'),
  clause('Honesty & Transparency', 'Employees must provide accurate information, maintain truthful records, disclose mistakes, and avoid false reporting, concealment, fraud, or unauthorized activities.'),
  clause('Reporting Hierarchy', "Employees must follow the organization's designated reporting structure and respect the authority and responsibilities of their reporting officers."),
  clause('Company Policies', 'Employees must comply with applicable company policies, procedures, instructions, and standard operating procedures (SOPs).'),
  clause('Protection of Company Interests', "Employees must not engage in activities that may harm the organization's reputation, financial interests, business relationships, operations, or assets. Proven misconduct or negligence may result in disciplinary action and recovery of actual losses in accordance with applicable law."),
  clause('Company Property', 'All company-provided equipment, documents, records, devices, accounts, and other resources must be used responsibly and returned whenever requested or upon separation from employment.'),
  clause('Salary & Payment Method', "Salary shall be paid according to the organization's approved payroll schedule. The organization may determine the payment method, whether through bank transfer to the employee's designated account or in cash, subject to applicable laws and proper payment records."),
  clause('Leave & Absence', 'Employees must obtain prior approval for planned leave. Any emergency absence must be communicated to the reporting officer as soon as reasonably possible.'),
  clause('No Unauthorized Commitments', 'Employees must not make financial commitments, promises, agreements, discounts, or official representations on behalf of the organization without management approval.'),
  clause('Teamwork & Cooperation', 'Employees are expected to cooperate with colleagues, maintain workplace discipline, respect others, and contribute positively towards organizational objectives.'),
  clause('Resignation & Notice Period', `Employees must submit written resignation and fulfil the applicable notice period in accordance with their employment agreement and applicable law, being ${days(t.noticeDaysProbation)} during probation.`),
  clause('Handover & Clearance', 'Upon resignation or termination, employees must properly hand over all assigned responsibilities, pending work, records, documents, access credentials, and company property to the authorized replacement or representative.'),
  clause('Disciplinary Action', 'Any violation of these terms, misconduct, negligence, dishonesty, or failure to fulfil assigned responsibilities may result in appropriate disciplinary action in accordance with company policy and applicable law.'),
];

const probationConfirmationClauses = (t: EmployeeLetterTerms): LetterClause[] => [
  clause('Probation Duration', `Every new employee shall undergo an initial probation period of ${monthsInWords(t.probationMonths)}, commencing from their official joining date${t.probationEndDate ? ` (${formatDate(t.joiningDate)} to ${formatDate(t.probationEndDate)})` : ''}.`),
  clause('Performance Evaluation', "During probation, the employee's performance, punctuality, attendance, discipline, professional behaviour, communication, responsibility, and task completion will be evaluated."),
  clause('Permanent Confirmation', 'Upon satisfactory completion of the probation period, permanent employment may be confirmed through written communication from authorized management.'),
  clause('Extension of Probation', 'The organization may extend the probation period if further performance evaluation is required, subject to applicable law and written communication to the employee.'),
  clause('Non-Confirmation', `If the employee's performance, conduct, attendance, or overall suitability is found unsatisfactory, the organization may discontinue employment in accordance with applicable law and agreed employment terms, by giving ${days(t.noticeDaysProbation)} notice or salary in lieu of notice.`),
  clause('General Compliance', 'Employees must follow all reasonable organizational instructions, policies, and procedures throughout the probation period.'),
];

// ---------------------------------------------------------------------------
// Role-specific terms
// ---------------------------------------------------------------------------
const ROLE_CLAUSES: Record<Exclude<EmployeeTermsProfile, 'general'>, LetterClause[]> = {
  cro: [
    clause('Lead & Client Records', 'The CRO must record every lead, meeting, follow-up, and client communication in the company portal on the same working day, accurately and completely. Work that is not recorded may not be counted towards performance.'),
    clause('Ownership of Clients', 'All clients, leads, contact details, and business relationships developed during employment belong to the Company and not to the CRO personally.'),
    clause('Pricing & Discounts', 'The CRO must quote only approved prices and proposal templates. Any discount, free service, or change in commercial terms requires prior approval from authorized management through the approval process.'),
    clause('Proposals & Contracts', 'No proposal or contract binds the Company until approved by authorized management. Scope, price, and visit frequency must be described accurately, and no result or guarantee may be promised beyond what the approved document states.'),
    clause('Handover to Operations', 'After a proposal is accepted, the CRO must hand over complete and correct client and site information to the Operations Manager. Service dates may be promised only after Operations confirms them.'),
    clause('Payments from Clients', 'The CRO must not collect or hold client payments unless authorized in writing. Any amount received must be handed to Accounts on the same working day, with a proper record.'),
    clause('Incentives & Commission', 'Any incentive or commission is payable only where approved in writing by management, and only on amounts actually received by the Company. It may be adjusted where the related sale is cancelled or refunded, subject to applicable law.'),
    clause('Complaints', 'Client complaints must be logged immediately and passed to the Operations Manager. The CRO must not offer compensation, refunds, or free services to settle a complaint without approval.'),
    clause('Gifts & Personal Benefit', 'The CRO must not accept any commission, gift, or personal benefit from a client or supplier in connection with Company business, and must disclose any such offer to management.'),
    clause('Conflict of Interest & Non-Solicitation', 'During employment the CRO must not work for a competitor or arrange pest control work privately. For twelve (12) months after leaving, to the extent permitted by law, the CRO must not use Company information to solicit its clients.'),
  ],
  entomologist: [
    clause('Audit Visits', 'The Entomologist must carry out scheduled, surprise, and random quality audits at the sites and on the dates assigned by management, and must inform management in advance if a visit cannot be made.'),
    clause('Confidentiality of Audit Schedule', 'Audit schedules, especially surprise audits, must not be disclosed to any Supervisor, PCO, client, or other person who has no authority to know them.'),
    clause('Independence & Objectivity', 'Findings must be factual and free of outside influence. Any personal, family, or financial connection with a site, client, or field team, including any client the Entomologist handles or earns incentive on as a CRO, must be disclosed to management before the audit.'),
    clause('Accuracy of Reports', 'The checklist, score, findings, and photographs must be recorded in the company portal and must reflect what was actually observed on site. A false, copied, or fabricated report, or a report for a visit not made, is gross misconduct.'),
    clause('Submission & Verification', 'Each report must be submitted within the time set by management, and any report returned must be corrected promptly. A report is official only after management has verified it.'),
    clause('Client Calls & Technical Detailing', 'The Entomologist must attend client calls and connect with clients as assigned, explain pest problems, treatment methods, and safety precautions accurately, and record each call in the company portal on the same working day.'),
    clause('Limits of Client Communication', 'Audit reports and audit findings may be shared with a client only after management has verified them. The Entomologist must not commit the Company to corrective visits, charges, refunds, or results unless authorized by management.'),
    clause('Technical Standards', 'Audits must assess pest identification, treatment method, chemical selection and dosage, label and MSDS compliance, and device placement against Company SOPs and applicable regulations.'),
    clause('Qualifications', 'The Entomologist must hold and maintain the qualifications and certificates required for the role, provide copies to HR, and immediately report any expiry or loss.'),
    clause('Health & Safety', 'The Entomologist must wear the required protective equipment, follow site safety rules, and immediately report any safety breach, chemical misuse, or incident observed.'),
    clause('Ownership of Work', 'All audit reports, data, photographs, technical methods, and training material prepared during employment belong to the Company and may not be used or published without written approval.'),
    clause('Outside Work', 'During employment the Entomologist must not provide consultancy, audit, or pest control services to any other person or business without prior written approval from management.'),
  ],
  supervisor: [
    clause('Team Leadership', "The Supervisor must lead the assigned PCOs on site and deploy them according to the Operations Manager's schedule, and is responsible for the team's discipline, appearance, and conduct."),
    clause('Attendance Records', 'The Supervisor must mark daily PCO attendance truthfully and on time. Marking false attendance or hiding absence or lateness is gross misconduct.'),
    clause('Job Execution', 'Every visit must be attended on schedule and the full scope completed. A job must not be rescheduled, shortened, or cancelled without approval from the Operations Manager.'),
    clause('Job Reports & Challans', 'The Supervisor must submit a complete report for each visit on the same working day, including chemicals and quantities used, photographs, and the challan signed by the client. No one may sign on behalf of a client.'),
    clause('Chemicals & Equipment', 'The Supervisor is responsible for chemicals and equipment issued to the team and must keep accurate records of their use. Any shortage, misuse, or removal must be reported immediately, and proven losses may be recovered in accordance with applicable law.'),
    clause('Safety Compliance', 'The Supervisor must ensure the team wears the protective equipment provided and applies chemicals strictly according to label directions, SOPs, and applicable regulations. Any incident must be reported immediately.'),
    clause('Client Site Conduct', 'The team must follow client site rules and treat client property with care. Complaints must be reported to the Operations Manager immediately, and no commitment may be made to a client without approval.'),
    clause('Cash Collected on Site', 'Cash may be collected only where authorized and must be recorded and handed to Accounts on the same or next working day. The Supervisor is accountable for cash collected, and proven shortages may be recovered in accordance with applicable law.'),
    clause('Training & Performance', 'The Supervisor must ensure PCOs follow SOPs and must report poor performance, misconduct, or training needs to the Operations Manager without delay.'),
    clause('Travel & Fuel Claims', 'Trip, distance, and fuel records must be accurate. A false claim is misconduct and the amount may be recovered in accordance with applicable law.'),
    clause('Outside Work', 'The Supervisor and the team must not carry out private pest control work or arrange services directly with Company clients.'),
  ],
  pco: [
    clause('Field Duties', 'The PCO must carry out the jobs assigned by the Supervisor, including field work at client sites, and must report completed work and any problem to the Supervisor on the same day.'),
    clause('Safety & Protective Equipment', 'The PCO must follow Company SOPs and wear the uniform and protective equipment (PPE) provided at all times on duty.'),
    clause('Chemical Handling', 'Pesticides must be handled, stored, and applied strictly according to label directions and applicable regulations. Misuse or removal of chemicals is gross misconduct.'),
    clause('Equipment & Uniform', 'Uniforms, equipment, chemicals, and any vehicle provided remain Company property and must be kept in good condition and returned on request or when employment ends.'),
    clause('Client Premises', 'The PCO must follow client site rules, treat client property with care, and must not accept cash, gifts, or private work from any client.'),
    clause('Incidents', 'Any accident, spillage, exposure, or client complaint must be reported to the Supervisor immediately.'),
  ],
};

const OFFER_ROLE_SUMMARY: Record<EmployeeTermsProfile, string | undefined> = {
  cro: 'You will be responsible for lead generation, client meetings, proposals, and contract initiation, in line with approved pricing and Company procedures.',
  entomologist: 'You will receive client calls and connect with clients for technical detailing, perform the duties of a CRO, including leads, client meetings, and proposals, and carry out quality audits of client sites, with accurate audit reports submitted for management verification.',
  supervisor: 'You will be responsible for leading PCO teams on site, completing scheduled service visits, and submitting job reports, challans, and daily attendance records.',
  pco: 'You will be responsible for carrying out pest control service visits at client sites under your Supervisor, in line with Company SOPs and safety requirements.',
  general: undefined,
};

function roleSection(profile: EmployeeTermsProfile): LetterClauseSection[] {
  if (profile === 'general') return [];
  return [
    {
      heading: `Role-Specific Terms: ${TERMS_PROFILE_LABELS[profile]}`,
      intro: 'The following terms apply to this position in addition to the general terms above.',
      clauses: ROLE_CLAUSES[profile],
    },
    // The Entomologist also does CRO work, so the CRO terms bind them as well
    ...(profile === 'entomologist' ? [{
      heading: 'CRO Duties',
      intro: 'The Entomologist may also be assigned the duties of a CRO. While performing those duties the following terms apply, and references to the CRO include the Entomologist.',
      clauses: ROLE_CLAUSES.cro,
    }] : []),
  ];
}

const extraSection = (t: EmployeeLetterTerms): LetterClauseSection[] => {
  const clauses = (t.extraTerms || '').split('\n').map((x) => x.trim()).filter(Boolean).map((body) => ({ body }));
  return clauses.length ? [{ heading: 'Additional Terms', clauses }] : [];
};

/** The clause wording for a letter, saved on it when it is issued. */
export function letterClauseSections(kind: EmployeeLetterKind, t: EmployeeLetterTerms, profile: EmployeeTermsProfile): LetterClauseSection[] {
  if (kind === 'offer_letter') {
    const summary = OFFER_ROLE_SUMMARY[profile];
    return [{
      heading: 'Terms of this Offer',
      clauses: [
        ...(summary ? [clause('Your Role', summary)] : []),
        clause('Probation', t.probationMonths > 0
          ? `Your appointment begins with a probation period of ${monthsInWords(t.probationMonths)} from your joining date. Permanent employment may be confirmed in writing, subject to satisfactory performance, attendance, conduct, and management approval.`
          : 'No probation period applies to this appointment.'),
        clause('Notice Period', `Either side may end the employment by giving ${days(t.noticeDaysProbation)} notice during probation and ${days(t.noticeDaysPermanent)} notice after confirmation.`),
        clause('Salary & Payment', "Salary is paid according to the organization's approved payroll schedule, by bank transfer or in cash as the organization determines, after any deductions required by law. Allowances are paid subject to the Company's attendance and payroll rules."),
        clause('Documents on Joining', 'Please bring a copy of your CNIC, two passport-size photographs, educational and experience certificates, and a police character certificate.'),
        clause('Verification', 'This offer is subject to verification of the documents and information you have provided, and may be withdrawn if any of it is found to be incorrect.'),
        clause('Employment Documents', 'On joining you will sign an Employment Contract and a Probation Letter containing the full general and role-specific terms and conditions.'),
        clause('Confidentiality', 'The terms of this offer are confidential and must not be shared with any third party.'),
      ],
    }, ...extraSection(t)];
  }
  if (kind === 'employment_contract') {
    return [
      {
        heading: 'General Terms & Conditions of Employment',
        intro: 'The following terms and conditions shall apply equally to all employees, regardless of their designation, department, or position within the organization.',
        clauses: generalClauses(t),
      },
      ...roleSection(profile),
      {
        heading: 'Termination & Governing Law',
        clauses: [
          clause('Termination by Notice', `Either party may end this contract by giving ${days(t.noticeDaysProbation)} notice during probation and ${days(t.noticeDaysPermanent)} notice after confirmation, or salary in lieu of notice.`),
          clause('Termination for Gross Misconduct', 'The Company may end employment without notice for gross misconduct, including theft, fraud, violence, falsification of records, disclosure of confidential information, or a serious safety breach, after giving the employee an opportunity to explain.'),
          clause('Governing Law', 'This contract is governed by the laws of Pakistan.'),
        ],
      },
      ...extraSection(t),
    ];
  }
  if (kind === 'probation_letter') {
    return [
      {
        heading: 'General Terms & Conditions',
        intro: 'The following terms and conditions shall apply to all employees during their probation period, regardless of their designation, department, or position within the organization.',
        clauses: probationGeneralClauses(t),
      },
      { heading: 'Probation & Employment Confirmation', clauses: probationConfirmationClauses(t) },
      ...roleSection(profile).map((s) => (s.heading === 'CRO Duties' ? s : { ...s, intro: 'The following terms apply to this position in addition to the terms above.' })),
      ...extraSection(t),
    ];
  }
  return extraSection(t);
}
