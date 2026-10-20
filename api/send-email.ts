// POST /api/send-email — emails a client from the signed-in staff member's business address,
// with the documents attached (Resend: https://resend.com).
//
// Env: RESEND_API_KEY
//      EMAIL_SENDER_DOMAINS  comma-separated domains verified in Resend (e.g. "insectkiller.pk").
//                            Staff whose business email is on one of these domains send AS themselves.
//      EMAIL_FROM            fallback sender for other addresses (e.g. "IKPM Portal <portal@insectkiller.pk>");
//                            the message then goes out "Name via IKPM" with Reply-To set to the staff member.
//      FIREBASE_PROJECT_ID   (or VITE_FIREBASE_PROJECT_ID) to look up the sender's profile.

import { env, handle, HttpError, requirePortalUser, getPortalProfile, assertOwnCloudinaryUrl } from './_lib/shared';

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Display names go inside a quoted From header — strip characters that would break it. */
const safeName = (s: string) => s.replace(/["<>\r\n]/g, '').trim().slice(0, 80);

const addressOf = (from: string) => (from.match(/<([^>]+)>/)?.[1] || from).trim();

export default handle(async (req, res) => {
  const user = await requirePortalUser(req);
  const profile = await getPortalProfile(req, user.uid, user.email);
  if (!['super_admin', 'management', 'sales', 'operations', 'finance'].includes(profile.role)) {
    throw new HttpError(403, 'Your role is not allowed to email clients.');
  }
  if (!env('RESEND_API_KEY')) throw new HttpError(501, 'Email is not configured on the server.');

  const { to, subject, text, attachments = [] } = req.body || {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to))) throw new HttpError(400, 'A valid recipient email is required.');
  if (!subject || !text) throw new HttpError(400, 'Subject and message are required.');
  attachments.forEach((a: { path: string }) => assertOwnCloudinaryUrl(a.path));

  const verified = env('EMAIL_SENDER_DOMAINS').split(',').map((d) => d.trim().toLowerCase()).filter(Boolean);
  const senderDomain = profile.businessEmail.split('@')[1] || '';
  const name = safeName(profile.displayName);
  const sendsAsSelf = verified.includes(senderDomain);

  let from: string;
  if (sendsAsSelf) {
    from = `"${name}" <${profile.businessEmail}>`;
  } else if (env('EMAIL_FROM')) {
    from = `"${name} via IKPM" <${addressOf(env('EMAIL_FROM'))}>`;
  } else {
    throw new HttpError(501, `Emails can't be sent from ${profile.businessEmail} yet. Verify ${senderDomain} in Resend and add it to EMAIL_SENDER_DOMAINS.`);
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: profile.businessEmail,
      // Keep a copy in the sender's own mailbox
      bcc: env('EMAIL_BCC_SENDER') === 'false' ? undefined : [profile.businessEmail],
      subject: String(subject).slice(0, 200),
      text,
      html: `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#0f172a">${escapeHtml(text).replace(/\n/g, '<br>')}</div>`,
      attachments, // Resend downloads each { filename, path } and attaches it (40 MB total limit)
    }),
  });
  const data = (await r.json().catch(() => ({}))) as { id?: string; message?: string };
  if (!r.ok) throw new HttpError(502, data.message || `Email provider error (HTTP ${r.status})`);

  res.status(200).json({ ok: true, id: data.id, from, sentAsSelf: sendsAsSelf });
});
