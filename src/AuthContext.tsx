import React, { createContext, useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import type { AuthProfile } from './ai/types';
import { buildAuthRedirectUrl, isSupabaseAuthConfigured, supabase } from './supabaseClient';

interface AuthContextType {
  isConfigured: boolean;
  loading: boolean;
  session: Session | null;
  profile: AuthProfile | null;
  authError: string | null;
  signInWithOtp: (email: string) => Promise<string | null>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const defaultValue: AuthContextType = {
  isConfigured: isSupabaseAuthConfigured,
  loading: false,
  session: null,
  profile: null,
  authError: null,
  signInWithOtp: async () => 'Supabase Auth is not configured.',
  signOut: async () => {},
  refreshProfile: async () => {},
};

export const AuthContext = createContext<AuthContextType>(defaultValue);

function fallbackProfile(user: User): AuthProfile {
  return {
    id: user.id,
    email: user.email ?? '',
    role: 'pro',
  };
}

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(isSupabaseAuthConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<AuthProfile | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const loadProfile = useCallback(async (user: User | null) => {
    if (!user) {
      setProfile(null);
      return;
    }
    if (!supabase) {
      setProfile(fallbackProfile(user));
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('id, email, role, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (error || !data) {
      setProfile(fallbackProfile(user));
      return;
    }

    setProfile({
      id: data.id,
      email: typeof data.email === 'string' ? data.email : (user.email ?? ''),
      role: data.role === 'admin' ? 'admin' : 'pro',
      created_at: typeof data.created_at === 'string' ? data.created_at : undefined,
      updated_at: typeof data.updated_at === 'string' ? data.updated_at : undefined,
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    supabase.auth.getSession().then(async ({ data, error }) => {
      if (cancelled) return;
      if (error) {
        setAuthError(error.message);
      }
      setSession(data.session ?? null);
      await loadProfile(data.session?.user ?? null);
      if (!cancelled) {
        setLoading(false);
      }
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      void loadProfile(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signInWithOtp = useCallback(async (email: string) => {
    if (!supabase) {
      const message = 'Supabase Auth is not configured.';
      setAuthError(message);
      return message;
    }
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      return 'メールアドレスを入力してください。';
    }
    const { error } = await supabase.auth.signInWithOtp({
      email: trimmedEmail,
      options: {
        emailRedirectTo: buildAuthRedirectUrl(),
        shouldCreateUser: false,
      },
    });
    if (error) {
      setAuthError(error.message);
      return error.message;
    }
    setAuthError(null);
    return null;
  }, []);

  const signOut = useCallback(async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) {
      setAuthError(error.message);
    } else {
      setAuthError(null);
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user ?? null);
  }, [loadProfile, session?.user]);

  const value = useMemo<AuthContextType>(() => ({
    isConfigured: isSupabaseAuthConfigured,
    loading,
    session,
    profile,
    authError,
    signInWithOtp,
    signOut,
    refreshProfile,
  }), [authError, loading, profile, refreshProfile, session, signInWithOtp, signOut]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};
