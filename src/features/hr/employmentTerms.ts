// Standard wording of the employment letters.
//   Every employee          → general terms (Employment Agreement) or probation terms (Probation Letter)
//   What the person does    → job-specific terms on top, one section per duty (an Entomologist in
//                             Operations who also talks to clients gets the terms for both duties)
// issueLetter() saves the result on the letter, so changing this file never changes a letter already issued.

import { formatDate } from '../../lib/formatters';
import {
  EMPLOYEE_DUTY_LABELS,
  type EmployeeDuty, type EmployeeLetterKind, type EmployeeLetterTerms, type EmployeeRole, type LetterClause, type LetterClauseSection,
} from '../../types/hr';

/** The duties usually ticked for a job; HR can change them for each person. */
export const defaultDutiesForRole = (role: EmployeeRole): EmployeeDuty[] => {
  if (role === 'cro') return ['sales'];
  if (role === 'entomologist') return ['site_audits', 'client_detailing', 'sales'];
  if (role === 'team_leader' || role === 'operations_coordinator') return ['field_supervision'];
  if (role === 'pco') return ['field_service'];
  if (role === 'accounts') return ['finance_accounts'];
  return [];
};

/** The department usually chosen for a job. */
export const defaultDepartmentForRole = (role: EmployeeRole): string => {
  if (role === 'cro') return 'Sales';
  if (role === 'accounts') return 'Finance';
  return 'Operations';
};

