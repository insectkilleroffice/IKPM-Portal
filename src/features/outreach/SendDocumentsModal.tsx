import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Send, MessageCircle, Mail, Package, FileText, CheckSquare, Square, Zap, ExternalLink } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useNotification } from '../../contexts/NotificationContext';
import { useAuth } from '../../contexts/AuthContext';
import { useDataStore } from '../../hooks/useDataStore';
import { integrations } from '../../config/env';
import { uploadFile } from '../../lib/cloudinary';
import { pdfGenerator } from '../../lib/pdfGenerator';
import {
  buildPitchMessage,
  EMAIL_VIA_LABELS,
  emailOpensWindow,
  getPreferredEmailVia,
  isValidEmail,
  sendOutreach,
  setPreferredEmailVia,
  toWhatsAppNumber,
  type Attachment,
  type EmailVia,
  type OutreachResult,
} from '../../services/outreachService';
import { COMPANY_DOC_CATEGORIES, type OutreachChannel, type OutreachLog } from '../../types/document';
import type { Proposal } from '../../types/proposal';
import { expiryState, isShareable } from '../documents/documentUtils';

export interface SendDocumentsModalProps {
  isOpen: boolean;
  onClose: () => void;
  recipient: { name: string; phone?: string; email?: string };
  related: OutreachLog['related'];
  /** When set, the proposal PDF is generated, uploaded and attached automatically. */
  proposal?: Proposal;
  defaultPackId?: string;
  onSent?: (results: OutreachResult[]) => void;
}

