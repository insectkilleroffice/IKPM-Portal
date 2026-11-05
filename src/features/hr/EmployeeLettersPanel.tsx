// HR letters of one employee: Offer Letter (at hiring) → Employment Contract and Probation Letter
// (on joining) → Confirmation Letter (end of probation). Issue, print for signature, record the signed copy, withdraw.

import React, { useState } from 'react';
import { CheckCircle2, FileSignature, Paperclip, Printer, XCircle } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { useDataStore } from '../../hooks/useDataStore';
import { usePdfAction } from '../../hooks/usePdfAction';
import { dataService } from '../../services/dataService';
import { pdfGenerator } from '../../lib/pdfGenerator';
import { uploadFile } from '../../lib/cloudinary';
import { integrations } from '../../config/env';
import { formatDate, formatPKR } from '../../lib/formatters';
import {
  EMPLOYEE_LETTER_LABELS, EMPLOYEE_LETTER_STAGE,
  type Employee, type EmployeeLetter, type EmployeeLetterKind, type EmployeeLetterTerms, type EmployeeTermsProfile,
} from '../../types/hr';
import { activeLetter, addMonths, defaultTerms, issueLetter, LETTER_ORDER, markLetterSigned, needsEmployeeDetails, stageWarning, termsProblems, withdrawLetter } from './employeeLetters';
import { TERMS_PROFILE_LABELS } from './employmentTerms';

const STATUS_BADGE: Record<EmployeeLetter['status'], string> = { issued: 'badge-amber', signed: 'badge-teal', withdrawn: 'badge-slate' };
const STATUS_TEXT: Record<EmployeeLetter['status'], string> = { issued: 'Issued — awaiting signature', signed: 'Signed', withdrawn: 'Withdrawn' };

