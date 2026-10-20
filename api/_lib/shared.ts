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
