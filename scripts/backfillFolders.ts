/**
 * One-time folder backfill for records saved before folders existed.
 *
 * DRY-RUN by default: reads Firestore, writes a report, changes nothing.
 *   npx tsx scripts/backfillFolders.ts --key=./service-account.json
 * Apply (only after reviewing the dry-run report):
 *   npx tsx scripts/backfillFolders.ts --key=./service-account.json --apply --by=you@company.com
 *
 * Options
 *   --key=path       Service account JSON (or set GOOGLE_APPLICATION_CREDENTIALS)
 *   --project=id     Firebase project id (default: FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID from .env.local)
 *   --only=a,b       Limit to these collections (documents, invoices, ...)
 *   --out=dir        Report folder (default scripts/reports)
 *   --by=email       Who ran it, for the audit log entry (apply only)
 *   --seed           Plan against the built-in sample data instead of Firestore (no credentials needed)
 *
 * Safe to re-run: records that already have a folderPath are skipped, so an interrupted --apply
 * simply continues where it stopped. Existing values are never overwritten and nothing is deleted.
 * Each write is conditional on the record not having changed since it was read.
 */

import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { FOLDER_COLLECTIONS, type FolderCollection } from '../src/lib/folderResolver';
import { lookupsFrom, planBackfill, reportMarkdown, type BackfillReport } from '../src/lib/folderBackfill';

type Rec = Record<string, unknown> & { id: string };

const BATCH_LIMIT = 400;
const LOOKUP_COLLECTIONS = ['companies', 'clients', 'leads', 'branches'] as const;

const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, '').split('=');
    return [k, v.length ? v.join('=') : 'true'] as const;
  })
);
const apply = args.get('apply') === 'true';
const useSeed = args.get('seed') === 'true';
const outDir = resolve(args.get('out') ?? 'scripts/reports');
const only = args.get('only')?.split(',').map((s) => s.trim()) as FolderCollection[] | undefined;
const collections = FOLDER_COLLECTIONS.filter((c) => !only || only.includes(c));

try {
  process.loadEnvFile?.('.env.local');
} catch {
  // No .env.local: rely on the environment / flags
}

/** Firestore Timestamps → ISO strings so dates file into the right year / month. */
function plain(id: string, data: Record<string, unknown>): Rec {
  const out: Rec = { id };
  for (const [k, v] of Object.entries(data)) {
    out[k] = v && typeof v === 'object' && 'toDate' in v && typeof (v as { toDate: unknown }).toDate === 'function' ? (v as { toDate: () => Date }).toDate().toISOString() : v;
  }
  return out;
}

async function loadSeed() {
  if (apply) throw new Error('--seed cannot be combined with --apply.');
  const seed = await import('../src/services/seedData');
  const records: Partial<Record<FolderCollection, Rec[]>> = {
    proposals: seed.SEED_PROPOSALS as unknown as Rec[],
    contracts: seed.SEED_CONTRACTS as unknown as Rec[],
    service_jobs: seed.SEED_SERVICE_JOBS as unknown as Rec[],
    invoices: seed.SEED_INVOICES as unknown as Rec[],
    document_packs: seed.SEED_DOCUMENT_PACKS as unknown as Rec[],
    documents: [],
    payments: [],
    outreach_logs: [],
  };
  const lookups = lookupsFrom({
    companies: seed.SEED_COMPANIES as unknown as Rec[],
    clients: seed.SEED_INDIVIDUAL_CLIENTS as unknown as Rec[],
    leads: seed.SEED_LEADS as unknown as Rec[],
    branches: seed.SEED_BRANCHES as unknown as Rec[],
    proposals: records.proposals,
    service_jobs: records.service_jobs,
    invoices: records.invoices,
  });
  return { records, lookups, updateTimes: new Map<string, unknown>(), db: null };
}

