import { useEffect } from 'react';
import { create } from 'zustand';
import { supabase } from '@/lib/supabase';
import { Session, User } from '@supabase/supabase-js';

interface AuthStore {
  session: Session | null;
  user: User | null;
  /** True until the persisted session has been restored (or ruled out). */
  loading: boolean;
  hydrate: () => Promise<void>;
  setSession: (session: Session | null) => void;
  signOut: () => Promise<void>;
}

/** Guards against a second hydrate pass registering duplicate listeners. */
let hydrationStarted = false;

/** Safety valve: never leave the app waiting on storage forever. */
const HYDRATION_TIMEOUT_MS = 4000;

export const useAuthStore = create<AuthStore>((set) => ({
  session: null,
  user: null,
  loading: true,

  hydrate: async () => {
    if (hydrationStarted) return;
    hydrationStarted = true;

    const client = supabase;

    // Accounts are unconfigured, so there is nothing persisted to restore.
    // Resolve to the login screen.
    if (!client) {
      set({ session: null, user: null, loading: false });
      return;
    }

    // Keep the store mirroring the persisted session for the app's lifetime:
    // token refresh, sign-in, sign-out and restored sessions all land here.
    client.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, loading: false });
    });

    // onAuthStateChange also emits INITIAL_SESSION, but awaiting getSession
    // means hydration resolves even if that event is delayed or dropped.
    let restored: Session | null = null;
    try {
      const result = await Promise.race([
        client.auth.getSession(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), HYDRATION_TIMEOUT_MS)),
      ]);
      restored = result?.data.session ?? null;
    } catch {
      restored = null;
    }

    set((state) => {
      // A listener event may already have supplied the session.
      const next = restored ?? state.session;
      return { session: next, user: next?.user ?? null, loading: false };
    });
  },

  setSession: (session) => {
    set({ session, user: session?.user ?? null, loading: false });
  },

  signOut: async () => {
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
    }
    set({ session: null, user: null, loading: false });
  },
}));

/** Restores the persisted session once, at the app root. */
export const useAuthHydration = () => {
  useEffect(() => {
    void useAuthStore.getState().hydrate();
  }, []);
};
