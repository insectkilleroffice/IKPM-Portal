// POST /api/delete-file — permanently deletes a file from Cloudinary when it is removed in the portal.
//
// Env (server only, never VITE_): CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET,
//      CLOUDINARY_FOLDER (defaults to VITE_CLOUDINARY_FOLDER / "ikpm-portal"), FIREBASE_PROJECT_ID.
// Only files inside the portal's own folder can be deleted, and only by roles that can edit files.

import { createHash } from 'node:crypto';
import { env, handle, HttpError, requirePortalUser, getPortalProfile, getRoleModules } from './_lib/shared';

const RESOURCE_TYPES = ['image', 'raw', 'video'];

export default handle(async (req, res) => {
  const user = await requirePortalUser(req);
  const profile = await getPortalProfile(req, user.uid, user.email);
  const modules = await getRoleModules(req, profile.role);
  if (modules !== 'all' && modules.files !== 'edit' && modules.documents !== 'edit') {
    throw new HttpError(403, 'Your role is not allowed to delete files.');
  }

  const cloud = env('CLOUDINARY_CLOUD_NAME') || env('VITE_CLOUDINARY_CLOUD_NAME');
  const apiKey = env('CLOUDINARY_API_KEY');
  const secret = env('CLOUDINARY_API_SECRET');
  if (!cloud || !apiKey || !secret) throw new HttpError(501, 'Cloudinary deletion is not configured on the server.');

  const { publicId, resourceType = 'image' } = req.body || {};
  const folder = (env('CLOUDINARY_FOLDER') || env('VITE_CLOUDINARY_FOLDER') || 'ikpm-portal').replace(/\/$/, '');
  if (typeof publicId !== 'string' || !publicId.startsWith(`${folder}/`) || publicId.includes('..')) {
    throw new HttpError(400, `Only files inside the "${folder}" folder can be deleted.`);
  }
  if (!RESOURCE_TYPES.includes(resourceType)) throw new HttpError(400, 'Unknown resource type.');

  const timestamp = Math.floor(Date.now() / 1000);
  const toSign = `invalidate=true&public_id=${publicId}&timestamp=${timestamp}`;
  const signature = createHash('sha1').update(toSign + secret).digest('hex');

  const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), invalidate: 'true', api_key: apiKey, signature });
  const r = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${resourceType}/destroy`, { method: 'POST', body });
  const data = (await r.json().catch(() => ({}))) as { result?: string; error?: { message?: string } };
  if (!r.ok) throw new HttpError(502, data.error?.message || `Cloudinary error (HTTP ${r.status})`);

  // "not found" is fine: the file is gone either way
  res.status(200).json({ ok: true, result: data.result });
});
