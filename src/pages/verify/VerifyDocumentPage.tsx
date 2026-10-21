import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { useParams } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react';
import { db } from '../../lib/firebase';
import { companyProfile } from '../../services/companyProfile';
import { formatDate, formatPKR } from '../../lib/formatters';

interface Verification {
  type: string;
  title: string;
  ref: string;
  issuedAt: string;
  client: string;
  amount?: number;
  status: string;
  company: string;
}

const label = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase());

/** Public page opened from the "Scan to verify" QR code printed on every document. */
export const VerifyDocumentPage: React.FC = () => {
  const { id = '' } = useParams();
  const profile = useSyncExternalStore(companyProfile.subscribe, companyProfile.get);
  const [state, setState] = useState<'loading' | 'found' | 'missing' | 'error'>('loading');
  const [record, setRecord] = useState<Verification | null>(null);

  useEffect(() => {
    getDoc(doc(db, 'doc_verifications', id))
      .then((snap) => {
        if (!snap.exists()) return setState('missing');
        setRecord(snap.data() as Verification);
        setState('found');
      })
      .catch(() => setState('error'));
  }, [id]);

  const rows: [string, string | undefined][] = record
    ? [
        ['Document', record.title],
        ['Number', record.ref],
        ['Date', formatDate(record.issuedAt)],
        ['Issued to', record.client],
        ['Amount', record.amount ? formatPKR(record.amount) : undefined],
        ['Status', label(record.status)],
      ]
    : [];

  return (
    <div className="center-screen">
      <div className="auth-card animate-fade-in">
        <img src={profile.logoUrl || '/ik_logo.svg'} alt={profile.legalName} className="auth-logo" />
        {state === 'loading' && (
          <p className="auth-subtitle"><Loader2 size={16} className="animate-spin" style={{ verticalAlign: '-3px' }} /> Checking document…</p>
        )}
        {state === 'found' && record && (
          <>
            <h1 className="auth-title" style={{ color: 'var(--ikpm-emerald-600)' }}>
              <ShieldCheck size={22} style={{ verticalAlign: '-4px' }} /> Genuine document
            </h1>
            <p className="auth-subtitle">Issued by {record.company}</p>
            <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '0.5rem 1rem', margin: 0, fontSize: '0.9rem' }}>
              {rows.filter(([, v]) => v).map(([k, v]) => (
                <React.Fragment key={k}>
                  <dt style={{ color: 'var(--text-muted)' }}>{k}</dt>
                  <dd style={{ margin: 0, fontWeight: 600, overflowWrap: 'anywhere' }}>{v}</dd>
                </React.Fragment>
              ))}
            </dl>
            <p className="cell-sub" style={{ marginTop: '1.25rem', textAlign: 'center' }}>
              Check that these details match the printed document.
            </p>
          </>
        )}
        {(state === 'missing' || state === 'error') && (
          <>
            <h1 className="auth-title" style={{ color: 'var(--ikpm-rose-500)' }}>
              <ShieldAlert size={22} style={{ verticalAlign: '-4px' }} /> {state === 'missing' ? 'Not found' : 'Could not check'}
            </h1>
            <p className="auth-subtitle">
              {state === 'missing'
                ? `This code does not match any document issued by ${profile.legalName}. Contact us before relying on it.`
                : 'The check could not be completed right now. Scan again later, or contact us to confirm the document.'}
            </p>
          </>
        )}
        {(profile.phone || profile.email) && (
          <p className="cell-sub" style={{ textAlign: 'center', marginTop: '0.5rem' }}>
            {[profile.phone, profile.email].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  );
};
