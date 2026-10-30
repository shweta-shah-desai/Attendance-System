import { create } from 'zustand';
import type { Session, User } from '../types/user';
import { loginOrRegister, getUserById } from '../db/queries/users';
import { clearSession, loadSession, saveSession } from '../services/storage';
import { nowIso } from '../utils/date';

export type AuthStatus = 'idle' | 'restoring' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  error: string | null;

  /** Reads the stored session on startup. Called once by the splash screen. */
  restore: () => Promise<AuthStatus>;
  /** Spec rule: known mobile signs in, unknown mobile creates the account. */
  signIn: (name: string, phone: string) => Promise<{ isNew: boolean }>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  session: null,
  error: null,

  restore: async () => {
    set({ status: 'restoring', error: null });
    const session = await loadSession();
    if (!session) {
      set({ status: 'unauthenticated', user: null, session: null });
      return 'unauthenticated';
    }

    // The session survives app restarts, but the row it points at may have
    // been wiped - treat a missing user as a signed-out state.
    const user = await getUserById(session.userId);
    if (!user || user.status !== 'active') {
      await clearSession();
      set({ status: 'unauthenticated', user: null, session: null });
      return 'unauthenticated';
    }

    set({ status: 'authenticated', user, session });
    return 'authenticated';
  },

  signIn: async (name, phone) => {
    set({ error: null });
    try {
      const { user, isNew } = await loginOrRegister(name, phone);
      const session: Session = {
        userId: user.id,
        name: user.name,
        phone: user.phone,
        issuedAt: nowIso(),
      };
      await saveSession(session);
      set({ status: 'authenticated', user, session });
      return { isNew };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not sign in';
      set({ error: message });
      throw e;
    }
  },

  signOut: async () => {
    await clearSession();
    set({ status: 'unauthenticated', user: null, session: null, error: null });
  },
}));

/** Convenience selector - the id every query scopes its rows by. */
export const useCurrentUserId = (): string | null =>
  useAuthStore((s) => s.user?.id ?? null);