async function loadFirestore() {
  const { initializeApp, cert, applicationDefault } = await import('firebase-admin/app');
  const { getFirestore } = await import('firebase-admin/firestore');
  const key = args.get('key');
  const projectId = args.get('project') || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID;
  if (!projectId) throw new Error('Set --project=<id> or FIREBASE_PROJECT_ID.');
  if (key && !existsSync(key)) throw new Error(`Service account file not found: ${key}`);
  initializeApp({ credential: key ? cert(resolve(key)) : applicationDefault(), projectId });
  const db = getFirestore();

  const updateTimes = new Map<string, unknown>();
  const read = async (name: string) => {
    const snap = await db.collection(name).get();
    return snap.docs.map((d) => {
      updateTimes.set(`${name}/${d.id}`, d.updateTime);
      return plain(d.id, d.data());
    });
  };

  const lookupData: Record<string, Rec[]> = {};
  for (const name of [...LOOKUP_COLLECTIONS, 'proposals', 'service_jobs', 'invoices']) {
    console.log(`Reading ${name}…`);
    lookupData[name] = await read(name);
  }
  const records: Partial<Record<FolderCollection, Rec[]>> = {};
  for (const name of collections) {
    if (!lookupData[name]) console.log(`Reading ${name}…`);
    records[name] = lookupData[name] ?? (await read(name));
  }
  return { records, lookups: lookupsFrom(lookupData), updateTimes, db };
}

async function main() {
  const source = useSeed ? 'built-in sample data' : `Firestore project ${args.get('project') || process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID}`;
  console.log(`Folder backfill: ${apply ? 'APPLY' : 'DRY-RUN (no changes)'} · ${source}`);

  const { records, lookups, updateTimes, db } = useSeed ? await loadSeed() : await loadFirestore();
  const report: BackfillReport = planBackfill(records, lookups, { mode: apply ? 'apply' : 'dry-run', source });

  mkdirSync(outDir, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, '-');
  const base = resolve(outDir, `backfill-${apply ? 'apply' : 'dry-run'}-${stamp}`);
  writeFileSync(`${base}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${base}.md`, reportMarkdown(report));
  console.log(reportMarkdown(report).split('\n').slice(0, 16).join('\n'));
  console.log(`\nReport: ${base}.md (full detail in .json)`);

  if (!apply) {
    console.log('\nDry run only. Review the report, then re-run with --apply.');
    return;
  }
  if (!db) return;

  // Apply in batches of at most 400; each write only if the record is unchanged since it was read
  const { FieldValue } = await import('firebase-admin/firestore');
  const progressFile = `${base}.progress.json`;
  const done: string[] = [];
  let failedBatches = 0;
  for (let i = 0; i < report.changes.length; i += BATCH_LIMIT) {
    const slice = report.changes.slice(i, i + BATCH_LIMIT);
    const batch = db.batch();
    for (const c of slice) {
      const ref = db.collection(c.collection).doc(c.id);
      const lastUpdateTime = updateTimes.get(`${c.collection}/${c.id}`);
      batch.update(ref, { ...c.patch, folderBackfilledAt: FieldValue.serverTimestamp() }, lastUpdateTime ? ({ lastUpdateTime } as never) : undefined);
    }
    try {
      await batch.commit();
      done.push(...slice.map((c) => `${c.collection}/${c.id}`));
      writeFileSync(progressFile, JSON.stringify({ committed: done.length, of: report.changes.length, ids: done }, null, 2));
      console.log(`Committed ${done.length}/${report.changes.length}`);
    } catch (err) {
      failedBatches++;
      console.error(`Batch starting at ${i} failed (a record probably changed since it was read): ${err instanceof Error ? err.message : err}`);
      console.error('Nothing in that batch was written. Re-run the script to pick those records up again.');
    }
  }

  const t = report.totals;
  await db.collection('audit_logs').doc(`log_${Date.now()}_backfill`).set({
    id: `log_${Date.now()}_backfill`,
    timestamp: new Date().toISOString(),
    userId: 'backfill-script',
    userEmail: args.get('by') || 'backfill-script',
    action: 'update',
    entityType: 'document',
    entityId: 'folder-backfill',
    entityTitle: 'Folder backfill',
    details: `Folder backfill applied: ${done.length} record(s) filed of ${t.toUpdate} planned; ${t.alreadyFiled} already filed, ${t.unresolved} unresolved, ${t.conflicts} conflicts${failedBatches ? `, ${failedBatches} batch(es) failed` : ''}.`,
    afterData: { filed: done.length, planned: t.toUpdate, unresolved: t.unresolved, conflicts: t.conflicts },
  });
  console.log(`\nDone: ${done.length} record(s) filed. Summary written to audit_logs.`);
  if (failedBatches) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
