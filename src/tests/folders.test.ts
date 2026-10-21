import { describe, expect, it } from 'vitest';
import {
  buildFolderPath,
  CATEGORY_FOLDERS,
  CLIENT_SUBFOLDERS,
  COMPANY_ROOT,
  COMPANY_SUBFOLDERS,
  findFolder,
  folderMeta,
  getFolderTree,
  isInFolder,
  moveFolderPathToClient,
  parseFolderPath,
  safeSegment,
  storageFolder,
  documentFolderCategory,
} from '../lib/folders';
import type { FileCategory } from '../types/folders';

describe('buildFolderPath: clients', () => {
  it('puts the client id in the path', () => {
    expect(buildFolderPath({ ownerScope: 'client', clientId: 'CO-0001', clientName: 'Shan Foods', category: 'proposal' }))
      .toBe('/Clients/Shan Foods__CO-0001/Proposals');
  });

  it('adds the year for invoices and year/month for service reports', () => {
    expect(buildFolderPath({ ownerScope: 'client', clientId: 'CO-1', clientName: 'A', category: 'invoice', date: '2026-03-15T10:00:00Z' }))
      .toBe('/Clients/A__CO-1/Invoices/2026');
    expect(buildFolderPath({ ownerScope: 'client', clientId: 'CO-1', clientName: 'A', category: 'service_report', date: '2026-03-15' }))
      .toBe('/Clients/A__CO-1/Service Reports/2026/03');
  });

  it('maps every category to a client subfolder', () => {
    (Object.keys(CATEGORY_FOLDERS) as FileCategory[]).forEach((c) => {
      const path = buildFolderPath({ ownerScope: 'client', clientId: 'X', clientName: 'Y', category: c, date: '2026-01-01' });
      expect(CLIENT_SUBFOLDERS).toContain(parseFolderPath(path)!.subfolder);
    });
  });

  it('builds branch paths under Branches with the branch id', () => {
    expect(buildFolderPath({ ownerScope: 'client', clientId: 'CO-7', clientName: "Dunkin'", branchId: 'BR-12', branchName: 'G-2 Disco', category: 'layout' }))
      .toBe("/Clients/Dunkin'__CO-7/Branches/G-2 Disco__BR-12/Documents");
  });

  it('cleans special characters in names', () => {
    expect(safeSegment('Paracha / Textile\\Mills')).toBe('Paracha - Textile-Mills');
    expect(safeSegment('A__B___C')).toBe('A_B_C');
    expect(safeSegment('  spaced   out  ')).toBe('spaced out');
    expect(safeSegment('')).toBe('Unnamed');
    const path = buildFolderPath({ ownerScope: 'client', clientId: 'CO/9', clientName: 'Al-Noor & Sons (Pvt) Ltd. / KHI', category: 'contract' });
    expect(path).toBe('/Clients/Al-Noor & Sons (Pvt) Ltd. - KHI__CO-9/Contracts');
    expect(parseFolderPath(path)).toMatchObject({ clientId: 'CO-9', clientName: 'Al-Noor & Sons (Pvt) Ltd. - KHI', subfolder: 'Contracts' });
  });

  it('uses Unnamed when the client name is missing', () => {
    expect(buildFolderPath({ ownerScope: 'client', clientId: 'LD-2026-0004', category: 'risk_assessment' })).toBe('/Clients/Unnamed__LD-2026-0004/Leads & Inspections');
  });

  it('honours an explicit subfolder', () => {
    expect(buildFolderPath({ ownerScope: 'client', clientId: 'CO-1', clientName: 'A', subfolder: 'Profile' })).toBe('/Clients/A__CO-1/Profile');
  });

  it('throws when a client file has no client id', () => {
    expect(() => buildFolderPath({ ownerScope: 'client', category: 'invoice' })).toThrow(/client id/);
  });
});

