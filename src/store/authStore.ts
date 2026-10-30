import { create } from 'zustand';
import type { AuthError, Session as SupabaseSession } from '@supabase/supabase-js';
import type { Session, User } from '../types/user';
import { getUserById, updateUser, upsertUserFromProfile } from '../db/queries/users';
import { clearSession, loadSession, saveSession } from '../services/storage';
import {
  isCloudConfigured,
  isOfflineError,
  supabase,
  toE164,
  toLocalPhone,
  type CloudProfile,
} from '../services/supabase';
import { scheduleSync, syncNow } from '../services/sync';
import { useSyncStore } from './syncStore';
import { nowIso, toDbStamp } from '../utils/date';

export type AuthStatus = 'idle' | 'restoring' | 'authenticated' | 'unauthenticated';

interface AuthState {
  status: AuthStatus;
  user: User | null;
  session: Session | null;
  error: string | null;

  /** Reads the stored session on startup. Called once by the splash screen. */
  restore: () => Promise<AuthStatus>;
  /** Signs in with the mobile number and the 6-digit PIN. */
  signIn: (phone: string, pin: string) => Promise<void>;
  /**
   * Creates the account. The Supabase project has "Confirm phone" ON, so this
   * sends an OTP and returns `{ needsOtp: true }` without a session - the
   * caller must then collect the code and call `verifyOtp`.
   */
  signUp: (name: string, phone: string, pin: string) => Promise<{ needsOtp: boolean }>;
  /** Second step of signup: confirms the SMS code and completes the session. */
  verifyOtp: (phone: string, code: string) => Promise<void>;
  /**
   * Sends an SMS code: `signup` re-sends the confirmation for an account that
   * is waiting on one, `reset` starts the forgotten-PIN flow for an existing
   * number. Both land on the same verify screen.
   */
  requestOtp: (phone: string, purpose: 'signup' | 'reset') => Promise<void>;
  /** Sets a new PIN for the signed-in user - the end of the reset flow. */
  updatePin: (pin: string) => Promise<void>;
  /**
   * Saves the Profile screen's fields. `phone` is absent on purpose: it is the
   * sign-in credential, owned by Supabase auth, and changing it needs an SMS
   * confirmation rather than a local write. `join_date` is write-once and not
   * editable anywhere.
   */
  updateProfile: (patch: {
    name: string;
    email_id: string | null;
    resi_address: string | null;
  }) => Promise<void>;
  signOut: () => Promise<void>;
}

/** The app is unusable without a cloud account now that identity lives there. */
const CLOUD_MISSING =
  'Cloud sign-in is not set up in this build. Please reinstall the latest version.';

/** Maps a Supabase auth failure onto something a household owner can act on. */
function authMessage(error: AuthError | Error, fallback: string): string {
  if (isOfflineError(error)) return 'You are offline - check your connection and try again.';
  const message = error.message ?? '';
  if (/invalid login credentials/i.test(message)) {
    return 'That mobile number or PIN is not correct.';
  }
  // signInWithOtp with shouldCreateUser:false reports an unknown number this
  // way; "signups not allowed" would mean nothing to the person reading it.
  if (/signups not allowed|user not found/i.test(message)) {
    return 'No register found for that mobile number. Please create one instead.';
  }
  if (/for security purposes|rate limit|too many/i.test(message)) {
    return 'Too many attempts. Please wait a minute and try again.';
  }
  if (/already registered|already exists|user already/i.test(message)) {
    return 'That mobile number already has a register. Please sign in instead.';
  }
  if (/invalid otp|token has expired|token is invalid|expired/i.test(message)) {
    return 'That code is wrong or has expired. Please ask for a new one.';
  }
  if (/password/i.test(message)) return 'The PIN must be 6 digits.';
  return message || fallback;
}

