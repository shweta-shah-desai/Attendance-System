/**
 * The Supabase client — the app's single connection to the cloud.
 *
 * Phase 3 of convert_app_to_online_with data_storage.md. SQLite stays the
 * source of truth; this client exists for auth and for the sync layer that
 * mirrors local rows to Postgres.
 *
 * `isCloudConfigured()` is the switch every cloud call site checks first: with
 * the two env vars unset the app degrades to the purely offline behaviour it
 * had before, instead of crashing on a half-built client. It replaces the
 * `isSyncConfigured()` of the old src/services/api.ts stub.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { store } from './storage';

const URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isCloudConfigured = (): boolean => URL.length > 0 && ANON_KEY.length > 0;

/**
 * Created even when the env vars are missing, so importing modules do not
 * have to guard every reference - but a request would then fail, which is why
 * callers gate on isCloudConfigured() rather than on the client being present.
 */
export const supabase: SupabaseClient = createClient(URL || 'http://localhost', ANON_KEY, {
  auth: {
    // Sessions live in SecureStore (localStorage on web) - see storage.ts.
    storage: store,
    autoRefreshToken: true,
    persistSession: true,
    // React Native has no URL bar for Supabase to read a session out of;
    // leaving this on makes getSession() hang on native.
    detectSessionInUrl: false,
  },
});

/** Mobile numbers are stored as 10 digits locally; Supabase wants E.164. */
export const toE164 = (phone: string): string => `+91${phone.replace(/\D/g, '').slice(-10)}`;

/** The inverse - strips +91 so a profile row matches the local `users` shape. */
export const toLocalPhone = (e164: string): string => e164.replace(/\D/g, '').slice(-10);

/** The cloud `profiles` row. `users` locally, because Supabase owns auth.users. */
export interface CloudProfile {
  id: string;
  name: string;
  phone: string;
  email_id: string | null;
  resi_address: string | null;
  status: 'active' | 'inactive';
  created_at: string;
  updated_at: string;
}

/**
 * Network failures and credential failures need different messages - "wrong
 * PIN" shown during an outage sends the user looking for a problem that is not
 * theirs. supabase-js surfaces an offline fetch as a plain TypeError with no
 * status, so the absence of a status is the signal.
 */
export function isOfflineError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const status = (error as { status?: number }).status;
  if (typeof status === 'number' && status !== 0) return false;
  const name = (error as { name?: string }).name ?? '';
  const message = (error as { message?: string }).message ?? '';
  return (
    name === 'AuthRetryableFetchError' ||
    name === 'TypeError' ||
    /network|fetch|timeout|offline/i.test(message)
  );
}
