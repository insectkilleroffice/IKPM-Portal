// Plans the one-time folder backfill for records saved before folders existed.
// Pure: scripts/backfillFolders.ts loads Firestore (or the seed data) and writes the result.
// Never guesses: records it can't link to an owner are reported, and existing values are never
// overwritten (a different computed value is reported as a conflict instead).

import type { FolderMeta } from '../types/folders';
import { clientInfoFrom, FOLDER_COLLECTIONS, recordLink, resolveFolderFrom, type FolderCollection, type FolderLookups } from './folderResolver';

type Rec = Record<string, unknown> & { id: string };

const FIELDS: (keyof FolderMeta)[] = ['ownerScope', 'clientId', 'clientType', 'branchId', 'fileCategory', 'folderPath'];
/** A different existing value in one of these means the record belongs elsewhere: don't touch it. */
const OWNER_FIELDS: (keyof FolderMeta)[] = ['ownerScope', 'clientId', 'branchId'];

export interface BackfillChange {
  collection: FolderCollection;
  id: string;
  /** Only fields the record doesn't have yet. */
  patch: FolderMeta;
}

export interface CollectionSummary {
  total: number;
  alreadyFiled: number;
  toUpdate: number;
  unresolved: number;
  conflicts: number;
  skippedRemoved: number;
}

export interface BackfillReport {
  generatedAt: string;
  mode: 'dry-run' | 'apply';
  source: string;
  summary: Record<FolderCollection, CollectionSummary>;
  totals: CollectionSummary;
  changes: BackfillChange[];
  unresolved: { collection: FolderCollection; id: string; reason: string }[];
  conflicts: { collection: FolderCollection; id: string; field: string; existing: unknown; computed: unknown }[];
  warnings: { collection: FolderCollection; id: string; message: string }[];
}

const emptySummary = (): CollectionSummary => ({ total: 0, alreadyFiled: 0, toUpdate: 0, unresolved: 0, conflicts: 0, skippedRemoved: 0 });

/** Lookups over plain arrays (Firestore snapshots or seed data). */
export function lookupsFrom(data: Partial<Record<'companies' | 'clients' | 'leads' | 'branches' | 'proposals' | 'service_jobs' | 'invoices', Rec[]>>): FolderLookups {
  const index = (list?: Rec[]) => new Map((list ?? []).map((r) => [r.id, r]));
  const m = {
    companies: index(data.companies),
    clients: index(data.clients),
    leads: index(data.leads),
    branches: index(data.branches),
    proposals: index(data.proposals),
    jobs: index(data.service_jobs),
    invoices: index(data.invoices),
  };
  // Records come untyped from Firestore; the resolver only reads optional fields from them
  const get = <K extends keyof FolderLookups>(map: Map<string, Rec>) => ((id: string) => map.get(id)) as unknown as FolderLookups[K];
  return {
    company: get<'company'>(m.companies),
    client: get<'client'>(m.clients),
    lead: get<'lead'>(m.leads),
    branch: get<'branch'>(m.branches),
    proposal: get<'proposal'>(m.proposals),
    job: get<'job'>(m.jobs),
    invoice: get<'invoice'>(m.invoices),
  };
}

