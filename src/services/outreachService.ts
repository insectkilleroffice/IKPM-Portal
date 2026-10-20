// Sends pitch documents to clients over WhatsApp and Email.
// With VITE_OUTREACH_API_URL configured, messages go out automatically through the serverless API
// (WhatsApp Cloud API / Resend). Otherwise — or if the API fails — it opens a pre-filled wa.me / mailto
// draft so the salesperson only has to press Send.

import { auth } from '../lib/firebase';
import { outreachEnv, integrations } from '../config/env';
import { normalizePakistaniPhone } from '../lib/formatters';
import { dataService } from './dataService';
import type { OutreachChannel, OutreachLog, PortalDocument } from '../types/document';

export interface Attachment {
  title: string;
  fileName: string;
  url: string;
}

export interface OutreachRequest {
  channels: OutreachChannel[];
  recipientName: string;
  phone?: string;
  email?: string;
  subject: string;
  message: string;
  documents: PortalDocument[];
  extraAttachments?: Attachment[]; // e.g. generated proposal PDF
  related: OutreachLog['related'];
  sender: { email: string; name: string };
  /** Window opened synchronously in the click handler, so the wa.me link isn't popup-blocked after async work. */
  linkWindow?: Window | null;
}

export interface OutreachResult {
  channel: OutreachChannel;
  mode: OutreachLog['mode'];
  ok: boolean;
  error?: string;
  note?: string;
}

export const toWhatsAppNumber = (phone: string) => normalizePakistaniPhone(phone).replace(/\D/g, '');

export const isValidEmail = (email?: string) => Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));

export function collectAttachments(documents: PortalDocument[], extra: Attachment[] = []): Attachment[] {
  // Local (non-Cloudinary) files are data URLs and can't be shared as links
  const docs = documents
    .filter((d) => d.file.storage === 'cloudinary')
    .map((d) => ({ title: d.title, fileName: d.file.fileName, url: d.file.url }));
  return [...extra, ...docs];
}

/** Default pitch message. Kept short — WhatsApp messages are read on phones. */
export function buildPitchMessage(opts: {
  recipientName: string;
  senderName: string;
  purpose: 'documents' | 'proposal';
  proposalRef?: string;
}): { subject: string; message: string } {
  const first = opts.recipientName.split(' ')[0] || 'Sir/Madam';
  const subject =
    opts.purpose === 'proposal'
      ? `IKPM Proposal ${opts.proposalRef ?? ''} & Company Documents`.replace(/\s+/g, ' ')
      : `${outreachEnv.companyName} — Company Documents`;

  const intro =
    opts.purpose === 'proposal'
      ? `Please find attached our pest management proposal${opts.proposalRef ? ` (${opts.proposalRef})` : ''} along with the company documents you requested.`
      : 'As discussed, please find our company documents for your vendor registration / review.';

  const message = [
    `Dear ${first},`,
    '',
    `Greetings from ${outreachEnv.companyName}.`,
    intro,
    '',
    'Feel free to reach out for any clarification or to schedule a site inspection.',
    '',
    'Regards,',
    opts.senderName,
    `${outreachEnv.companyName}`,
    `${outreachEnv.companyPhone} | ${outreachEnv.companyWebsite}`,
  ].join('\n');

  return { subject, message };
}

function withLinks(message: string, attachments: Attachment[]): string {
  if (attachments.length === 0) return message;
  const list = attachments.map((a, i) => `${i + 1}. ${a.title}\n${a.url}`).join('\n');
  return `${message}\n\n📎 Documents:\n${list}`;
}

async function callApi(path: string, body: unknown) {
  const token = await auth.currentUser?.getIdToken().catch(() => undefined);
  const res = await fetch(`${outreachEnv.apiBaseUrl.replace(/\/$/, '')}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

async function sendWhatsApp(req: OutreachRequest, attachments: Attachment[]): Promise<OutreachResult> {
  const to = toWhatsAppNumber(req.phone || '');
  if (integrations.outreachApi) {
    try {
      const data = await callApi('send-whatsapp', {
        to,
        recipientName: req.recipientName,
        message: req.message,
        documents: attachments.map((a) => ({ url: a.url, fileName: a.fileName })),
      });
      req.linkWindow?.close();
      return { channel: 'whatsapp', mode: 'api', ok: true, note: data.note };
    } catch (err) {
      console.warn('WhatsApp API failed, falling back to wa.me link', err);
    }
  }
  const url = `https://wa.me/${to}?text=${encodeURIComponent(withLinks(req.message, attachments))}`;
  if (req.linkWindow && !req.linkWindow.closed) req.linkWindow.location.href = url;
  else window.open(url, '_blank', 'noopener');
  return { channel: 'whatsapp', mode: 'link', ok: true };
}

async function sendEmail(req: OutreachRequest, attachments: Attachment[]): Promise<OutreachResult> {
  if (integrations.outreachApi) {
    try {
      await callApi('send-email', {
        to: req.email,
        subject: req.subject,
        text: withLinks(req.message, attachments),
        attachments: attachments.map((a) => ({ filename: a.fileName, path: a.url })),
        replyTo: req.sender.email,
      });
      return { channel: 'email', mode: 'api', ok: true };
    } catch (err) {
      console.warn('Email API failed, falling back to mailto link', err);
    }
  }
  const body = withLinks(req.message, attachments);
  window.location.href = `mailto:${encodeURIComponent(req.email || '')}?subject=${encodeURIComponent(req.subject)}&body=${encodeURIComponent(body)}`;
  return { channel: 'email', mode: 'link', ok: true };
}

export async function sendOutreach(req: OutreachRequest): Promise<OutreachResult[]> {
  const attachments = collectAttachments(req.documents, req.extraAttachments);
  const results: OutreachResult[] = [];

  for (const channel of req.channels) {
    let result: OutreachResult;
    try {
      result = channel === 'whatsapp' ? await sendWhatsApp(req, attachments) : await sendEmail(req, attachments);
    } catch (err) {
      result = { channel, mode: 'link', ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    results.push(result);

    dataService.logOutreach({
      id: `OUT-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      channel,
      mode: result.mode,
      status: !result.ok ? 'failed' : result.mode === 'api' ? 'sent' : 'opened',
      error: result.error,
      recipientName: req.recipientName,
      recipient: channel === 'whatsapp' ? req.phone || '' : req.email || '',
      subject: channel === 'email' ? req.subject : undefined,
      message: req.message,
      documentIds: req.documents.map((d) => d.id),
      attachmentUrls: attachments.map((a) => a.url),
      related: req.related,
      sentBy: req.sender.email,
      sentByName: req.sender.name,
      sentAt: new Date().toISOString(),
    });
  }

  dataService.logAudit({
    userId: req.sender.email,
    userEmail: req.sender.email,
    action: 'create',
    entityType: 'outreach',
    entityId: req.related.id,
    entityTitle: req.related.title,
    details: `Shared ${attachments.length} document(s) with ${req.recipientName} via ${req.channels.join(' + ')}`,
  });

  return results;
}
