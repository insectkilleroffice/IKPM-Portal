import { useSyncExternalStore } from 'react';
import { dataService } from '../services/dataService';

/**
 * Re-renders the calling component whenever the data store changes,
 * so pages that read from `dataService` in render always show fresh data.
 */
export function useDataStore() {
  useSyncExternalStore(dataService.subscribe, dataService.getVersion);
  return dataService;
}