describe('buildFolderPath: company', () => {
  it('maps company categories to Company (IKPM) subfolders', () => {
    expect(buildFolderPath({ ownerScope: 'company', category: 'msds' })).toBe(`/${COMPANY_ROOT}/MSDS Library`);
    expect(buildFolderPath({ ownerScope: 'company', category: 'sop' })).toBe(`/${COMPANY_ROOT}/SOP Templates`);
    expect(buildFolderPath({ ownerScope: 'company', category: 'certificate' })).toBe(`/${COMPANY_ROOT}/Technician Certificates`);
    expect(buildFolderPath({ ownerScope: 'company', subfolder: 'Tax Rules' })).toBe(`/${COMPANY_ROOT}/Tax Rules`);
    (Object.keys(CATEGORY_FOLDERS) as FileCategory[]).forEach((c) =>
      expect(COMPANY_SUBFOLDERS).toContain(parseFolderPath(buildFolderPath({ ownerScope: 'company', category: c }))!.subfolder)
    );
  });

  it('never mixes a client into the company area', () => {
    expect(() => buildFolderPath({ ownerScope: 'company', clientId: 'CO-1', category: 'msds' })).toThrow();
  });
});

describe('parseFolderPath', () => {
  it('round-trips client, branch and dated paths', () => {
    const p = buildFolderPath({ ownerScope: 'client', clientId: 'CO-3', clientName: 'Urban Edible', branchId: 'BR-1', branchName: 'DHA', category: 'service_report', date: '2026-11-02' });
    expect(parseFolderPath(p)).toEqual({ ownerScope: 'client', clientId: 'CO-3', clientName: 'Urban Edible', branchId: 'BR-1', branchName: 'DHA', subfolder: 'Service Reports', year: '2026', month: '11' });
  });

  it('returns null for unknown paths', () => {
    expect(parseFolderPath(undefined)).toBeNull();
    expect(parseFolderPath('/Somewhere/else')).toBeNull();
    expect(parseFolderPath('/Clients/NoIdHere/Invoices')).toBeNull();
  });

  it('reads company paths', () => {
    expect(parseFolderPath(`/${COMPANY_ROOT}/MSDS Library`)).toEqual({ ownerScope: 'company', subfolder: 'MSDS Library' });
  });
});

describe('getFolderTree', () => {
  const items = [
    { folderPath: '/Clients/Shan Foods__CO-1/Invoices/2026' },
    { folderPath: '/Clients/Shan Foods__CO-1/Invoices/2025' },
    { folderPath: '/Clients/Shan Foods__CO-1/Proposals' },
    { folderPath: '/Clients/Shan Foods (renamed)__CO-1/Contracts' },
    { folderPath: '/Clients/Dunkin__CO-2/Branches/Johar__BR-5/Service Reports/2026/03' },
    { folderPath: `/${COMPANY_ROOT}/MSDS Library` },
    { folderPath: undefined },
    {},
  ];
  const tree = getFolderTree(items);

  it('has Clients, Company and Unfiled roots in order', () => {
    expect(tree.map((n) => n.name)).toEqual(['Clients', COMPANY_ROOT, 'Unfiled']);
    expect(tree.find((n) => n.name === 'Unfiled')!.count).toBe(2);
  });

  it('counts files per folder including subfolders, and merges renamed clients by id', () => {
    const clients = tree[0];
    expect(clients.count).toBe(5);
    const shan = clients.children.find((c) => c.id === 'CO-1')!;
    expect(shan.count).toBe(4);
    expect(clients.children.filter((c) => c.id === 'CO-1')).toHaveLength(1);
    expect(shan.children.find((c) => c.name === 'Invoices')!.count).toBe(2);
    expect(shan.children.find((c) => c.name === 'Contracts')!.count).toBe(1);
  });

  it('lists the standard client subfolders even when empty', () => {
    const shan = tree[0].children.find((c) => c.id === 'CO-1')!;
    expect(shan.children.slice(0, CLIENT_SUBFOLDERS.length).map((c) => c.name)).toEqual([...CLIENT_SUBFOLDERS]);
    expect(shan.children.find((c) => c.name === 'Payments')!.count).toBe(0);
  });

  it('builds branch folders', () => {
    const dunkin = tree[0].children.find((c) => c.id === 'CO-2')!;
    const branch = dunkin.children.find((c) => c.name === 'Branches')!.children[0];
    expect(branch).toMatchObject({ name: 'Johar', id: 'BR-5', count: 1 });
    expect(findFolder(tree, '/Clients/Dunkin__CO-2/Branches/Johar__BR-5/Service Reports/2026')!.count).toBe(1);
  });

  it('shows company subfolders', () => {
    expect(tree[1].children.map((c) => c.name)).toEqual([...COMPANY_SUBFOLDERS]);
    expect(tree[1].children.find((c) => c.name === 'MSDS Library')!.count).toBe(1);
  });
});