export function planBackfill(
  records: Partial<Record<FolderCollection, Rec[]>>,
  lookups: FolderLookups,
  options: { mode?: 'dry-run' | 'apply'; source?: string; now?: string } = {}
): BackfillReport {
  const report: BackfillReport = {
    generatedAt: options.now ?? new Date().toISOString(),
    mode: options.mode ?? 'dry-run',
    source: options.source ?? 'firestore',
    summary: Object.fromEntries(FOLDER_COLLECTIONS.map((c) => [c, emptySummary()])) as Record<FolderCollection, CollectionSummary>,
    totals: emptySummary(),
    changes: [],
    unresolved: [],
    conflicts: [],
    warnings: [],
  };

  for (const collection of FOLDER_COLLECTIONS) {
    const sum = report.summary[collection];
    for (const r of records[collection] ?? []) {
      sum.total++;
      if (r.removed === true) {
        sum.skippedRemoved++;
        continue;
      }
      if (typeof r.folderPath === 'string' && r.folderPath) {
        sum.alreadyFiled++;
        continue;
      }

      const link = recordLink(lookups, collection, r);
      if (!link) {
        sum.unresolved++;
        report.unresolved.push({ collection, id: r.id, reason: unresolvedReason(collection, r) });
        continue;
      }
      // An existing category decides the subfolder
      if (typeof r.fileCategory === 'string') link.category = r.fileCategory as typeof link.category;

      const meta = resolveFolderFrom(lookups, link);
      if (!meta.folderPath) {
        sum.unresolved++;
        report.unresolved.push({ collection, id: r.id, reason: 'No customer or lead id on the record' });
        continue;
      }
      if (meta.ownerScope === 'client' && meta.clientId && !clientInfoFrom(lookups, meta.clientId).name) {
        report.warnings.push({ collection, id: r.id, message: `Client ${meta.clientId} was not found; filed by id with the name saved on the record` });
      }

      const conflicts = OWNER_FIELDS.filter((f) => r[f] !== undefined && r[f] !== null && meta[f] !== undefined && r[f] !== meta[f]);
      if (conflicts.length) {
        sum.conflicts++;
        conflicts.forEach((f) => report.conflicts.push({ collection, id: r.id, field: f, existing: r[f], computed: meta[f] }));
        continue;
      }

      const patch: FolderMeta = {};
      for (const f of FIELDS) {
        if (meta[f] !== undefined && (r[f] === undefined || r[f] === null)) (patch as Record<string, unknown>)[f] = meta[f];
      }
      if (!Object.keys(patch).length) {
        sum.alreadyFiled++;
        continue;
      }
      sum.toUpdate++;
      report.changes.push({ collection, id: r.id, patch });
    }
    (Object.keys(sum) as (keyof CollectionSummary)[]).forEach((k) => (report.totals[k] += sum[k]));
  }
  return report;
}

function unresolvedReason(collection: FolderCollection, r: Rec): string {
  if (collection === 'documents') {
    const owner = r.owner as { kind?: string; id?: string } | undefined;
    if (!owner?.kind) return 'Document has no owner';
    return `Owner ${owner.kind} ${owner.id ?? ''} not found`.trim();
  }
  if (collection === 'outreach_logs') {
    const rel = r.related as { kind?: string; id?: string } | undefined;
    return rel?.kind ? `Related ${rel.kind} ${rel.id ?? ''} not found` : 'Message is not linked to a lead, proposal or client';
  }
  return 'No customer or lead id on the record';
}

/** Short human-readable summary (Markdown) of a report. */
export function reportMarkdown(report: BackfillReport): string {
  const rows = FOLDER_COLLECTIONS.map((c) => {
    const s = report.summary[c];
    return `| ${c} | ${s.total} | ${s.alreadyFiled} | ${s.toUpdate} | ${s.unresolved} | ${s.conflicts} | ${s.skippedRemoved} |`;
  });
  const t = report.totals;
  const lines = [
    `# Folder backfill (${report.mode})`,
    '',
    `Generated ${report.generatedAt} from ${report.source}.`,
    '',
    '| Collection | Records | Already filed | Will update | Unresolved | Conflicts | Removed (skipped) |',
    '|---|---:|---:|---:|---:|---:|---:|',
    ...rows,
    `| **Total** | ${t.total} | ${t.alreadyFiled} | ${t.toUpdate} | ${t.unresolved} | ${t.conflicts} | ${t.skippedRemoved} |`,
    '',
  ];
  if (report.unresolved.length) {
    lines.push('## Unresolved (not changed)', '', ...report.unresolved.slice(0, 200).map((u) => `- ${u.collection}/${u.id}: ${u.reason}`), '');
  }
  if (report.conflicts.length) {
    lines.push('## Conflicts (existing value kept)', '', ...report.conflicts.slice(0, 200).map((c) => `- ${c.collection}/${c.id}: ${c.field} is ${JSON.stringify(c.existing)}, computed ${JSON.stringify(c.computed)}`), '');
  }
  if (report.warnings.length) {
    lines.push('## Warnings', '', ...report.warnings.slice(0, 200).map((w) => `- ${w.collection}/${w.id}: ${w.message}`), '');
  }
  if (report.changes.length) {
    lines.push('## Sample of changes', '', ...report.changes.slice(0, 25).map((c) => `- ${c.collection}/${c.id} → ${c.patch.folderPath ?? '(fields only)'}`), '');
  }
  return lines.join('\n');
}