/** "Their duties include ... ": printed in the particulars of the agreement and probation letter. */
export function dutiesSentence(t: EmployeeLetterTerms, whose: string): string {
  const labels = (t.duties ?? []).map((d) => EMPLOYEE_DUTY_LABELS[d]);
  const list = labels.length > 1 ? `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}` : labels[0];
  const description = t.jobDescription?.trim();
  return [
    list && `${whose} duties include ${list}.`,
    description && (/[.!?]$/.test(description) ? description : `${description}.`),
  ].filter(Boolean).join(' ');
}

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
  clause('Resignation & Notice Period', `Employees must submit written resignation and fulfil the applicable notice period in accordance with their employment agreement and applicable law, being ${days(t.noticeDaysProbation)} during probation and ${days(t.noticeDaysPermanent)} after becoming permanent.`),
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
// Job-specific terms: one set per duty
// ---------------------------------------------------------------------------
const DUTY_CLAUSES: Record<EmployeeDuty, LetterClause[]> = {
  sales: [
    clause('Lead & Client Records', 'The Employee must record every lead, meeting, follow-up, and client communication in the company portal on the same working day, accurately and completely. Work that is not recorded may not be counted towards performance.'),
    clause('Ownership of Clients', 'All clients, leads, contact details, and business relationships developed during employment belong to the Company and not to the Employee personally.'),
    clause('Pricing & Discounts', 'The Employee must quote only approved prices and proposal templates. Any discount, free service, or change in commercial terms requires prior approval from authorized management through the approval process.'),
    clause('Proposals & Contracts', 'No proposal or contract binds the Company until approved by authorized management. Scope, price, and visit frequency must be described accurately, and no result or guarantee may be promised beyond what the approved document states.'),
    clause('Handover to Operations', 'After a proposal is accepted, the Employee must hand over complete and correct client and site information to the Operations Manager. Service dates may be promised only after Operations confirms them.'),
    clause('Payments from Clients', 'The Employee must not collect or hold client payments unless authorized in writing. Any amount received must be handed to Accounts on the same working day, with a proper record.'),
    clause('Incentives & Commission', 'Any incentive or commission is payable only where approved in writing by management, and only on amounts actually received by the Company. It may be adjusted where the related sale is cancelled or refunded, subject to applicable law.'),
    clause('Complaints', 'Client complaints must be logged immediately and passed to the Operations Manager. The Employee must not offer compensation, refunds, or free services to settle a complaint without approval.'),
    clause('Gifts & Personal Benefit', 'The Employee must not accept any commission, gift, or personal benefit from a client or supplier in connection with Company business, and must disclose any such offer to management.'),
    clause('Conflict of Interest & Non-Solicitation', 'During employment the Employee must not work for a competitor or arrange pest control work privately. For twelve (12) months after leaving, to the extent permitted by law, the Employee must not use Company information to solicit its clients.'),
  ],
  site_audits: [
    clause('Audit Visits', 'The Employee must carry out scheduled, surprise, and random quality audits at the sites and on the dates assigned by management, and must inform management in advance if a visit cannot be made.'),
    clause('Confidentiality of Audit Schedule', 'Audit schedules, especially surprise audits, must not be disclosed to any Supervisor, PCO, client, or other person who has no authority to know them.'),
    clause('Independence & Objectivity', 'Findings must be factual and free of outside influence. Any personal, family, or financial connection with a site, client, or field team, including any client the Employee handles or earns incentive on, must be disclosed to management before the audit.'),
    clause('Accuracy of Reports', 'The checklist, score, findings, and photographs must be recorded in the company portal and must reflect what was actually observed on site. A false, copied, or fabricated report, or a report for a visit not made, is gross misconduct.'),
    clause('Submission & Verification', 'Each report must be submitted within the time set by management, and any report returned must be corrected promptly. A report is official only after management has verified it.'),
    clause('Technical Standards', 'Audits must assess pest identification, treatment method, chemical selection and dosage, label and MSDS compliance, and device placement against Company SOPs and applicable regulations.'),
    clause('Qualifications', 'The Employee must hold and maintain the qualifications and certificates required for the role, provide copies to HR, and immediately report any expiry or loss.'),
    clause('Health & Safety', 'The Employee must wear the required protective equipment, follow site safety rules, and immediately report any safety breach, chemical misuse, or incident observed.'),
    clause('Ownership of Work', 'All audit reports, data, photographs, technical methods, and training material prepared during employment belong to the Company and may not be used or published without written approval.'),
    clause('Outside Work', 'During employment the Employee must not provide consultancy, audit, or pest control services to any other person or business without prior written approval from management.'),
  ],
  field_supervision: [
    clause('Team Leadership', "The Employee must lead the assigned PCOs on site and deploy them according to the Operations Manager's schedule, and is responsible for the team's discipline, appearance, and conduct."),
    clause('Attendance Records', 'The Employee must mark daily PCO attendance truthfully and on time. Marking false attendance or hiding absence or lateness is gross misconduct.'),
    clause('Job Execution', 'Every visit must be attended on schedule and the full scope completed. A job must not be rescheduled, shortened, or cancelled without approval from the Operations Manager.'),
    clause('Job Reports & Challans', 'The Employee must submit a complete report for each visit on the same working day, including chemicals and quantities used, photographs, and the challan signed by the client. No one may sign on behalf of a client.'),
    clause('Chemicals & Equipment', 'The Employee is responsible for chemicals and equipment issued to the team and must keep accurate records of their use. Any shortage, misuse, or removal must be reported immediately, and proven losses may be recovered in accordance with applicable law.'),
    clause('Safety Compliance', 'The Employee must ensure the team wears the protective equipment provided and applies chemicals strictly according to label directions, SOPs, and applicable regulations. Any incident must be reported immediately.'),
    clause('Client Site Conduct', 'The team must follow client site rules and treat client property with care. Complaints must be reported to the Operations Manager immediately, and no commitment may be made to a client without approval.'),
    clause('Cash Collected on Site', 'Cash may be collected only where authorized and must be recorded and handed to Accounts on the same or next working day. The Employee is accountable for cash collected, and proven shortages may be recovered in accordance with applicable law.'),
    clause('Training & Performance', 'The Employee must ensure PCOs follow SOPs and must report poor performance, misconduct, or training needs to the Operations Manager without delay.'),
    clause('Travel & Fuel Claims', 'Trip, distance, and fuel records must be accurate. A false claim is misconduct and the amount may be recovered in accordance with applicable law.'),
    clause('Outside Work', 'The Employee and the team must not carry out private pest control work or arrange services directly with Company clients.'),
  ],
  field_service: [
    clause('Field Duties', 'The Employee must carry out the jobs assigned by the Supervisor, including field work at client sites, and must report completed work and any problem to the Supervisor on the same day.'),
    clause('Safety & Protective Equipment', 'The Employee must follow Company SOPs and wear the uniform and protective equipment (PPE) provided at all times on duty.'),
    clause('Chemical Handling', 'Pesticides must be handled, stored, and applied strictly according to label directions and applicable regulations. Misuse or removal of chemicals is gross misconduct.'),
    clause('Equipment & Uniform', 'Uniforms, equipment, chemicals, and any vehicle provided remain Company property and must be kept in good condition and returned on request or when employment ends.'),
    clause('Client Premises', 'The Employee must follow client site rules, treat client property with care, and must not accept cash, gifts, or private work from any client.'),
    clause('Incidents', 'Any accident, spillage, exposure, or client complaint must be reported to the Supervisor immediately.'),
  ],
  client_detailing: [
    clause('Client Calls & Technical Detailing', 'The Employee must attend client calls and connect with clients as assigned, explain pest problems, treatment methods, and safety precautions accurately, and record each call in the company portal on the same working day.'),
    clause('Limits of Client Communication', 'Audit reports and audit findings may be shared with a client only after management has verified them. The Employee must not commit the Company to corrective visits, charges, refunds, or results unless authorized by management.'),
  ],
  finance_accounts: [
    clause('Accuracy of Financial Records', 'Invoices, receipts, payments, payroll, and tax records must be complete, accurate, and recorded in the company portal on time. A false, altered, or backdated entry is gross misconduct.'),
    clause('Handling of Money', 'All money received must be recorded and deposited or handed over the same working day, with proper proof. Company money must not be used, lent, or moved for any personal purpose, and proven shortages may be recovered in accordance with applicable law.'),
    clause('Approvals', 'Payments, discounts, refunds, and invoice reversals may be processed only with the required approval from authorized management.'),
    clause('Confidentiality of Financial Information', 'Salaries, bank details, client balances, tax records, and company accounts must not be disclosed to anyone without authority, inside or outside the Company.'),
    clause('Banking Credentials', 'Bank logins, cheque books, and payment credentials must be kept secure and must not be shared. Any loss or suspected misuse must be reported immediately.'),
  ],
};

