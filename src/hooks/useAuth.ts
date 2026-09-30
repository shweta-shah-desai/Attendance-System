import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signOut = useAuthStore((s) => s.signOut);
  const restore = useAuthStore((s) => s.restore);

  return {
    status,
    user,
    error,
    signIn,
    signOut,
    restore,
    isAuthenticated: status === 'authenticated',
    isReady: status === 'authenticated' || status === 'unauthenticated',
  };
}
