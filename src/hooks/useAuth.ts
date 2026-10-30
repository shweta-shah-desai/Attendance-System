import { useAuthStore } from '../store/authStore';

export function useAuth() {
  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const error = useAuthStore((s) => s.error);
  const signIn = useAuthStore((s) => s.signIn);
  const signUp = useAuthStore((s) => s.signUp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const requestOtp = useAuthStore((s) => s.requestOtp);
  const updatePin = useAuthStore((s) => s.updatePin);
  const updateProfile = useAuthStore((s) => s.updateProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const restore = useAuthStore((s) => s.restore);

  return {
    status,
    user,
    error,
    signIn,
    signUp,
    verifyOtp,
    requestOtp,
    updatePin,
    updateProfile,
    signOut,
    restore,
    isAuthenticated: status === 'authenticated',
    isReady: status === 'authenticated' || status === 'unauthenticated',
  };
}
