// Shared helpers for the outreach serverless functions (Vercel Node runtime).
// Files under api/_lib are not exposed as routes.

export interface Req {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  body?: any;
}

export interface Res {
  status(code: number): Res;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export function env(name: string): string {
  return process.env[name] || '';
}

/** Verifies the caller is a signed-in, active portal user using their Firebase ID token. */
export async function requirePortalUser(req: Req): Promise<{ uid: string; email: string }> {
  const header = String(req.headers.authorization || '');
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) throw new HttpError(401, 'Sign in required.');

  const apiKey = env('FIREBASE_API_KEY') || env('VITE_FIREBASE_API_KEY');
  const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idToken: token }),
  });
  const data = (await res.json().catch(() => ({}))) as { users?: { localId: string; email: string; disabled?: boolean }[] };
  const user = data.users?.[0];
  if (!res.ok || !user || user.disabled) throw new HttpError(401, 'Invalid or expired session.');
  return { uid: user.localId, email: user.email };
}

export interface PortalProfile {
  displayName: string;
  businessEmail: string;
  role: string;
  isActive: boolean;
}

/**
 * Reads the caller's staff profile from Firestore using their own ID token, so the security rules
 * decide what is visible and nobody can claim someone else's sender address.
 */
export async function getPortalProfile(req: Req, uid: string, loginEmail: string): Promise<PortalProfile> {
  const header = String(req.headers.authorization || '');
  const projectId = env('FIREBASE_PROJECT_ID') || env('VITE_FIREBASE_PROJECT_ID');
  if (!projectId) throw new HttpError(500, 'FIREBASE_PROJECT_ID is not configured on the server.');

  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users/${encodeURIComponent(uid)}`,
    { headers: { Authorization: header } }
  );
  if (res.status === 404) throw new HttpError(403, 'Your staff profile was not found. Ask the super admin to add you.');
  if (!res.ok) throw new HttpError(403, `Could not read your staff profile (HTTP ${res.status}).`);
  const data = (await res.json()) as { fields?: Record<string, { stringValue?: string; booleanValue?: boolean }> };
  const f = data.fields || {};
  const profile: PortalProfile = {
    displayName: f.displayName?.stringValue || loginEmail,
    businessEmail: (f.businessEmail?.stringValue || loginEmail).toLowerCase(),
    role: f.role?.stringValue || '',
    isActive: f.isActive?.booleanValue === true,
  };
  if (!profile.isActive) throw new HttpError(403, 'Your portal access is paused.');
  return profile;
}

/** Module access levels of the caller's role (read with their own token; super admin = everything). */
export async function getRoleModules(req: Req, role: string): Promise<Record<string, string> | 'all'> {
  if (role === 'super_admin') return 'all';
  const projectId = env('FIREBASE_PROJECT_ID') || env('VITE_FIREBASE_PROJECT_ID');
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/roles/${encodeURIComponent(role)}`,
    { headers: { Authorization: String(req.headers.authorization || '') } }
  );
  if (!res.ok) throw new HttpError(403, 'Your role could not be verified.');
  const data = (await res.json()) as { fields?: { modules?: { mapValue?: { fields?: Record<string, { stringValue?: string }> } } } };
  const fields = data.fields?.modules?.mapValue?.fields || {};
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.stringValue || 'none']));
}

/** Only allow attachments hosted in our own Cloudinary account, so the API can't be used to relay arbitrary links. */
export function assertOwnCloudinaryUrl(url: string) {
  const cloud = env('CLOUDINARY_CLOUD_NAME') || env('VITE_CLOUDINARY_CLOUD_NAME');
  let ok = false;
  try {
    const u = new URL(url);
    ok = u.protocol === 'https:' && u.hostname === 'res.cloudinary.com' && (!cloud || u.pathname.startsWith(`/${cloud}/`));
  } catch {
    ok = false;
  }
  if (!ok) throw new HttpError(400, `Attachment must be a Cloudinary URL from this account: ${url}`);
}

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handle(fn: (req: Req, res: Res) => Promise<void>) {
  return async (req: Req, res: Res) => {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    try {
      await fn(req, res);
    } catch (err) {
      const status = err instanceof HttpError ? err.status : 500;
      res.status(status).json({ error: err instanceof Error ? err.message : 'Unexpected error' });
    }
  };
}
