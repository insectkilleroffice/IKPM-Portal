import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { offlineStorage, SyncQueueItem } from '../lib/offlineStorage';
import { useNotification } from './NotificationContext';
import { db } from '../lib/firebase';
import { doc, setDoc } from 'firebase/firestore';

interface SyncContextType {
  isOnline: boolean;
  pendingCount: number;
  isSyncing: boolean;
  syncQueue: SyncQueueItem[];
  triggerSync: () => Promise<void>;
  enqueueOfflineAction: (
    collectionName: 'service_jobs' | 'leads' | 'clients' | 'notes',
    action: 'create' | 'update',
    docId: string,
    payload: Record<string, unknown>
  ) => void;
}

const SyncContext = createContext<SyncContextType | undefined>(undefined);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [isOnline, setIsOnline] = useState<boolean>(navigator.onLine);
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>([]);
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const { success, warning, info } = useNotification();

  // Refresh queue count
  const refreshQueue = useCallback(() => {
    const queue = offlineStorage.getSyncQueue();
    setSyncQueue(queue);
  }, []);

  useEffect(() => {
    refreshQueue();

    const handleOnline = () => {
      setIsOnline(true);
      success('Online Connection Restored', 'Background synchronizer is processing pending drafts.');
      // Auto trigger sync
      setTimeout(() => {
        triggerSync();
      }, 1000);
    };

    const handleOffline = () => {
      setIsOnline(false);
      warning('Offline Mode Active', 'Operational drafts (inspections, job checklists, lead capture) will be stored locally and synced once reconnected.');
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [refreshQueue, success, warning]);

  const enqueueOfflineAction = useCallback(
    (
      collectionName: 'service_jobs' | 'leads' | 'clients' | 'notes',
      action: 'create' | 'update',
      docId: string,
      payload: Record<string, unknown>
    ) => {
      offlineStorage.enqueue({
        collectionName,
        action,
        docId,
        payload,
      });
      refreshQueue();
      info('Saved to Local Offline Queue', `Changes for ${docId} are safe locally and will sync automatically.`);
    },
    [refreshQueue, info]
  );

  const triggerSync = useCallback(async () => {
    if (!navigator.onLine || isSyncing) return;

    const queue = offlineStorage.getSyncQueue();
    if (queue.length === 0) return;

    setIsSyncing(true);

    let syncedCount = 0;
    for (const item of queue) {
      try {
        offlineStorage.updateQueueItem(item.id, { status: 'syncing' });
        // Sync to Cloud Firestore
        const docRef = doc(db, item.collectionName, item.docId);
        await setDoc(docRef, item.payload, { merge: true });

        // Dequeue once confirmed written
        offlineStorage.dequeue(item.id);
        syncedCount++;
      } catch (err: unknown) {
        console.error('Failed to sync item', item.id, err);
        const errMsg = err instanceof Error ? err.message : 'Unknown sync failure';
        offlineStorage.updateQueueItem(item.id, {
          status: 'failed',
          retryCount: item.retryCount + 1,
          lastError: errMsg,
        });
      }
    }

    refreshQueue();
    setIsSyncing(false);

    if (syncedCount > 0) {
      success('Automatic Sync Completed', `Successfully synchronized ${syncedCount} offline record(s) to cloud database.`);
    }
  }, [isSyncing, refreshQueue, success]);

  return (
    <SyncContext.Provider
      value={{
        isOnline,
        pendingCount: syncQueue.length,
        isSyncing,
        syncQueue,
        triggerSync,
        enqueueOfflineAction,
      }}
    >
      {children}
    </SyncContext.Provider>
  );
};

export const useSync = () => {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSync must be used within a SyncProvider');
  }
  return context;
};