export const EmployeeLettersPanel: React.FC<{ employee: Employee; designation: string; reportingTo?: string }> = ({ employee, designation, reportingTo }) => {
  useDataStore();
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const pdf = usePdfAction();
  const letters = dataService.getEmployeeLetters(employee.id);
  const [issuing, setIssuing] = useState<EmployeeLetterKind | null>(null);
  const [signing, setSigning] = useState<EmployeeLetter | null>(null);
  const [withdrawing, setWithdrawing] = useState<EmployeeLetter | null>(null);
  const [reason, setReason] = useState('');
  const user = { email: userProfile?.email || 'admin', name: userProfile?.displayName || 'HR' };

  return (
    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
      <h4 style={{ margin: '0 0 0.6rem 0', display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.9rem' }}>
        <FileSignature size={16} /> Employment letters
      </h4>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {LETTER_ORDER.map((kind) => {
          const cur = activeLetter(letters, kind);
          const history = letters.filter((l) => l.kind === kind && l !== cur);
          return (
            <div key={kind} style={{ border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)', padding: '0.6rem 0.75rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700 }}>{EMPLOYEE_LETTER_LABELS[kind]} <span className="cell-sub">· {EMPLOYEE_LETTER_STAGE[kind]}</span></div>
                  {cur ? (
                    <div className="cell-sub">
                      {cur.refNo} · issued {formatDate(cur.issuedAt)} by {cur.issuedByName}
                      {cur.signedAt ? ` · signed ${formatDate(cur.signedAt)}` : ''}
                      {kind === 'confirmation_letter' && cur.terms.confirmationDate ? ` · permanent from ${formatDate(cur.terms.confirmationDate)}` : ''}
                    </div>
                  ) : (
                    <div className="cell-sub">Not issued yet{stageWarning(employee, kind, letters) && kind !== 'offer_letter' ? ` · ${stageWarning(employee, kind, letters)}` : ''}</div>
                  )}
                </div>
                {cur && <span className={`badge ${STATUS_BADGE[cur.status]}`}>{STATUS_TEXT[cur.status]}</span>}
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  {cur && (
                    <button type="button" className="btn btn-sm btn-secondary" title="Print / download for signature"
                      disabled={pdf.busy === cur.id} onClick={() => pdf.run(cur.id, () => pdfGenerator.generateEmployeeLetterPDF(cur))}>
                      <Printer size={13} /> Print
                    </button>
                  )}
                  {cur?.signedCopy && (
                    <a className="btn btn-sm btn-secondary" href={cur.signedCopy.url} target="_blank" rel="noreferrer"><Paperclip size={13} /> Signed copy</a>
                  )}
                  {cur?.status === 'issued' && kind !== 'confirmation_letter' && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setSigning(cur)}><CheckCircle2 size={13} /> Mark signed</button>
                  )}
                  {cur?.status === 'issued' && kind === 'confirmation_letter' && (
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => setSigning(cur)}><Paperclip size={13} /> Attach received copy</button>
                  )}
                  {cur && (
                    <button type="button" className="btn btn-sm btn-secondary" title="Withdraw this letter (e.g. to issue a corrected one)" onClick={() => { setWithdrawing(cur); setReason(''); }}>
                      <XCircle size={13} />
                    </button>
                  )}
                  {!cur && (
                    <button type="button" className="btn btn-sm btn-primary" onClick={() => setIssuing(kind)}>Issue {EMPLOYEE_LETTER_LABELS[kind].toLowerCase()}</button>
                  )}
                </div>
              </div>
              {history.length > 0 && (
                <div className="cell-sub" style={{ marginTop: 4 }}>
                  Earlier: {history.map((h) => `${h.refNo} (${h.status}${h.withdrawnReason ? `: ${h.withdrawnReason}` : ''})`).join('; ')}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {issuing && (
        <IssueLetterModal employee={employee} kind={issuing} designation={designation} reportingTo={reportingTo}
          onClose={() => setIssuing(null)}
          onIssued={(l) => { setIssuing(null); pdf.run(l.id, () => pdfGenerator.generateEmployeeLetterPDF(l)); }} />
      )}
      {signing && <SignLetterModal letter={signing} onClose={() => setSigning(null)} />}
      {withdrawing && (
        <Modal isOpen onClose={() => setWithdrawing(null)} title={`Withdraw ${EMPLOYEE_LETTER_LABELS[withdrawing.kind]}`} subtitle={withdrawing.refNo} maxWidth="440px"
          footer={
            <>
              <button className="btn btn-secondary" onClick={() => setWithdrawing(null)}>Cancel</button>
              <button className="btn btn-danger" disabled={!reason.trim()} onClick={() => {
                try {
                  withdrawLetter(withdrawing, reason, user);
                  success('Letter withdrawn', 'You can now issue a new one.');
                  setWithdrawing(null);
                } catch (err) {
                  error('Could not withdraw', err instanceof Error ? err.message : String(err));
                }
              }}>Withdraw</button>
            </>
          }>
          <div className="form-group" style={{ marginBottom: 0 }}>
            <label className="form-label">Reason <span className="required">*</span></label>
            <input className="form-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Salary corrected; candidate declined" />
            <div className="cell-sub" style={{ marginTop: 4 }}>The letter stays on record marked "withdrawn". It does not change the employee's status.</div>
          </div>
        </Modal>
      )}
    </div>
  );
};

/** Issue form: terms prefilled from the profile, salary structure and earlier letters; editable before issuing. */
const IssueLetterModal: React.FC<{
  employee: Employee; kind: EmployeeLetterKind; designation: string; reportingTo?: string;
  onClose: () => void; onIssued: (l: EmployeeLetter) => void;
}> = ({ employee, kind, designation, reportingTo, onClose, onIssued }) => {
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const [t, setT] = useState<EmployeeLetterTerms>(() => defaultTerms(employee, kind, designation, reportingTo));
  const existingPriv = dataService.getEmployeePrivate(employee.id);
  const [priv, setPriv] = useState({
    cnic: existingPriv?.cnic || '',
    fatherName: existingPriv?.fatherName || '',
    residentialAddress: existingPriv?.residentialAddress || '',
  });
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const warning = stageWarning(employee, kind, dataService.getEmployeeLetters(employee.id));
  const gross = t.basicSalary + t.allowances.reduce((s, a) => s + (Number(a.amount) || 0), 0);
  const terms: EmployeeLetterTerms = { ...t, grossSalary: gross };
  const problems = termsProblems(kind, terms, priv);
  const set = (patch: Partial<EmployeeLetterTerms>) => setT((cur) => ({ ...cur, ...patch }));
  const num = (v: string) => Math.max(0, Number(v) || 0);

  const issue = async () => {
    if (problems.length) return;
    setBusy(true);
    try {
      if (needsEmployeeDetails(kind)) {
        dataService.saveEmployeePrivate({
          ...(existingPriv || { id: employee.id }),
          id: employee.id,
          cnic: priv.cnic.trim(),
          fatherName: priv.fatherName.trim() || undefined,
          residentialAddress: priv.residentialAddress.trim(),
          updatedAt: new Date().toISOString(),
        }, userProfile?.email);
      }
      const letter = await issueLetter(employee, kind, terms, { email: userProfile?.email || 'admin', name: userProfile?.displayName || 'HR' }, notes);
      success(`${EMPLOYEE_LETTER_LABELS[kind]} issued`, `${letter.refNo}. Print it for signature${kind === 'confirmation_letter' ? `; ${employee.name} is now Permanent` : ''}.`);
      onIssued(letter);
    } catch (err) {
      error('Could not issue the letter', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={`Issue ${EMPLOYEE_LETTER_LABELS[kind]}`} subtitle={`${employee.name} (${employee.id}) · ${EMPLOYEE_LETTER_STAGE[kind]}`} maxWidth="760px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={issue} disabled={busy || problems.length > 0} title={problems.join('\n')}>
            <FileSignature size={14} /> {busy ? 'Issuing…' : 'Issue & print'}
          </button>
        </>
      }>
      {warning && <div className="info-hint" style={{ marginBottom: '0.75rem' }}>{warning}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group"><label className="form-label">Designation *</label>
          <input className="form-input" value={t.designation} onChange={(e) => set({ designation: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">Department</label>
          <input className="form-input" value={t.department} onChange={(e) => set({ department: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">Reports to</label>
          <input className="form-input" value={t.reportingTo || ''} onChange={(e) => set({ reportingTo: e.target.value })} /></div>
        <div className="form-group"><label className="form-label">Joining date *</label>
          <input type="date" className="form-input" value={t.joiningDate}
            onChange={(e) => set({ joiningDate: e.target.value, probationEndDate: e.target.value ? addMonths(e.target.value, t.probationMonths) : t.probationEndDate })} /></div>
        <div className="form-group"><label className="form-label">Probation (months)</label>
          <input type="number" min={0} className="form-input" value={t.probationMonths}
            onChange={(e) => set({ probationMonths: num(e.target.value), probationEndDate: t.joiningDate ? addMonths(t.joiningDate, num(e.target.value)) : t.probationEndDate })} /></div>
        <div className="form-group"><label className="form-label">Probation ends</label>
          <input type="date" className="form-input" value={t.probationEndDate || ''} onChange={(e) => set({ probationEndDate: e.target.value })} /></div>
        <div className="form-group" style={{ gridColumn: 'span 2' }}><label className="form-label">Working hours *</label>
          <input className="form-input" value={t.workingHours} onChange={(e) => set({ workingHours: e.target.value })} /></div>
        {kind === 'offer_letter' ? (
          <div className="form-group"><label className="form-label">Accept by</label>
            <input type="date" className="form-input" value={t.offerValidUntil || ''} onChange={(e) => set({ offerValidUntil: e.target.value })} /></div>
        ) : kind === 'confirmation_letter' ? (
          <div className="form-group"><label className="form-label">Permanent from *</label>
            <input type="date" className="form-input" value={t.confirmationDate || ''} onChange={(e) => set({ confirmationDate: e.target.value })} /></div>
        ) : <div />}
        {kind !== 'confirmation_letter' && (
          <div className="form-group"><label className="form-label">Role-specific terms</label>
            <select className="form-select" value={t.termsProfile || 'general'} onChange={(e) => set({ termsProfile: e.target.value as EmployeeTermsProfile })}>
              {(Object.keys(TERMS_PROFILE_LABELS) as EmployeeTermsProfile[]).map((p) => <option key={p} value={p}>{TERMS_PROFILE_LABELS[p]}</option>)}
            </select></div>
        )}
        <div className="form-group"><label className="form-label">Notice in probation (days)</label>
          <input type="number" min={0} className="form-input" value={t.noticeDaysProbation} onChange={(e) => set({ noticeDaysProbation: num(e.target.value) })} /></div>
        <div className="form-group"><label className="form-label">Notice when permanent (days)</label>
          <input type="number" min={0} className="form-input" value={t.noticeDaysPermanent} onChange={(e) => set({ noticeDaysPermanent: num(e.target.value) })} /></div>
      </div>

      <div className="section-title">Monthly salary</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: '0.5rem' }}>
        <div className="form-group"><label className="form-label">Basic</label>
          <input type="number" min={0} className="form-input" value={t.basicSalary} onChange={(e) => set({ basicSalary: num(e.target.value) })} /></div>
        {t.allowances.map((a, i) => (
          <div key={a.label} className="form-group"><label className="form-label">{a.label}</label>
            <input type="number" min={0} className="form-input" value={a.amount}
              onChange={(e) => set({ allowances: t.allowances.map((x, j) => (j === i ? { ...x, amount: num(e.target.value) } : x)) })} /></div>
        ))}
      </div>
      {!t.allowances.length && (
        <button type="button" className="btn btn-sm btn-secondary" onClick={() => set({ allowances: [
          { label: 'Attendance allowance', amount: 0 }, { label: 'Mobile package', amount: 0 }, { label: 'Bike maintenance', amount: 0 }, { label: 'Other allowance', amount: 0 },
        ] })}>Add allowances</button>
      )}
      <div style={{ textAlign: 'right', fontWeight: 800, margin: '0.4rem 0 0.75rem' }}>Gross: {formatPKR(gross)} / month</div>
      {kind === 'confirmation_letter' && (
        <div className="form-group"><label className="form-label">Revised gross salary on confirmation (optional)</label>
          <input type="number" min={0} className="form-input" value={t.revisedGrossSalary ?? ''} placeholder={String(gross)}
            onChange={(e) => set({ revisedGrossSalary: e.target.value === '' ? undefined : num(e.target.value) })} />
          <div className="cell-sub">Printed on the letter. Update the salary structure separately for payroll.</div>
        </div>
      )}

      {needsEmployeeDetails(kind) && (
        <>
          <div className="section-title">Employee details (printed on the letter, HR only)</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            <div className="form-group"><label className="form-label">CNIC *</label>
              <input className="form-input" value={priv.cnic} placeholder="xxxxx-xxxxxxx-x" onChange={(e) => setPriv({ ...priv, cnic: e.target.value })} /></div>
            <div className="form-group"><label className="form-label">Father's / husband's name</label>
              <input className="form-input" value={priv.fatherName} onChange={(e) => setPriv({ ...priv, fatherName: e.target.value })} /></div>
            <div className="form-group" style={{ gridColumn: '1 / -1' }}><label className="form-label">Residential address *</label>
              <input className="form-input" value={priv.residentialAddress} onChange={(e) => setPriv({ ...priv, residentialAddress: e.target.value })} /></div>
          </div>
        </>
      )}

      <div className="form-group"><label className="form-label">Extra terms (one per line, printed on the letter)</label>
        <textarea className="form-textarea" rows={2} value={t.extraTerms || ''} onChange={(e) => set({ extraTerms: e.target.value })} /></div>
      <div className="form-group" style={{ marginBottom: 0 }}><label className="form-label">Internal note (not printed)</label>
        <input className="form-input" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
      {problems.length > 0 && <div className="cell-sub" style={{ color: '#B45309', marginTop: 6 }}>{problems.join(' ')}</div>}
    </Modal>
  );
};

/** Records the signature date and the signed / received copy. */
const SignLetterModal: React.FC<{ letter: EmployeeLetter; onClose: () => void }> = ({ letter, onClose }) => {
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const isConfirmation = letter.kind === 'confirmation_letter';

  const save = async () => {
    setBusy(true);
    try {
      const copy = file
        ? await uploadFile(file, { scope: { ownerScope: 'company', category: 'other' }, subPath: `hr/${letter.employeeId}`, fileName: `${letter.refNo.replace(/\//g, '-')}_signed_${file.name}` })
        : undefined;
      if (isConfirmation) {
        if (!copy) throw new Error('Choose the scanned copy to attach.');
        dataService.saveEmployeeLetter({ ...letter, signedAt: date, signedCopy: { url: copy.url, fileName: copy.fileName, fileType: copy.fileType }, updatedAt: new Date().toISOString() }, userProfile?.email);
      } else {
        markLetterSigned(letter, copy ? { url: copy.url, fileName: copy.fileName, fileType: copy.fileType } : undefined, { email: userProfile?.email || 'admin' }, date);
      }
      success(isConfirmation ? 'Copy attached' : 'Marked signed',
        needsEmployeeDetails(letter.kind) && dataService.getEmployeeById(letter.employeeId)?.status === 'probation' ? `${letter.employeeName} is on probation.` : letter.refNo);
      onClose();
    } catch (err) {
      error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} title={isConfirmation ? 'Attach received copy' : `${EMPLOYEE_LETTER_LABELS[letter.kind]} signed`} subtitle={`${letter.employeeName} · ${letter.refNo}`} maxWidth="460px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={save} disabled={busy || (isConfirmation && !file)}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      }>
      <div className="form-group">
        <label className="form-label">{isConfirmation ? 'Received on' : 'Signed on'}</label>
        <input type="date" className="form-input" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Signed copy (scan or photo){isConfirmation ? ' *' : ''}</label>
        {integrations.cloudinary ? (
          <input type="file" className="form-input" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        ) : (
          <div className="cell-sub">File storage is not configured, so the copy can't be attached. Keep the paper copy in the employee's file.</div>
        )}
        {needsEmployeeDetails(letter.kind) && <div className="cell-sub" style={{ marginTop: 4 }}>Signing moves the employee from Hiring to Probation.</div>}
      </div>
    </Modal>
  );
};
