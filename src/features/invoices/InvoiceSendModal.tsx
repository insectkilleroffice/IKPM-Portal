// Send an approved invoice to the client: automatic email (PDF attached) when the server is set up,
// otherwise WhatsApp / Gmail / Outlook with a link to the invoice PDF in the client's folder.
// Nothing is downloaded to the sender's computer.

import React, { useState } from 'react';
import { Send } from 'lucide-react';
import { Modal } from '../../components/common/Modal';
import { useAuth } from '../../contexts/AuthContext';
import { useNotification } from '../../contexts/NotificationContext';
import { formatPKR } from '../../lib/formatters';
import type { ClientStatement, Invoice } from '../../types/finance';
import { sendStatementToClient, statementAmounts, statementMessage, statementRecipient } from './statements';
import {
  channelBlocker, invoiceMessage, invoiceRecipient, SEND_CHANNEL_LABELS, sendInvoiceToClient, type InvoiceSendChannel,
} from './invoiceWorkflow';

const CHANNELS: InvoiceSendChannel[] = ['email_auto', 'whatsapp', 'email_gmail', 'email_outlook'];

/** Sends an approved invoice, or (with `statement`) an approved client statement. */
export const InvoiceSendModal: React.FC<{
  invoice?: Invoice;
  statement?: ClientStatement;
  onClose: () => void;
  onSent: (sent: Invoice | ClientStatement) => void;
}> = ({ invoice, statement, onClose, onSent }) => {
  const { userProfile } = useAuth();
  const { success, error } = useNotification();
  const actor = {
    uid: userProfile?.uid || '',
    email: userProfile?.email || 'admin',
    name: userProfile?.displayName || userProfile?.email || 'Finance',
    businessEmail: userProfile?.businessEmail || userProfile?.email || '',
  };
  const rec = statement ? statementRecipient(statement) : invoiceRecipient(invoice!);
  const draft = statement ? statementMessage(statement, rec.name, actor) : invoiceMessage(invoice!, rec.name, actor);
  const docNumber = statement ? statement.statementNumber : invoice!.invoiceNumber;
  const docTotal = statement ? statementAmounts(statement).totalDue : invoice!.grossPayable;
  const docClient = statement ? statement.customerName : invoice!.customerName;
  const firstAvailable = CHANNELS.find((c) => !channelBlocker(c)) ?? 'whatsapp';
  const [channel, setChannel] = useState<InvoiceSendChannel>(firstAvailable);
  const [name, setName] = useState(rec.name);
  const [email, setEmail] = useState(rec.email || '');
  const [phone, setPhone] = useState(rec.phone || '');
  const [subject, setSubject] = useState(draft.subject);
  const [message, setMessage] = useState(draft.message);
  const [busy, setBusy] = useState(false);
  const blocker = channelBlocker(channel);
  const isWhatsApp = channel === 'whatsapp';

  const send = async () => {
    // Tabs must open inside the click, before any waiting, or the browser blocks them
    const linkWindow = isWhatsApp ? window.open('', '_blank') : null;
    const emailWindow = channel === 'email_gmail' || channel === 'email_outlook' ? window.open('', '_blank') : null;
    setBusy(true);
    try {
      const opts = { channel, name, email, phone, subject, message, linkWindow, emailWindow };
      const sent = statement ? await sendStatementToClient(statement, actor, opts) : await sendInvoiceToClient(invoice!, actor, opts);
      success(
        channel === 'email_auto' ? 'Invoice emailed' : 'Message ready',
        channel === 'email_auto'
          ? `${docNumber} emailed to ${email}.`
          : `${isWhatsApp ? 'WhatsApp' : 'Your email'} opened with the message and the invoice link. Press Send there.`
      );
      onSent(sent);
      onClose();
    } catch (err) {
      linkWindow?.close();
      emailWindow?.close();
      error('Could not send', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={() => !busy && onClose()}
      title={`Send ${docNumber} to the client`}
      subtitle={`${docClient} · ${formatPKR(docTotal)}${statement ? ' due' : ''}`}
      maxWidth="620px"
      footer={
        <>
          <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={send} disabled={busy || Boolean(blocker)} title={blocker}>
            <Send size={14} /> <span>{busy ? 'Sending…' : channel === 'email_auto' ? 'Send email' : `Open ${isWhatsApp ? 'WhatsApp' : 'email'}`}</span>
          </button>
        </>
      }
    >
      <div className="form-group">
        <label className="form-label">Send by</label>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
          {CHANNELS.map((c) => {
            const why = channelBlocker(c);
            return (
              <label key={c} className="doc-check" style={{ opacity: why ? 0.55 : 1 }} title={why}>
                <input type="radio" name="sendvia" checked={channel === c} disabled={Boolean(why)} onChange={() => setChannel(c)} />
                <span>{SEND_CHANNEL_LABELS[c]}{why && <span className="cell-sub" style={{ display: 'block' }}>{why}</span>}</span>
              </label>
            );
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div className="form-group">
          <label className="form-label">Client contact</label>
          <input className="form-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {isWhatsApp ? (
          <div className="form-group">
            <label className="form-label">WhatsApp number *</label>
            <input className="form-input" value={phone} inputMode="tel" placeholder="03xx-xxxxxxx" onChange={(e) => setPhone(e.target.value)} />
          </div>
        ) : (
          <div className="form-group">
            <label className="form-label">Email *</label>
            <input className="form-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        )}
      </div>
      {!isWhatsApp && (
        <div className="form-group">
          <label className="form-label">Subject</label>
          <input className="form-input" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
      )}
      <div className="form-group" style={{ marginBottom: 0 }}>
        <label className="form-label">Message</label>
        <textarea className="form-textarea" rows={8} value={message} onChange={(e) => setMessage(e.target.value)} />
        <div className="cell-sub" style={{ marginTop: 4 }}>
          {channel === 'email_auto' ? `The ${statement ? 'statement' : 'invoice'} PDF is attached.` : `A link to the ${statement ? 'statement' : 'invoice'} PDF is added below the message.`}{statement ? ' The statement includes every visit invoice of the period.' : ''} Nothing is downloaded to your computer.
        </div>
      </div>
    </Modal>
  );
};
