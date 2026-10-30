import { create } from 'zustand';

export type SyncPhase = 'idle' | 'syncing' | 'error';

interface SyncState {
  phase: SyncPhase;
  /** Local stamp of the last sync that completed without error. */
  lastSyncedAt: string | null;
  /** Local rows still waiting to go up - what "3 changes waiting" counts. */
  pendingCount: number;
  /** Set only when the last attempt failed; shown in the header line. */
  error: string | null;
  /**
   * How many pre-cloud records the first sync handed to this account, until
   * the user dismisses the notice. Null means there is nothing to say.
   */
  adopted: number | null;

  started: () => void;
  succeeded: (at: string, pending: number) => void;
  failed: (message: string, pending: number) => void;
  setPendingCount: (n: number) => void;
  noteAdopted: (n: number) => void;
  clearAdopted: () => void;
  reset: () => void;
}

/**
 * Sync status for the header line.
 *
 * It is written by src/services/sync.ts rather than by a hook, so it is a
 * plain zustand store the engine can drive from outside React. Users trusting
 * a cloud backup need to see that it is happening - a silent sync is
 * indistinguishable from a broken one.
 */
export const useSyncStore = create<SyncState>((set) => ({
  phase: 'idle',
  lastSyncedAt: null,
  pendingCount: 0,
  error: null,
  adopted: null,

  started: () => set({ phase: 'syncing', error: null }),
  succeeded: (at, pending) =>
    set({ phase: 'idle', lastSyncedAt: at, pendingCount: pending, error: null }),
  failed: (message, pending) => set({ phase: 'error', error: message, pendingCount: pending }),
  setPendingCount: (n) => set({ pendingCount: n }),
  noteAdopted: (n) => set({ adopted: n }),
  clearAdopted: () => set({ adopted: null }),
  reset: () =>
    set({ phase: 'idle', lastSyncedAt: null, pendingCount: 0, error: null, adopted: null }),
}));
