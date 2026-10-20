// Offline storage and sync queue manager for PWA field operations

export interface SyncQueueItem {
  id: string;
  collectionName: 'service_jobs' | 'leads' | 'clients' | 'notes';
  action: 'create' | 'update';
  docId: string;
  payload: Record<string, unknown>;
  createdAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  lastError?: string;
}

const SYNC_QUEUE_KEY = 'ikpm_offline_sync_queue';
const OFFLINE_DRAFTS_KEY = 'ikpm_offline_drafts';

export const offlineStorage = {
  // Get all pending sync items
  getSyncQueue(): SyncQueueItem[] {
    try {
      const data = localStorage.getItem(SYNC_QUEUE_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  // Save sync queue
  saveSyncQueue(queue: SyncQueueItem[]): void {
    try {
      localStorage.setItem(SYNC_QUEUE_KEY, JSON.stringify(queue));
    } catch (err) {
      console.error('Failed to save sync queue to localStorage', err);
    }
  },

  // Add an item to sync queue
  enqueue(item: Omit<SyncQueueItem, 'id' | 'createdAt' | 'status' | 'retryCount'>): SyncQueueItem {
    const queue = this.getSyncQueue();
    const newItem: SyncQueueItem = {
      ...item,
      id: `sync_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      createdAt: new Date().toISOString(),
      status: 'pending',
      retryCount: 0,
    };
    queue.push(newItem);
    this.saveSyncQueue(queue);
    return newItem;
  },

  // Update item status
  updateQueueItem(id: string, updates: Partial<SyncQueueItem>): void {
    const queue = this.getSyncQueue();
    const idx = queue.findIndex(q => q.id === id);
    if (idx !== -1) {
      queue[idx] = { ...queue[idx], ...updates };
      this.saveSyncQueue(queue);
    }
  },

  // Remove item once synced
  dequeue(id: string): void {
    const queue = this.getSyncQueue().filter(q => q.id !== id);
    this.saveSyncQueue(queue);
  },

  // Drafts for PCO field reports
  saveDraft(key: string, data: unknown): void {
    try {
      const drafts = this.getAllDrafts();
      drafts[key] = { data, updatedAt: new Date().toISOString() };
      localStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(drafts));
    } catch (err) {
      console.error('Failed to save draft', err);
    }
  },

  getDraft<T>(key: string): T | null {
    try {
      const drafts = this.getAllDrafts();
      return drafts[key] ? (drafts[key].data as T) : null;
    } catch {
      return null;
    }
  },

  clearDraft(key: string): void {
    try {
      const drafts = this.getAllDrafts();
      delete drafts[key];
      localStorage.setItem(OFFLINE_DRAFTS_KEY, JSON.stringify(drafts));
    } catch (err) {
      console.error('Failed to remove draft', err);
    }
  },

  getAllDrafts(): Record<string, { data: unknown; updatedAt: string }> {
    try {
      const raw = localStorage.getItem(OFFLINE_DRAFTS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  },
};
