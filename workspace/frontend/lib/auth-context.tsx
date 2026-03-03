'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getStoredAuth, clearAuth, login as doLogin } from './auth';

interface AuthContextValue {
  user: { email: string; displayName: string } | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<{ email: string; displayName: string } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredAuth();
    if (stored.accessToken && stored.userEmail) {
      setUser({ email: stored.userEmail, displayName: stored.displayName || stored.userEmail });
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const auth = await doLogin(email, password);
    if (auth.userEmail) {
      setUser({ email: auth.userEmail, displayName: auth.displayName || auth.userEmail });
    }
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