export const SendDocumentsModal: React.FC<SendDocumentsModalProps> = ({
  isOpen,
  onClose,
  recipient,
  related,
  proposal,
  defaultPackId,
  onSent,
}) => {
  const store = useDataStore();
  const { success, warning, error } = useNotification();
  const { userProfile } = useAuth();

  const library = store.getLibraryDocuments();
  const packs = store.getDocumentPacks();
  const senderName = userProfile?.displayName || 'IKPM Sales Team';
  const senderEmail = userProfile?.businessEmail || userProfile?.email || '';

  const [name, setName] = useState(recipient.name);
  const [phone, setPhone] = useState(recipient.phone || '');
  const [email, setEmail] = useState(recipient.email || '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [activePack, setActivePack] = useState<string | null>(null);
  const [attachProposal, setAttachProposal] = useState(Boolean(proposal));
  const [channels, setChannels] = useState<Set<OutreachChannel>>(new Set());
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [emailVia, setEmailVia] = useState<EmailVia>(getPreferredEmailVia);

  // Re-initialise every time the modal opens for a (possibly different) recipient
  useEffect(() => {
    if (!isOpen) return;
    setName(recipient.name);
    setPhone(recipient.phone || '');
    setEmail(recipient.email || '');
    setAttachProposal(Boolean(proposal));
    const initialChannels = new Set<OutreachChannel>();
    if (recipient.phone) initialChannels.add('whatsapp');
    if (isValidEmail(recipient.email)) initialChannels.add('email');
    setChannels(initialChannels);
    const draft = buildPitchMessage({
      recipientName: recipient.name,
      senderName,
      senderEmail,
      purpose: proposal ? 'proposal' : 'documents',
      proposalRef: proposal ? `${proposal.id} R${proposal.revisionNumber}` : undefined,
    });
    setSubject(draft.subject);
    setMessage(draft.message);
    const pack = defaultPackId ?? (proposal ? undefined : packs[0]?.id);
    if (pack) applyPack(pack);
    else {
      setActivePack(null);
      setSelected(new Set());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const applyPack = (packId: string) => {
    setActivePack(packId);
    setSelected(new Set(store.resolvePack(packId).map((d) => d.id)));
  };

  const toggleDoc = (id: string) => {
    setActivePack(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleChannel = (c: OutreachChannel) =>
    setChannels((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });

  const grouped = COMPANY_DOC_CATEGORIES.map((c) => ({ ...c, docs: library.filter((d) => d.category === c.value) })).filter(
    (g) => g.docs.length > 0
  );

  const selectedDocs = library.filter((d) => selected.has(d.id));
  const localOnly = selectedDocs.filter((d) => d.file.storage === 'local');
  const phoneValid = toWhatsAppNumber(phone).length === 12;
  const emailValid = isValidEmail(email);

  const problems: string[] = [];
  if (channels.size === 0) problems.push('Choose WhatsApp and/or Email.');
  if (channels.has('whatsapp') && !phoneValid) problems.push('Enter a valid mobile number for WhatsApp (03XX XXXXXXX).');
  if (channels.has('email') && !emailValid) problems.push('Enter a valid email address.');
  if (selectedDocs.length === 0 && !attachProposal) problems.push('Select at least one document.');
  else if (!integrations.cloudinary && localOnly.length === selectedDocs.length && !(attachProposal && proposal)) {
    problems.push('These files are stored on this device only, so there are no links to send. Configure Cloudinary first.');
  }

  const handleSend = async () => {
    if (problems.length > 0) return;
    setSending(true);

    // Open link tabs synchronously so the browser doesn't block them after async work
    const linkWindow = channels.has('whatsapp') && !integrations.outreachApi ? window.open('', '_blank') : null;
    const emailWindow = channels.has('email') && emailOpensWindow(emailVia) ? window.open('', '_blank') : null;
    setPreferredEmailVia(emailVia);

    try {
      const extra: Attachment[] = [];
      if (proposal && attachProposal) {
        if (!integrations.cloudinary) {
          warning('Proposal PDF not attached', 'Configure Cloudinary to share the proposal as a link. Downloading it instead.');
          pdfGenerator.generateProposalPDF(proposal);
        } else {
          const fileName = pdfGenerator.proposalFileName(proposal);
          const stored = await uploadFile(pdfGenerator.proposalPDFBlob(proposal), { folder: `proposal/${proposal.id}`, fileName });
          store.saveDocument(
            {
              id: `DOC-${Date.now()}-pdf`,
              title: `Proposal ${proposal.id} R${proposal.revisionNumber}`,
              category: 'other',
              owner: { kind: 'proposal', id: proposal.id },
              file: stored,
              uploadedBy: userProfile?.email || 'admin',
              uploadedByName: senderName,
              uploadedAt: new Date().toISOString(),
            },
            userProfile?.email
          );
          extra.push({ title: `Proposal ${proposal.id} (R${proposal.revisionNumber})`, fileName, url: stored.url });
        }
      }

      const results = await sendOutreach({
        channels: (['whatsapp', 'email'] as OutreachChannel[]).filter((c) => channels.has(c)),
        recipientName: name,
        phone,
        email,
        subject,
        message,
        documents: selectedDocs,
        extraAttachments: extra,
        related,
        sender: { email: userProfile?.email || 'admin', name: senderName, businessEmail: senderEmail },
        emailVia,
        linkWindow,
        emailWindow,
      });

      const failed = results.filter((r) => !r.ok);
      const viaApi = results.filter((r) => r.ok && r.mode === 'api').map((r) => r.channel);
      const viaLink = results.filter((r) => r.ok && r.mode === 'link').map((r) => r.channel);
      if (viaApi.length) success('Sent', `Delivered via ${viaApi.join(' & ')} to ${name}.`);
      if (viaLink.length) success('Ready to send', `${viaLink.join(' & ')} opened with the message and document links — press Send there.`);
      results.filter((r) => r.note).forEach((r) => warning(r.channel === 'email' ? 'Email' : 'WhatsApp', r.note!));
      if (failed.length) error('Some messages failed', failed.map((f) => `${f.channel}: ${f.error}`).join(' | '));

      onSent?.(results);
      if (failed.length === 0) onClose();
    } catch (err) {
      linkWindow?.close();
      emailWindow?.close();
      error('Could not send', err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const channelLabel = [channels.has('whatsapp') && 'WhatsApp', channels.has('email') && 'Email'].filter(Boolean).join(' + ');

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !sending && onClose()}
      title={proposal ? `Send Proposal ${proposal.id} to Client` : 'Send Company Documents'}
      subtitle={`To ${recipient.name} • ${related.title}`}
      maxWidth="780px"
      footer={
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%', gap: '0.75rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
            {integrations.outreachApi && (!channels.has('email') || emailVia === 'api') ? (
              <><Zap size={13} color="var(--ikpm-emerald-600)" /> Sends automatically as {senderEmail}</>
            ) : (
              <><ExternalLink size={13} /> Opens WhatsApp / email with everything pre-filled</>
            )}
          </span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
            <button className="btn btn-primary" onClick={handleSend} disabled={sending || problems.length > 0} title={problems.join('\n')}>
              <Send size={15} />
              <span>{sending ? 'Sending…' : `Send${channelLabel ? ` via ${channelLabel}` : ''}`}</span>
            </button>
          </div>
        </div>
      }
    >
      {/* 1. Recipient */}
      <section className="flow-step">
        <div className="flow-step-title"><span className="flow-step-num">1</span> Recipient & channel</div>
        <div className="form-grid-3">
          <div className="form-group">
            <label className="form-label">Contact name</label>
            <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">WhatsApp number</label>
            <input className="form-input" placeholder="03001234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Email</label>
            <input className="form-input" type="email" placeholder="procurement@client.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button type="button" className={`chip ${channels.has('whatsapp') ? 'chip-on whatsapp' : ''}`} onClick={() => toggleChannel('whatsapp')}>
            <MessageCircle size={14} /> WhatsApp
          </button>
          <button type="button" className={`chip ${channels.has('email') ? 'chip-on' : ''}`} onClick={() => toggleChannel('email')}>
            <Mail size={14} /> Email
          </button>
        </div>
      </section>

      {/* 2. Documents */}
      <section className="flow-step">
        <div className="flow-step-title">
          <span className="flow-step-num">2</span> Documents
          <span style={{ marginLeft: 'auto', fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 600 }}>
            {selectedDocs.length + (attachProposal && proposal ? 1 : 0)} selected
          </span>
        </div>

        {proposal && (
          <label className="doc-check" style={{ marginBottom: '0.6rem' }}>
            <input type="checkbox" checked={attachProposal} onChange={(e) => setAttachProposal(e.target.checked)} />
            <FileText size={14} color="var(--ikpm-emerald-600)" />
            <span style={{ fontWeight: 700 }}>Proposal {proposal.id} (R{proposal.revisionNumber}) — PDF</span>
          </label>
        )}

        {library.length === 0 ? (
          <div className="empty-hint">
            No IKPM documents uploaded yet. Add your authority letters, NTN / SRB certificates and company profile once in the{' '}
            <Link to="/documents" onClick={onClose}>Document Library</Link> — then they're one click away for every pitch.
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {packs.map((p) => (
                <button key={p.id} type="button" className={`chip ${activePack === p.id ? 'chip-on' : ''}`} onClick={() => applyPack(p.id)} title={p.description}>
                  <Package size={13} /> {p.name} ({store.resolvePack(p.id).length})
                </button>
              ))}
              <button type="button" className="chip" onClick={() => { setActivePack(null); setSelected(new Set(library.filter(isShareable).map((d) => d.id))); }}>
                <CheckSquare size={13} /> All valid
              </button>
              <button type="button" className="chip" onClick={() => { setActivePack(null); setSelected(new Set()); }}>
                <Square size={13} /> None
              </button>
            </div>

            <div className="doc-check-list">
              {grouped.map((g) => (
                <div key={g.value}>
                  <div className="doc-group-label">{g.label}</div>
                  {g.docs.map((d) => {
                    const state = expiryState(d);
                    return (
                      <label key={d.id} className={`doc-check ${state === 'expired' ? 'is-disabled' : ''}`}>
                        <input type="checkbox" disabled={state === 'expired'} checked={selected.has(d.id)} onChange={() => toggleDoc(d.id)} />
                        <span style={{ flex: 1 }}>{d.title}</span>
                        {state === 'expired' && <span className="badge-status badge-rose">Expired</span>}
                        {state === 'expiring' && <span className="badge-status badge-amber">Expiring soon</span>}
                      </label>
                    );
                  })}
                </div>
              ))}
            </div>
            {localOnly.length > 0 && (
              <div className="empty-hint" style={{ marginTop: '0.5rem' }}>
                {localOnly.length} selected file(s) are stored on this device only and can't be shared as links. Configure Cloudinary and re-upload them.
              </div>
            )}
          </>
        )}
      </section>

      {/* 3. Message */}
      <section className="flow-step" style={{ borderBottom: 'none' }}>
        <div className="flow-step-title"><span className="flow-step-num">3</span> Message</div>
        {channels.has('email') && (
          <div className="form-grid-2">
            <div className="form-group">
              <label className="form-label">From</label>
              <input className="form-input" readOnly value={`${senderName} <${senderEmail}>`} title="Set by the super admin under Team & Access" />
            </div>
            <div className="form-group">
              <label className="form-label">Send email using</label>
              <select className="form-select" value={emailVia} onChange={(e) => setEmailVia(e.target.value as EmailVia)}>
                {(Object.keys(EMAIL_VIA_LABELS) as EmailVia[])
                  .filter((v) => v !== 'api' || integrations.outreachApi)
                  .map((v) => <option key={v} value={v}>{EMAIL_VIA_LABELS[v]}</option>)}
              </select>
            </div>
          </div>
        )}
        {channels.has('email') && emailVia !== 'api' && (
          <div className="info-hint" style={{ marginBottom: '0.75rem' }}>
            {emailVia === 'gmail' && <>A Gmail draft opens in <strong>{senderEmail}</strong>. Make sure you are signed in to that Google account, then press Send.</>}
            {emailVia === 'outlook' && <>An Outlook draft opens in your Microsoft 365 mailbox (<strong>{senderEmail}</strong>). Press Send there.</>}
            {emailVia === 'mailto' && <>Your computer's mail app opens a draft. Make sure its account is <strong>{senderEmail}</strong>.</>}
          </div>
        )}
        {channels.has('email') && (
          <div className="form-group">
            <label className="form-label">Email subject</label>
            <input className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
        )}
        <textarea className="form-textarea" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: 4 }}>
          Document links are added below the message automatically.
        </div>
        {problems.length > 0 && (
          <ul className="form-problems">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
      </section>
    </Modal>
  );
};