/**
 * Reads the signed-in user's `profiles` row and mirrors it into local SQLite.
 *
 * The row is created server-side by the handle_new_user trigger, but right
 * after a signup the read can lose the race with it - so the auth user's own
 * metadata is the fallback, and the next sync reconciles the two.
 */
async function syncProfileToLocal(cloudSession: SupabaseSession): Promise<User> {
  const authUser = cloudSession.user;
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', authUser.id)
    .maybeSingle<CloudProfile>();

  const meta = (authUser.user_metadata ?? {}) as { name?: string; phone?: string };
  const profile: Parameters<typeof upsertUserFromProfile>[0] = data ?? {
    id: authUser.id,
    name: meta.name?.trim() || 'Saathi user',
    phone: toLocalPhone(authUser.phone ?? meta.phone ?? ''),
    status: 'active',
  };

  // The auth user's own created_at is when this phone number first signed up,
  // which is the one clock that is not reset by a reinstall or a new device.
  // upsertUserFromProfile keeps any value already stored, so this can never
  // move a join date that exists.
  return upsertUserFromProfile({
    ...profile,
    join_date: authUser.created_at ? toDbStamp(authUser.created_at) : null,
  });
}

/** The local session blob the splash screen and offline restore rely on. */
const toLocalSession = (user: User): Session => ({
  userId: user.id,
  name: user.name,
  phone: user.phone,
  issuedAt: nowIso(),
});

/**
 * The tail end of every way into the app: persist the session, flip the store
 * to authenticated, and start the first sync without waiting for it - a slow
 * network must delay the backup, never the register.
 */
