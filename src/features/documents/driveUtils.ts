import { useMemo } from 'react';
import { dataService } from '../../services/dataService';
import { useDataStore } from '../../hooks/useDataStore';
import type { PortalDocument, ClientFolder, DocumentOwner } from '../../types/document';

export type EntityKind = 'company' | 'client' | 'branch';

export interface EntityRef {
  kind: EntityKind;
  id: string;
  name: string;
  sub?: string;
  companyId?: string; // For branches to know their parent company
}

/**
 * Returns the effective client folder for a document.
 * Old documents without a folder are treated as 'client_papers'.
 */
export function docFolder(doc: PortalDocument): ClientFolder {
  return doc.folder || 'client_papers';
}

/**
 * Checks whether a document belongs to a specific entity.
 */
export function ownerMatches(doc: PortalDocument, kind: EntityKind, id: string): boolean {
  if (doc.owner.kind !== kind) return false;
  return 'id' in doc.owner && doc.owner.id === id;
}

/**
 * Converts an EntityRef into a DocumentOwner.
 */
export function asOwner(entity: EntityRef): DocumentOwner {
  return { kind: entity.kind, id: entity.id };
}

/**
 * Returns the current calendar year.
 */
export function currentYear(): number {
  return new Date().getFullYear();
}

/**
 * Returns an array of years from current year down to 2010.
 */
export function yearOptions(): number[] {
  const cur = currentYear();
  const years: number[] = [];
  for (let y = cur; y >= 2010; y--) {
    years.push(y);
  }
  return years;
}

/**
 * React hook that lists all companies, branches (with parent company name), and individual clients.
 * Automatically stays synchronized with dataService updates.
 */
export function useEntities(): {
  entities: EntityRef[];
  companies: EntityRef[];
  branches: EntityRef[];
  clients: EntityRef[];
  findEntity: (kind: EntityKind, id: string) => EntityRef | undefined;
} {
  const store = useDataStore();
  const version = store.getVersion();

  return useMemo(() => {
    const rawCompanies = dataService.getCompanies();
    const rawBranches = dataService.getBranches();
    const rawClients = dataService.getClients();

    const companies: EntityRef[] = rawCompanies.map((c) => ({
      kind: 'company' as const,
      id: c.id,
      name: c.legalCompanyName,
      sub: `${c.id} • Master Company Account`,
    }));

    const branches: EntityRef[] = rawBranches.map((b) => ({
      kind: 'branch' as const,
      id: b.id,
      name: `${b.branchName} (${b.companyName})`,
      sub: `${b.id} • Branch of ${b.companyName} (${b.city})`,
      companyId: b.companyId,
    }));

    const clients: EntityRef[] = rawClients.map((cl) => ({
      kind: 'client' as const,
      id: cl.id,
      name: cl.fullName,
      sub: `${cl.id} • Individual Client (${cl.city})`,
    }));

    const entities: EntityRef[] = [...companies, ...branches, ...clients];

    const findEntity = (kind: EntityKind, id: string): EntityRef | undefined => {
      return entities.find((e) => e.kind === kind && e.id === id);
    };

    return { entities, companies, branches, clients, findEntity };
    // Recompute whenever the store changes (Firestore snapshots arrive after mount)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}
