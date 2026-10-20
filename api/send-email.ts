// POST /api/send-email — sends an email with the documents attached (Resend: https://resend.com).
//
// Env: RESEND_API_KEY, EMAIL_FROM (e.g. "IKPM Sales <sales@insectkiller.pk>" on a verified domain)

import { env, handle, HttpError, requirePortalUser, assertOwnCloudinaryUrl } from './_lib/shared';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export default handle(async (req, res) => {
  const user = await requirePortalUser(req);
  if (!env('RESEND_API_KEY') || !env('EMAIL_FROM')) throw new HttpError(501, 'Email is not configured on the server.');

  const { to, subject, text, attachments = [], replyTo } = req.body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) throw new HttpError(400, 'A valid recipient email is required.');
  if (!subject || !text) throw new HttpError(400, 'Subject and message are required.');
  attachments.forEach((a: { path: string }) => assertOwnCloudinaryUrl(a.path));

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env('EMAIL_FROM'),
      to: [to],
      reply_to: replyTo || user.email,
      subject: String(subject).slice(0, 200),
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
      attachments, // Resend downloads each { filename, path } and attaches it (40 MB total limit)
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) throw new HttpError(502, data.message || `Email provider error (HTTP ${r.status})`);

  res.status(200).json({ ok: true, id: data.id });
});
