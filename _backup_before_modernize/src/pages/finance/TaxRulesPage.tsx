import React, { useState } from 'react';
import {
  FileCheck2,
  Plus,
  ShieldCheck,
  AlertCircle,
  Calendar,
  CheckCircle,
} from 'lucide-react';
import { dataService } from '../../services/dataService';
import { Breadcrumbs } from '../../components/common/Breadcrumbs';
import { Modal } from '../../components/common/Modal';
import { formatDate } from '../../lib/formatters';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { TaxRuleConfig, TaxJurisdiction } from '../../types/finance';

export const TaxRulesPage: React.FC = () => {
  const { success } = useNotification();
  const { userProfile, effectiveRole } = useAuth();

  const [taxRules, setTaxRules] = useState(dataService.getTaxRules());
  const [showModal, setShowModal] = useState(false);
  const [editingRule, setEditingRule] = useState<TaxRuleConfig | null>(null);

  const [formState, setFormState] = useState({
    jurisdiction: 'sindh_srb' as TaxJurisdiction,
    jurisdictionTitle: 'Sindh Revenue Board (SRB)',
    serviceType: 'Pest Control & Fumigation Services',
    standardSalesTaxPercent: 13,
    whtActiveFilerPercent: 3,
    whtNonFilerPercent: 8,
    officialLegalReference: 'Sindh Sales Tax on Services Act 2011, Tariff Heading 9822.3000',
    effectiveDate: '2026-07-01',
    verifiedByAccountant: true,
    reviewedByName: 'Farooq & Co Chartered Accountants',
  });

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();
    const ruleId = editingRule ? editingRule.id : `TAX-${Date.now().toString().slice(-4)}`;
    const saved: TaxRuleConfig = {
      id: ruleId,
      jurisdiction: formState.jurisdiction,
      jurisdictionTitle: formState.jurisdictionTitle,
      serviceType: formState.serviceType,
      standardSalesTaxPercent: Number(formState.standardSalesTaxPercent),
      whtActiveFilerPercent: Number(formState.whtActiveFilerPercent),
      whtNonFilerPercent: Number(formState.whtNonFilerPercent),
      officialLegalReference: formState.officialLegalReference,
      effectiveDate: formState.effectiveDate,
      verifiedByAccountant: formState.verifiedByAccountant,
      reviewedByName: formState.reviewedByName,
      reviewedDate: new Date().toISOString().split('T')[0],
      isCurrent: true,
    };

    dataService.saveTaxRule(saved, userProfile?.email);
    setTaxRules(dataService.getTaxRules());
    success('Tax Rule Configured', `Updated rule for ${saved.jurisdictionTitle}`);
    setShowModal(false);
    setEditingRule(null);
  };

  return (
    <div className="animate-fade-in">
      <Breadcrumbs
        items={[
          { label: 'Invoices & Receivables', path: '/finance/invoices' },
          { label: 'Configurable Tax Rules & Withholding' },
        ]}
      />

      {/* Advisory Banner */}
      <div
        style={{
          padding: '0.9rem 1.25rem',
          backgroundColor: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          borderLeft: '4px solid var(--ikpm-emerald-600)',
          borderRadius: 'var(--radius-md)',
          marginBottom: '1.5rem',
          display: 'flex',
          alignItems: 'flex-start',
          gap: '0.75rem',
        }}
      >
        <ShieldCheck size={20} color="var(--ikpm-emerald-600)" style={{ flexShrink: 0, marginTop: '2px' }} />
        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
          <strong>Statutory Compliance Rule (Section 5):</strong> Never hardcode Pakistani tax rates. Tax rules in IKPM are
          dynamic and configurable by jurisdiction (SRB, PRA, KPRA, ICT), service category, effective fiscal date, and official statutory gazette.
          All rates must be reviewed by the designated accounting officer or certified tax consultant.
        </div>
      </div>

      <div className="page-header">
        <div className="page-title-wrap">
          <h1>Configurable Provincial Tax & WHT Rules</h1>
          <p className="page-subtitle">
            Sales tax on services rates, Section 153 withholding tax thresholds, and legal references.
          </p>
        </div>

        <button
          className="btn btn-primary"
          onClick={() => {
            setEditingRule(null);
            setShowModal(true);
          }}
        >
          <Plus size={16} />
          <span>+ Add Jurisdiction Rule</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {taxRules.map((rule) => (
          <div key={rule.id} className="card" style={{ borderTop: '3px solid var(--ikpm-navy-700)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <span className="badge-status badge-navy" style={{ fontSize: '0.7rem' }}>
                  {rule.jurisdiction.toUpperCase()}
                </span>
                <h3 style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--ikpm-navy-900)', marginTop: '0.35rem' }}>
                  {rule.jurisdictionTitle}
                </h3>
              </div>
              <span className="badge-status badge-emerald">Active</span>
            </div>

            <div style={{ margin: '1rem 0', display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: '0.85rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Sales Tax on Services:</span>
                <strong style={{ fontSize: '1rem', color: 'var(--ikpm-navy-900)' }}>{rule.standardSalesTaxPercent}%</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>WHT (Active Filer Sec 153):</span>
                <strong>{rule.whtActiveFilerPercent}%</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>WHT (Non-Filer Penalty):</span>
                <strong style={{ color: 'var(--ikpm-rose-500)' }}>{rule.whtNonFilerPercent}%</strong>
              </div>
            </div>

            <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-surface-alt)', padding: '0.65rem', borderRadius: 'var(--radius-sm)', marginBottom: '0.75rem' }}>
              <strong>Official Law Reference:</strong> {rule.officialLegalReference}
            </div>

            <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <CheckCircle size={12} color="var(--ikpm-emerald-600)" />
              <span>Reviewed by {rule.reviewedByName || 'Certified Accountant'} on {formatDate(rule.reviewedDate)}</span>
            </div>
          </div>
        ))}
      </div>

      {/* Modal: Configure Tax Rule */}
      <Modal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        title="Configure Provincial Tax Rule"
        maxWidth="600px"
      >
        <form onSubmit={handleSaveRule}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Tax Authority</label>
              <select
                className="form-select"
                value={formState.jurisdiction}
                onChange={(e) => {
                  const jur = e.target.value as TaxJurisdiction;
                  let title = 'Sindh Revenue Board (SRB)';
                  let defRate = 13;
                  if (jur === 'punjab_pra') {
                    title = 'Punjab Revenue Authority (PRA)';
                    defRate = 16;
                  }
                  if (jur === 'islamabad_ict') {
                    title = 'Islamabad Capital Territory (Federal FBR)';
                    defRate = 15;
                  }
                  if (jur === 'kpk_kpra') {
                    title = 'KP Revenue Authority (KPRA)';
                    defRate = 15;
                  }
                  setFormState({
                    ...formState,
                    jurisdiction: jur,
                    jurisdictionTitle: title,
                    standardSalesTaxPercent: defRate,
                  });
                }}
              >
                <option value="sindh_srb">Sindh Revenue Board (SRB)</option>
                <option value="punjab_pra">Punjab Revenue Authority (PRA)</option>
                <option value="islamabad_ict">Islamabad ICT (Federal FBR)</option>
                <option value="kpk_kpra">Khyber Pakhtunkhwa (KPRA)</option>
                <option value="balochistan_bra">Balochistan Revenue Authority (BRA)</option>
              </select>
            </div>

            <div className="form-group">
              <label className="form-label">Sales Tax Rate (%) <span className="required">*</span></label>
              <input
                type="number"
                required
                className="form-input"
                value={formState.standardSalesTaxPercent}
                onChange={(e) => setFormState({ ...formState, standardSalesTaxPercent: Number(e.target.value) })}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label">WHT Active Filer Rate (%)</label>
              <input
                type="number"
                className="form-input"
                value={formState.whtActiveFilerPercent}
                onChange={(e) => setFormState({ ...formState, whtActiveFilerPercent: Number(e.target.value) })}
              />
            </div>

            <div className="form-group">
              <label className="form-label">WHT Non-Filer Rate (%)</label>
              <input
                type="number"
                className="form-input"
                value={formState.whtNonFilerPercent}
                onChange={(e) => setFormState({ ...formState, whtNonFilerPercent: Number(e.target.value) })}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Statutory Legal Reference <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              value={formState.officialLegalReference}
              onChange={(e) => setFormState({ ...formState, officialLegalReference: e.target.value })}
            />
          </div>

          <div className="form-group">
            <label className="form-label">Reviewing Accountant / CA Firm <span className="required">*</span></label>
            <input
              type="text"
              required
              className="form-input"
              value={formState.reviewedByName}
              onChange={(e) => setFormState({ ...formState, reviewedByName: e.target.value })}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', marginTop: '1.5rem' }}>
            <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Tax Rule
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};
