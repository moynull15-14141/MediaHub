import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { getApiBase } from '@/src/lib/api';

interface AuthState {
  token: string | null;
  user: { id: string; email: string; name?: string | null; createdAt: string; cookieUploadedAt?: string | null } | null;
}

interface AuthContextValue extends AuthState {
  login: (token: string, user: AuthState['user']) => void;
  logout: () => void;
  setUser: (user: AuthState['user']) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

// Access tokens are short-lived (15 min) so a leaked one has a small blast
// radius. This silently exchanges the HttpOnly refresh cookie for a fresh
// one well before expiry, so a login persists for as long as the refresh
// token is valid (30 days) without ever re-showing the login screen.
const REFRESH_INTERVAL_MS = 10 * 60 * 1000;

// Reads the CSRF token the server pairs with the refresh cookie (see
// csrf.middleware.ts) - required as an X-CSRF-Token header on /refresh and
// /logout, the only two endpoints authenticated purely by an ambient cookie.
const readCsrfCookie = (): string | undefined => {
  const match = document.cookie.match(/(?:^|; )mh_csrf_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : undefined;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthState['user']>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const applySession = (newToken: string, userData: AuthState['user']) => {
    setToken(newToken);
    setUserState(userData);
    localStorage.setItem('mediahub-token', newToken);
    localStorage.setItem('mediahub-user', JSON.stringify(userData));
  };

  const tryRefresh = async (): Promise<boolean> => {
    try {
      const csrfToken = readCsrfCookie();
      const res = await fetch(`${getApiBase()}/api/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
      });
      if (!res.ok) return false;
      const body = await res.json();
      applySession(body.token, body.user);
      return true;
    } catch {
      return false;
    }
  };

  useEffect(() => {
    const storedToken = localStorage.getItem('mediahub-token');
    const storedUser = localStorage.getItem('mediahub-user');
    if (storedToken) {
      setToken(storedToken);
    }
    if (storedUser) {
      try {
        setUserState(JSON.parse(storedUser));
      } catch {
        setUserState(null);
      }
    }
    // The stored access token may already be stale (15-minute lifetime)
    // while the HttpOnly refresh cookie can still be valid - always try to
    // silently mint a fresh one on load rather than waiting for a 401.
    if (storedToken) {
      tryRefresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!token) {
      if (refreshTimerRef.current) {
        clearInterval(refreshTimerRef.current);
        refreshTimerRef.current = null;
      }
      return;
    }
    refreshTimerRef.current = setInterval(tryRefresh, REFRESH_INTERVAL_MS);
    return () => {
      if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const login = (newToken: string, userData: AuthState['user']) => {
    applySession(newToken, userData);
  };

  const logout = () => {
    setToken(null);
    setUserState(null);
    localStorage.removeItem('mediahub-token');
    localStorage.removeItem('mediahub-user');
    // Revoke the refresh token server-side too - best-effort, doesn't block
    // the (already-synchronous-feeling) local logout.
    const csrfToken = readCsrfCookie();
    fetch(`${getApiBase()}/api/auth/logout`, {
      method: 'POST',
      credentials: 'include',
      headers: csrfToken ? { 'X-CSRF-Token': csrfToken } : undefined,
    }).catch(() => {});
  };

  const value = useMemo(
    () => ({ token, user, login, logout, setUser: setUserState }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
};
