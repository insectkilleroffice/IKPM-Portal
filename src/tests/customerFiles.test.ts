// A lead's meeting / inspection reports show in the customer account's folders.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../services/dataService', () => ({ dataService: {} }));
const { remapLeadItems } = await import('../features/documents/folderItems');
import { clientRootPath, isInFolder, parseFolderPath } from '../lib/folders';
import type { FolderItem } from '../features/documents/folderItems';

const item = (clientId: string, folderPath: string): FolderItem =>
  ({ key: `document:${folderPath}`, kind: 'document', id: folderPath, title: 'Meeting report', ownerScope: 'client', clientId, folderPath });

describe('customer files include their leads\' reports', () => {
  const root = clientRootPath('CO-1', 'Shan Foods');
  const leadReport = item('L-7', '/Clients/Shan Foods prospect__L-7/Leads & Inspections');
  const other = item('L-9', '/Clients/Someone else__L-9/Leads & Inspections');

  it('shows a report still in the lead folder under the customer\'s Leads & Inspections', () => {
    const shown = remapLeadItems([leadReport, other], root, ['L-7']).filter((i) => isInFolder(i.folderPath, root));
    expect(shown).toHaveLength(1);
    expect(parseFolderPath(shown[0].folderPath)).toMatchObject({ clientId: 'CO-1', subfolder: 'Leads & Inspections' });
  });

  it('leaves other clients\' files alone', () => {
    expect(remapLeadItems([other], root, ['L-7'])[0].folderPath).toBe(other.folderPath);
  });
});