/** "05 November 2026": the date style used in formal letters. */
export function longDate(date: string): string {
  const d = new Date(date);
  return isNaN(d.getTime()) ? date : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' });
}

/** The body of the offer letter: plain paragraphs under one heading, no terms and conditions. */
export function offerLetterParagraphs(t: EmployeeLetterTerms, company: { name: string; shortName: string }, grossSalary: string): string[] {
  const duties = 'You are expected to perform your assigned duties responsibly, follow company policies, maintain confidentiality, and comply with all safety procedures.';
  const accept = t.offerValidUntil
    ? `Please sign below by ${longDate(t.offerValidUntil)} to confirm your acceptance of this offer and its terms and conditions, after which this offer lapses.`
    : 'Please sign below to confirm your acceptance of this offer and its terms and conditions.';
  return [
    `We are pleased to offer you employment at ${company.name} as ${t.designation}, effective from ${longDate(t.joiningDate)}, with a monthly gross salary of ${grossSalary}.`,
    t.probationMonths > 0
      ? `Your employment will be subject to an initial probation period of ${monthsInWords(t.probationMonths)}, during which your performance, attendance, and conduct will be evaluated. ${duties}`
      : duties,
    'On joining, please bring a copy of your CNIC, two passport-size photographs, educational and experience certificates. You will also sign an Employment Agreement and a Probation Letter containing the full general and role-specific terms and conditions. The terms of this offer are confidential and must not be shared with any third party.',
    `${accept} We welcome you to ${company.shortName} and wish you success in your new role.`,
  ];
}

/** Only an offer someone has signed keeps the numbered terms it was issued with. */
export const offerKeepsPrintedTerms = (letter: { status: string; terms: EmployeeLetterTerms }, printedTerms: LetterClauseSection[]) =>
  letter.status === 'signed' && printedTerms.some((sec) => sec.heading !== 'Additional Terms');

function dutySections(duties: EmployeeDuty[], intro: string): LetterClauseSection[] {
  return duties.map((duty) => ({
    heading: `Job-Specific Terms: ${EMPLOYEE_DUTY_LABELS[duty]}`,
    intro,
    clauses: DUTY_CLAUSES[duty],
  }));
}

const extraSection = (t: EmployeeLetterTerms): LetterClauseSection[] => {
  const clauses = (t.extraTerms || '').split('\n').map((x) => x.trim()).filter(Boolean).map((body) => ({ body }));
  return clauses.length ? [{ heading: 'Additional Terms', clauses }] : [];
};

/** The clause wording for a letter, saved on it when it is issued. */
export function letterClauseSections(kind: EmployeeLetterKind, t: EmployeeLetterTerms, duties: EmployeeDuty[]): LetterClauseSection[] {
  // The offer letter carries no terms and conditions: those are in the agreement and probation letter.
  // Only terms HR adds for this one person print on it.
  if (kind === 'employment_contract') {
    return [
      {
        heading: 'General Terms & Conditions of Employment',
        intro: 'The following terms and conditions shall apply equally to all employees, regardless of their designation, department, or position within the organization.',
        clauses: generalClauses(t),
      },
      ...dutySections(duties, 'The following terms apply to the duties of this position, in addition to the general terms above.'),
      {
        heading: 'Termination of Employment',
        clauses: [
          clause('Termination by Notice', `Either party may end this agreement by giving ${days(t.noticeDaysProbation)} notice during probation and ${days(t.noticeDaysPermanent)} notice after becoming permanent. The Company may pay salary in lieu of notice.`),
          clause('Termination Without Notice', 'The Company may end employment without notice for gross misconduct, including theft, fraud, violence, falsification of records or attendance, disclosure of confidential information, misuse of chemicals, private work for Company clients, or a serious safety breach, after giving the employee an opportunity to explain.'),
          clause('Final Settlement', 'Final dues will be settled after the employee has completed handover and clearance and returned all Company property. Proven losses and amounts owed to the Company may be adjusted in accordance with applicable law.'),
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
      ...dutySections(duties, 'The following terms apply to the duties of this position, in addition to the terms above.'),
      ...extraSection(t),
    ];
  }
  return extraSection(t);
}
