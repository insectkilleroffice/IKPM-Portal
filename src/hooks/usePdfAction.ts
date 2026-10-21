import { useCallback, useState } from 'react';
import { useNotification } from '../contexts/NotificationContext';

/**
 * Runs a PDF download and reports failures (missing logo, blocked images, bad data) as a toast
 * instead of failing silently. `busy` holds the key of the document being built.
 */
export function usePdfAction() {
  const { error } = useNotification();
  const [busy, setBusy] = useState<string | null>(null);

  const run = useCallback(
    async (key: string, build: () => Promise<unknown>) => {
      setBusy(key);
      try {
        await build();
      } catch (err) {
        console.error('[PDF] generation failed:', err);
        error('Could not create PDF', err instanceof Error ? err.message : String(err));
      } finally {
        setBusy(null);
      }
    },
    [error]
  );

  return { run, busy };
}