describe('helpers', () => {
  it('isInFolder ignores client renames', () => {
    expect(isInFolder('/Clients/New Name__CO-1/Invoices/2026', '/Clients/Old Name__CO-1')).toBe(true);
    expect(isInFolder('/Clients/A__CO-10/Invoices', '/Clients/A__CO-1')).toBe(false);
  });

  it('moves a lead path to the won customer', () => {
    expect(moveFolderPathToClient('/Clients/Test Foods__LD-2026-0001/Leads & Inspections', { clientId: 'CO-0009', clientName: 'Test Foods (Pvt) Ltd' }))
      .toBe('/Clients/Test Foods (Pvt) Ltd__CO-0009/Leads & Inspections');
  });

  it('folderMeta returns the fields to store', () => {
    expect(folderMeta({ ownerScope: 'client', clientId: 'CO-1', clientName: 'A', clientType: 'company', category: 'invoice', date: '2026-05-01' })).toEqual({
      ownerScope: 'client',
      clientId: 'CO-1',
      clientType: 'company',
      fileCategory: 'invoice',
      folderPath: '/Clients/A__CO-1/Invoices/2026',
    });
    expect(folderMeta({ ownerScope: 'company', category: 'sop' })).toEqual({ ownerScope: 'company', fileCategory: 'sop', folderPath: `/${COMPANY_ROOT}/SOP Templates` });
  });
});

describe('storageFolder (Cloudinary)', () => {
  it('puts client files under clients/{clientId}/{category}', () => {
    expect(storageFolder({ ownerScope: 'client', clientId: 'CO-0001', category: 'invoice' })).toBe('clients/CO-0001/invoice');
    expect(storageFolder({ ownerScope: 'client', clientId: 'CO-0001', category: 'service_report' }, 'JOB-1/photos')).toBe('clients/CO-0001/service_report/JOB-1/photos');
  });

  it('puts company files under company/{category}', () => {
    expect(storageFolder({ ownerScope: 'company', category: 'msds' })).toBe('company/msds');
  });

  it('refuses a client file without a client and a company file with one', () => {
    expect(() => storageFolder({ ownerScope: 'client', category: 'invoice' })).toThrow();
    expect(() => storageFolder({ ownerScope: 'company', clientId: 'CO-1', category: 'msds' })).toThrow();
    expect(() => storageFolder({ category: 'msds' } as never)).toThrow();
  });

  it('cannot escape its folder through ids or sub paths', () => {
    expect(storageFolder({ ownerScope: 'client', clientId: '../company', category: 'other' }, '../../x')).toBe('clients/company/other/x');
  });
});

describe('documentFolderCategory', () => {
  it('maps library categories to company folders', () => {
    expect(documentFolderCategory({ owner: { kind: 'library' }, category: 'msds_chemical' })).toEqual({ category: 'msds' });
    expect(documentFolderCategory({ owner: { kind: 'library' }, category: 'registration_tax' })).toEqual({ category: 'other', subfolder: 'Profile & Registrations' });
  });

  it('maps older client folders and prefers an explicit category', () => {
    expect(documentFolderCategory({ owner: { kind: 'company' }, category: 'other', folder: 'agreements' })).toEqual({ category: 'contract' });
    expect(documentFolderCategory({ owner: { kind: 'company' }, category: 'other', folder: 'client_papers' })).toEqual({ category: 'other', subfolder: 'Profile' });
    expect(documentFolderCategory({ owner: { kind: 'company' }, category: 'other', folder: 'agreements', fileCategory: 'sop' })).toEqual({ category: 'sop' });
  });
});
