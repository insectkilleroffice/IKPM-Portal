/**
 * Clears ALL Firestore data so the portal starts from scratch. Staff logins stay.
 *
 *   npx tsx scripts/resetData.ts --key=./service-account.json            (dry run: lists what would go)
 *   npx tsx scripts/resetData.ts --key=./service-account.json --apply    (backs up to ./backups, then deletes)
 *
 * Kept: users (staff profiles), Firebase Authentication accounts (never touched here) and the
 * system_config/initialization flag (without it the setup screen would let anyone with the setup
 * key create a new super admin). Everything else goes, incl. roles, teams, company profile and
 * templates; built-in roles and tax rules are re-created when the super admin next signs in.
 * --keep=a,b keeps extra collections. Files in Cloudinary are not deleted.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.join('=') || 'true'] as [string, string];
  })
);

const ALWAYS_KEEP = ['users'];
/** Docs kept inside collections that are otherwise cleared. */
const KEEP_DOCS: Record<string, string[]> = { system_config: ['initialization'] };

async function main() {
  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const key = args.get('key');
  const projectId = args.get('project') || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID || 'insect-killer-7d901';
  if (key && !existsSync(key)) throw new Error(`Service account file not found: ${key}`);
  initializeApp({ credential: key ? cert(resolve(key)) : applicationDefault(), projectId });
  const db = getFirestore();

  const keep = new Set([...ALWAYS_KEEP, ...(args.get('keep') || '').split(',').filter(Boolean)]);

  const collections = (await db.listCollections()).map((c) => c.id).sort();
  const targets = collections.filter((c) => !keep.has(c));
  const apply = args.get('apply') === 'true';

  console.log(`Project: ${projectId}`);
  console.log(`Kept:    ${collections.filter((c) => keep.has(c)).join(', ') || '—'}`);
  const counts: Record<string, number> = {};
  for (const c of targets) counts[c] = (await db.collection(c).count().get()).data().count;
  console.log('Will delete:');
  targets.forEach((c) => console.log(`  ${c.padEnd(24)} ${counts[c]} docs${KEEP_DOCS[c] ? ` (keeping ${KEEP_DOCS[c].join(', ')})` : ''}`));
  if (!apply) {
    console.log('\nDry run only. Re-run with --apply to back up and delete.');
    return;
  }

  // Backup first (JSON per collection, including subcollections' parent docs only)
  const dir = resolve('backups', `firestore-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  mkdirSync(dir, { recursive: true });
  for (const c of targets) {
    const snap = await db.collection(c).get();
    writeFileSync(resolve(dir, `${c}.json`), JSON.stringify(snap.docs.map((d) => ({ id: d.id, ...d.data() })), null, 2));
  }
  console.log(`Backup written to ${dir}`);

  for (const c of targets) {
    const kept = KEEP_DOCS[c];
    if (kept) {
      const snap = await db.collection(c).get();
      for (const d of snap.docs) if (!kept.includes(d.id)) await db.recursiveDelete(d.ref);
    } else await db.recursiveDelete(db.collection(c));
    console.log(`Deleted ${c}`);
  }
  console.log('Done. Staff can sign in as before; business data is empty.');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
