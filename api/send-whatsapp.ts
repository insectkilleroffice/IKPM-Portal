// POST /api/send-whatsapp — sends a text message + document attachments via the WhatsApp Cloud API (Meta).
//
// Env: WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID
// Optional: WHATSAPP_TEMPLATE_NAME, WHATSAPP_TEMPLATE_LANG (default "en")
//
// WhatsApp only allows free-form messages within 24h of the client's last message. For first contact
// configure an approved template (body with one {{1}} = client name); it is sent when the free-form
// message is rejected, and the client receives the documents once they reply.

import { env, handle, HttpError, requirePortalUser, assertOwnCloudinaryUrl } from './_lib/shared';

const GRAPH = 'https://graph.facebook.com/v21.0';

async function send(payload: Record<string, unknown>) {
  const res = await fetch(`${GRAPH}/${env('WHATSAPP_PHONE_NUMBER_ID')}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('WHATSAPP_TOKEN')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', ...payload }),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: { code?: number; message?: string }; messages?: { id: string }[] };
  if (!res.ok) {
    const e = new HttpError(502, data.error?.message || `WhatsApp API error (HTTP ${res.status})`) as HttpError & { code?: number };
    e.code = data.error?.code;
    throw e;
  }
  return data.messages?.[0]?.id;
}

export default handle(async (req, res) => {
  await requirePortalUser(req);
  if (!env('WHATSAPP_TOKEN') || !env('WHATSAPP_PHONE_NUMBER_ID')) throw new HttpError(501, 'WhatsApp is not configured on the server.');

  const { to, recipientName, message, documents = [] } = req.body || {};
  if (!/^92\d{10}$/.test(String(to))) throw new HttpError(400, 'Recipient must be a Pakistani mobile number (92XXXXXXXXXX).');
  if (!message || typeof message !== 'string') throw new HttpError(400, 'Message is required.');
  documents.forEach((d: { url: string }) => assertOwnCloudinaryUrl(d.url));

  const ids: string[] = [];
  try {
    ids.push((await send({ to, type: 'text', text: { body: message.slice(0, 4096), preview_url: true } })) || '');
  } catch (err) {
    // 131047 = outside 24h customer-service window -> use approved template to open the conversation
    const template = env('WHATSAPP_TEMPLATE_NAME');
    if ((err as { code?: number }).code !== 131047 || !template) throw err;
    ids.push(
      (await send({
        to,
        type: 'template',
        template: {
          name: template,
          language: { code: env('WHATSAPP_TEMPLATE_LANG') || 'en' },
          components: [{ type: 'body', parameters: [{ type: 'text', text: String(recipientName || 'Sir/Madam') }] }],
        },
      })) || ''
    );
    return res.status(202).json({ ok: true, ids, note: 'Template sent. Documents can be shared once the client replies.' });
  }

  for (const d of documents as { url: string; fileName: string }[]) {
    ids.push((await send({ to, type: 'document', document: { link: d.url, filename: d.fileName } })) || '');
  }

  res.status(200).json({ ok: true, ids });
});