async function completeSignIn(
  cloudSession: SupabaseSession,
  set: (partial: Partial<AuthState>) => void,
): Promise<User> {
  const user = await syncProfileToLocal(cloudSession);
  const session = toLocalSession(user);
  await saveSession(session);
  set({ status: 'authenticated', user, session });
  void syncNow();
  return user;
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'idle',
  user: null,
  session: null,
  error: null,

  restore: async () => {
    set({ status: 'restoring', error: null });

    const signedOut = async () => {
      await clearSession();
      set({ status: 'unauthenticated', user: null, session: null });
      return 'unauthenticated' as const;
    };

    // Loaded first so a cloud failure can fall back to it: a user without
    // connectivity must still reach their register.
    const localSession = await loadSession();

    if (isCloudConfigured()) {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;

        if (data.session) {
          const user = await completeSignIn(data.session, set);
          if (user.status !== 'active') return signedOut();
          return 'authenticated';
        }

        // Supabase is reachable and holds no session - that is authoritative,
        // so a stale local blob must not override it.
        return signedOut();
      } catch (e) {
        // A network failure is not a sign-out; fall through to the local
        // session so the app stays usable without connectivity.
        if (!isOfflineError(e)) return signedOut();
      }
    }

    if (!localSession) {
      set({ status: 'unauthenticated', user: null, session: null });
      return 'unauthenticated';
    }

    // The session survives app restarts, but the row it points at may have
    // been wiped - treat a missing user as a signed-out state.
    const user = await getUserById(localSession.userId);
    if (!user || user.status !== 'active') return signedOut();

    set({ status: 'authenticated', user, session: localSession });
    return 'authenticated';
  },

  signIn: async (phone, pin) => {
    set({ error: null });
    if (!isCloudConfigured()) {
      set({ error: CLOUD_MISSING });
      throw new Error(CLOUD_MISSING);
    }
    try {
      const { data, error } = await supabase.auth.signInWithPassword({
        phone: toE164(phone),
        password: pin,
      });
      if (error) throw error;
      if (!data.session) throw new Error('Could not sign in');

      await completeSignIn(data.session, set);
    } catch (e) {
      const message = authMessage(e as Error, 'Could not sign in');
      set({ error: message });
      throw new Error(message);
    }
  },

  signUp: async (name, phone, pin) => {
    set({ error: null });
    if (!isCloudConfigured()) {
      set({ error: CLOUD_MISSING });
      throw new Error(CLOUD_MISSING);
    }
    try {
      const { data, error } = await supabase.auth.signUp({
        phone: toE164(phone),
        password: pin,
        // handle_new_user() reads these out of raw_user_meta_data to build
        // the profiles row, so the name must travel with the signup call.
        options: { data: { name: name.trim(), phone } },
      });
      if (error) throw error;

      // With "Confirm phone" ON there is no session yet - verifyOtp finishes
      // the job. The other branch is kept so turning confirmation off works.
      if (!data.session) return { needsOtp: true };

      await completeSignIn(data.session, set);
      return { needsOtp: false };
    } catch (e) {
      const message = authMessage(e as Error, 'Could not create your register');
      set({ error: message });
      throw new Error(message);
    }
  },

  verifyOtp: async (phone, code) => {
    set({ error: null });
    if (!isCloudConfigured()) {
      set({ error: CLOUD_MISSING });
      throw new Error(CLOUD_MISSING);
    }
    try {
      const { data, error } = await supabase.auth.verifyOtp({
        phone: toE164(phone),
        token: code,
        type: 'sms',
      });
      if (error) throw error;
      if (!data.session) throw new Error('Could not confirm that code');

      await completeSignIn(data.session, set);
    } catch (e) {
      const message = authMessage(e as Error, 'Could not confirm that code');
      set({ error: message });
      throw new Error(message);
    }
  },

  requestOtp: async (phone, purpose) => {
    set({ error: null });
    if (!isCloudConfigured()) {
      set({ error: CLOUD_MISSING });
      throw new Error(CLOUD_MISSING);
    }
    try {
      const target = toE164(phone);
      const { error } =
        purpose === 'signup'
          ? await supabase.auth.resend({ type: 'sms', phone: target })
          : // shouldCreateUser: false so a typo'd number cannot quietly mint
            // an empty account on the way to a PIN reset.
            await supabase.auth.signInWithOtp({ phone: target, options: { shouldCreateUser: false } });
      if (error) throw error;
    } catch (e) {
      const message = authMessage(e as Error, 'Could not send the code');
      set({ error: message });
      throw new Error(message);
    }
  },

  updatePin: async (pin) => {
    set({ error: null });
    if (!isCloudConfigured()) {
      set({ error: CLOUD_MISSING });
      throw new Error(CLOUD_MISSING);
    }
    try {
      const { error } = await supabase.auth.updateUser({ password: pin });
      if (error) throw error;
    } catch (e) {
      const message = authMessage(e as Error, 'Could not save the new PIN');
      set({ error: message });
      throw new Error(message);
    }
  },

  updateProfile: async (patch) => {
    set({ error: null });
    const current = useAuthStore.getState().user;
    if (!current) throw new Error('You are not signed in');
    try {
      await updateUser(current.id, patch);
      const fresh = await getUserById(current.id);
      if (fresh) {
        // The session blob carries the name shown in the header and drawer.
        const session = toLocalSession(fresh);
        await saveSession(session);
        set({ user: fresh, session });
      }
      // The touch trigger already queued the row; this just gets it moving.
      scheduleSync();
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not save your profile';
      set({ error: message });
      throw new Error(message);
    }
  },

  signOut: async () => {
    // Local SQLite is deliberately left intact: signing out on a flaky
    // connection must not destroy marks that have not been pushed yet.
    if (isCloudConfigured()) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Already-expired tokens and offline sign-outs are both fine - the
        // local session is cleared either way.
      }
    }
    await clearSession();
    // Otherwise the next account inherits this one's "Saved to cloud - 2 min
    // ago", which would be a claim about somebody else's register.
    useSyncStore.getState().reset();
    set({ status: 'unauthenticated', user: null, session: null, error: null });
  },
}));

/** Convenience selector - the id every query scopes its rows by. */
export const useCurrentUserId = (): string | null =>
  useAuthStore((s) => s.user?.id ?? null);
