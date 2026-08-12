import React, { createContext, useContext, useEffect, useState } from 'react';

export interface AuthUser {
  name: string | null;
  email: string | null;
  oid: string | null;
}

type AuthStatus = 'loading' | 'authed' | 'unauthed';

interface AuthContextType {
  status: AuthStatus;
  user: AuthUser | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then((data: AuthUser) => {
        setUser(data);
        setStatus('authed');
      })
      .catch(() => {
        setUser(null);
        setStatus('unauthed');
      });
  }, []);

  const logout = () => {
    window.location.href = '/api/auth/logout';
  };

  return <AuthContext.Provider value={{ status, user, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
