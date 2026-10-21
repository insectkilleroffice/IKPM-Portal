import React, { useEffect, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { canEditModule } from '../../lib/permissions';
import { dataService } from '../../services/dataService';
import { defaultTemplates, documentTemplates, type DocumentTemplates, type TemplateKind } from '../../services/documentTemplates';
import { TEMPLATE_PLACEHOLDERS } from '../../lib/templateFill';

const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);

/**
 * Proposal, contract and SOP templates. Each save creates a new version (template_versions).
 * Wording: super admin + the 'templates' permission. Commercial / legal: super admin only.
 */
export const TemplatesForm: React.FC = () => {
  const { userProfile, effectiveRole } = useAuth();
  const { success, error } = useNotification();
  const canWording = canEditModule(effectiveRole, 'templates');
  const canCommercial = effectiveRole === 'super_admin';
  const [t, setT] = useState<DocumentTemplates>(() => documentTemplates.get());
  const [ver, setVer] = useState(() => documentTemplates.version());
  const [saving, setSaving] = useState<TemplateKind | null>(null);

  // Pick up the latest saved versions once they load
  useEffect(
    () =>
      documentTemplates.subscribe(() => {
        setT(documentTemplates.get());
        setVer(documentTemplates.version());
      }),
    []
  );

  const save = async (kind: TemplateKind) => {
    setSaving(kind);
    try {
      const v = await documentTemplates.save(kind, t, { email: userProfile?.email || '', uid: userProfile?.uid || '' });
      dataService.logAudit({
        userId: userProfile?.uid || '',
        userEmail: userProfile?.email || '',
        action: 'update',
        entityType: 'template',
        entityId: v.id,
        entityTitle: `${kind === 'wording' ? 'Wording' : 'Commercial / legal'} templates v${v.version}`,
        details: `Saved ${kind} templates as version ${v.version}`,
      });
      success('Templates saved', `Version ${v.version} is used for new proposals, contracts and SOPs.`);
    } catch (err) {
      error('Could not save', err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(null);
    }
  };

  const reset = () => {
    const d = defaultTemplates();
    setT({
      ...t,
      ...(canWording ? { coverLetter: d.coverLetter, scopeSections: d.scopeSections, sopSections: d.sopSections } : {}),
      ...(canCommercial ? { terms: d.terms, paymentTerms: d.paymentTerms, taxWording: d.taxWording, deviceOwnership: d.deviceOwnership } : {}),
    });
  };

  const history = documentTemplates.history();

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h3 style={{ fontSize: '1rem', fontWeight: 800 }}>Document templates</h3>
        <button className="btn btn-secondary" onClick={reset} disabled={!canWording && !canCommercial}><RotateCcw size={14} /> Reset to defaults</button>
      </div>
      <div className="info-hint" style={{ margin: '0.75rem 0 1rem' }}>
        Placeholders filled when the document is generated: {TEMPLATE_PLACEHOLDERS.map((p) => `{{${p.key}}}`).join(', ')}.
        Every save creates a new version; generated documents keep the version and text they used.
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
        <h4 style={{ fontWeight: 800 }}>Wording (v{ver.wording})</h4>
        <button className="btn btn-primary btn-sm" onClick={() => save('wording')} disabled={!canWording || saving !== null}><Save size={14} /> Save wording</button>
      </div>
      {!canWording && <div className="cell-sub">Needs the Document templates edit permission.</div>}

      <div className="section-title" style={{ marginTop: 0 }}>Proposal: cover letter</div>
      <textarea className="form-textarea" rows={4} value={t.coverLetter} onChange={(e) => setT({ ...t, coverLetter: e.target.value })} disabled={!canWording} />

      <div className="section-title">Proposal: scope of services</div>
      {t.scopeSections.map((s, i) => (
        <div key={i} className="form-group">
          <input className="form-input" value={`${s.key}. ${s.title}`} disabled={!canWording} style={{ marginBottom: 4 }}
            onChange={(e) => setT({ ...t, scopeSections: t.scopeSections.map((x, j) => (j === i ? { ...x, title: e.target.value.replace(/^\s*\w+\.\s*/, '') } : x)) })} />
          <textarea className="form-textarea" rows={2} value={s.body} disabled={!canWording}
            onChange={(e) => setT({ ...t, scopeSections: t.scopeSections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
        </div>
      ))}

      <div className="section-title">Client SOP sections</div>
      {t.sopSections.map((s, i) => (
        <div key={i} className="form-group" style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: '0.6rem' }}>
          <input className="form-input" value={s.title} disabled={!canWording} style={{ marginBottom: 4 }}
            onChange={(e) => setT({ ...t, sopSections: t.sopSections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
          <label className="cell-sub">Paragraphs (one per line)</label>
          <textarea className="form-textarea" rows={3} value={s.paragraphs.join('\n')} disabled={!canWording}
            onChange={(e) => setT({ ...t, sopSections: t.sopSections.map((x, j) => (j === i ? { ...x, paragraphs: lines(e.target.value) } : x)) })} />
          <label className="cell-sub">Numbered points (one per line)</label>
          <textarea className="form-textarea" rows={3} value={(s.bullets ?? []).join('\n')} disabled={!canWording}
            onChange={(e) => setT({ ...t, sopSections: t.sopSections.map((x, j) => (j === i ? { ...x, bullets: lines(e.target.value) } : x)) })} />
        </div>
      ))}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.5rem' }}>
        <h4 style={{ fontWeight: 800 }}>Commercial / legal (v{ver.commercial})</h4>
        <button className="btn btn-primary btn-sm" onClick={() => save('commercial')} disabled={!canCommercial || saving !== null}><Save size={14} /> Save commercial</button>
      </div>
      {!canCommercial && <div className="cell-sub">Only the super admin can change commercial and legal wording.</div>}

      <div className="section-title">Contract terms (one per line → (a), (b), (c)…)</div>
      <textarea className="form-textarea" rows={8} value={t.terms.join('\n')} disabled={!canCommercial} onChange={(e) => setT({ ...t, terms: lines(e.target.value) })} />
      <div className="section-title">Payment terms</div>
      <textarea className="form-textarea" rows={2} value={t.paymentTerms} disabled={!canCommercial} onChange={(e) => setT({ ...t, paymentTerms: e.target.value })} />
      <div className="section-title">Tax wording ({'{{taxMode}}'} = inclusive / exclusive)</div>
      <textarea className="form-textarea" rows={2} value={t.taxWording} disabled={!canCommercial} onChange={(e) => setT({ ...t, taxWording: e.target.value })} />
      <div className="section-title">Device ownership</div>
      <textarea className="form-textarea" rows={3} value={t.deviceOwnership} disabled={!canCommercial} onChange={(e) => setT({ ...t, deviceOwnership: e.target.value })} />

      {history.length > 0 && (
        <>
          <div className="section-title">Version history</div>
          <table className="data-table">
            <thead><tr><th>Version</th><th>Saved by</th><th>Saved at</th></tr></thead>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}><td>{h.kind === 'wording' ? 'Wording' : 'Commercial'} v{h.version}</td><td>{h.savedBy}</td><td>{new Date(h.savedAt).toLocaleString()}</td></tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
};

export default TemplatesForm;
