import React, { createContext, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';

export type User = {
  id: string;
  email: string;
  emailConfirmedAt: string | null;
};

type AuthContextType = {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;

    const syncSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      if (error) {
        console.warn('Session fetch failed:', error.message);
        if (active) setUser(null);
        return;
      }

      const confirmedUser = session?.user;
      if (!confirmedUser || !confirmedUser.email_confirmed_at) {
        if (session) {
          await supabase.auth.signOut({ scope: 'local' });
        }
        if (active) setUser(null);
        return;
      }

      if (active) {
        setUser({
          id: confirmedUser.id,
          email: confirmedUser.email ?? '',
          emailConfirmedAt: confirmedUser.email_confirmed_at ?? null,
        });
      }
    };

    syncSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      const confirmedUser = session?.user;
      if (!confirmedUser || !confirmedUser.email_confirmed_at) {
        if (session) {
          await supabase.auth.signOut({ scope: 'local' });
        }
        if (active) setUser(null);
        return;
      }

      if (active) {
        setUser({
          id: confirmedUser.id,
          email: confirmedUser.email ?? '',
          emailConfirmedAt: confirmedUser.email_confirmed_at ?? null,
        });
      }
    });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  const login = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;

      const confirmedUser = data.user;
      if (!confirmedUser || !confirmedUser.email_confirmed_at) {
        await supabase.auth.signOut({ scope: 'local' });
        throw new Error('Please confirm your email before signing in.');
      }

      setUser({
        id: confirmedUser.id,
        email: confirmedUser.email ?? email,
        emailConfirmedAt: confirmedUser.email_confirmed_at ?? null,
      });
    } finally {
      setLoading(false);
    }
  };

  const register = async (email: string, password: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: 'lakehouse://auth',
        },
      });
      if (error) throw error;

      if (data.session) {
        const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
        if (signOutError) throw signOutError;
      }

      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const logout = async () => {
    setLoading(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw error;
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const value = useMemo(
    () => ({ user, loading, login, register, logout }),
    [user, loading]
  );

  return React.createElement(AuthContext.Provider, { value }, children);
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
