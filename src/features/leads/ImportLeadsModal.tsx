import React, { useRef, useState } from 'react';
import { Download, FileSpreadsheet, UploadCloud, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { dataService } from '../../services/dataService';
import { downloadImportTemplate, parseLeadRows, primaryContact, readSpreadsheet, type ImportRow } from '../../lib/leadWorkflow';
import type { Lead } from '../../types/crm';

export const ImportLeadsModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
  const { success, error } = useNotification();
  const { userProfile } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [busy, setBusy] = useState(false);
  const [isOver, setIsOver] = useState(false);

  const reset = () => {
    setFileName('');
    setRows([]);
    if (inputRef.current) inputRef.current.value = '';
  };

  const close = () => {
    reset();
    onClose();
  };

  const load = async (file?: File) => {
    if (!file) return;
    if (!/\.(xlsx|csv)$/i.test(file.name)) {
      error('Unsupported file', 'Use an Excel .xlsx file or a .csv file. Older .xls files: open in Excel and “Save As” .xlsx.');
      return;
    }
    setBusy(true);
    try {
      const data = await readSpreadsheet(file);
      const parsed = parseLeadRows(data, (phone, email) => dataService.findLeadDuplicates(phone, email)[0]);
      if (!parsed.length) error('Nothing to import', 'The first sheet needs a header row and at least one lead below it.');
      setRows(parsed);
      setFileName(file.name);
    } catch (err) {
      error('Could not read the file', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const valid = rows.filter((r) => r.lead && !(skipDuplicates && r.duplicate));
  const invalid = rows.filter((r) => !r.lead);
  const dupes = rows.filter((r) => r.lead && r.duplicate);

  const doImport = () => {
    if (!valid.length) return;
    const n = dataService.importLeads(valid.map((r) => r.lead!) as Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>[], userProfile?.email);
    success('Leads imported', `${n} lead(s) added to New inquiries.`);
    close();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title="Import leads from Excel"
      subtitle="Use the template columns. Only company name, city and one contact (name + phone) are required."
      maxWidth="860px"
      footer={
        <>
          <button className="btn btn-ghost" onClick={() => downloadImportTemplate()} style={{ marginRight: 'auto' }}>
            <Download size={15} /> Download template
          </button>
          <button className="btn btn-secondary" onClick={close}>Cancel</button>
          <button className="btn btn-primary" onClick={doImport} disabled={!valid.length || busy}>
            Import {valid.length || ''} lead{valid.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      {!rows.length ? (
        <label
          className={`dropzone ${isOver ? 'is-over' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setIsOver(true); }}
          onDragLeave={() => setIsOver(false)}
          onDrop={(e) => { e.preventDefault(); setIsOver(false); load(e.dataTransfer.files[0]); }}
        >
          <input ref={inputRef} type="file" accept=".xlsx,.csv" hidden onChange={(e) => load(e.target.files?.[0])} />
          {busy ? <FileSpreadsheet size={32} className="animate-spin" /> : <UploadCloud size={32} />}
          <strong>{busy ? 'Reading file…' : 'Choose an Excel file or drop it here'}</strong>
          <span className="cell-sub">.xlsx or .csv · first sheet is imported</span>
        </label>
      ) : (
        <>
          <div className="status-strip">
            <span className="status-pill"><FileSpreadsheet size={15} /> {fileName}</span>
            <span className="status-pill ok"><CheckCircle2 size={15} /> {rows.length - invalid.length - dupes.length} ready</span>
            {dupes.length > 0 && <span className="status-pill warn"><AlertTriangle size={15} /> {dupes.length} possible duplicate(s)</span>}
            {invalid.length > 0 && <span className="status-pill bad"><AlertTriangle size={15} /> {invalid.length} with errors (skipped)</span>}
            <button className="btn btn-sm btn-ghost" onClick={reset}>Choose another file</button>
          </div>
          {dupes.length > 0 && (
            <label className="doc-check" style={{ display: 'inline-flex', marginBottom: '0.75rem' }}>
              <input type="checkbox" checked={skipDuplicates} onChange={(e) => setSkipDuplicates(e.target.checked)} />
              Skip rows that match an existing lead or customer
            </label>
          )}
          <div className="table-container is-scroll" style={{ maxHeight: '48vh' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 56 }}>Row</th>
                  <th>Company / client</th>
                  <th>City</th>
                  <th>Primary contact</th>
                  <th>Other contacts</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const p = r.lead ? primaryContact(r.lead as Lead) : undefined;
                  const extra = (r.lead?.contacts?.length || 1) - 1;
                  return (
                    <tr key={r.rowNumber} style={!r.lead || (skipDuplicates && r.duplicate) ? { opacity: 0.6 } : undefined}>
                      <td className="cell-sub">{r.rowNumber}</td>
                      <td className="cell-title">{r.lead?.title || '—'}</td>
                      <td>{r.lead?.city || ''}</td>
                      <td>
                        {p ? (
                          <>
                            <div>{p.name}{p.designation ? <span className="cell-sub"> · {p.designation}</span> : null}</div>
                            <div className="cell-sub">{p.phone}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td className="cell-sub">{extra > 0 ? `+${extra}` : '—'}</td>
                      <td>
                        {!r.lead ? (
                          <span className="badge-status badge-rose" title={r.errors.join('\n')}>{r.errors[0]}</span>
                        ) : r.duplicate ? (
                          <span className="badge-status badge-amber" title={r.duplicate}>{skipDuplicates ? 'Duplicate, skipped' : 'Possible duplicate'}</span>
                        ) : (
                          <span className="badge-status badge-emerald">Ready</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
};
