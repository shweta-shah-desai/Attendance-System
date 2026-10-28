import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { Session } from '../types/user';

const SESSION_KEY = 'gharsaathi.session';

/**
 * expo-secure-store has no web implementation, so fall back to localStorage
 * when the app is opened in a browser during development.
 */
const webStore = {
  getItem: async (k: string) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(k)),
  setItem: async (k: string, v: string) => {
    if (typeof localStorage !== 'undefined') localStorage.setItem(k, v);
  },
  removeItem: async (k: string) => {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(k);
  },
};

/**
 * SecureStore exposes getItemAsync/setItemAsync/deleteItemAsync - wrap them so
 * both platforms share one getItem/setItem/removeItem shape.
 */
const nativeStore = {
  getItem: (k: string) => SecureStore.getItemAsync(k),
  setItem: (k: string, v: string) => SecureStore.setItemAsync(k, v),
  removeItem: (k: string) => SecureStore.deleteItemAsync(k),
};

const store = Platform.OS === 'web' ? webStore : nativeStore;

export async function saveSession(session: Session): Promise<void> {
  await store.setItem(SESSION_KEY, JSON.stringify(session));
}

export async function loadSession(): Promise<Session | null> {
  try {
    const raw = await store.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Session;
    return typeof parsed?.userId === 'string' ? parsed : null;
  } catch {
    // A corrupt session should never block the splash screen.
    return null;
  }
}

export async function clearSession(): Promise<void> {
  await store.removeItem(SESSION_KEY);
}
