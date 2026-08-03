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
  // True only until the initial localStorage hydration check has run (one
  // synchronous effect, not the async /refresh call). RequireAuth must wait
  // for this before deciding to redirect to /login - otherwise it redirects
  // during the one render where `token` is still its useState(null) default,
  // even though a valid session exists in localStorage (the login-flash bug).
  initializing: boolean;
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
  const [initializing, setInitializing] = useState(true);
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
    // Hydration from localStorage is synchronous and complete as of this
    // line - safe for RequireAuth to make a redirect decision now. The
    // access token may already be stale (15-minute lifetime) while the
    // HttpOnly refresh cookie can still be valid, so a silent refresh still
    // kicks off in the background below, but it must NOT gate `initializing`
    // - blocking every protected page behind a network round-trip (instead
    // of just a synchronous localStorage read) would trade a one-frame flash
    // for a much longer, more visible blank/loading screen on every load.
    setInitializing(false);
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

  // Used after in-place profile edits (e.g. Profile.tsx's display-name save)
  // to update the current session's user data. Must persist to localStorage,
  // not just React state - otherwise the change appears to "not save" on the
  // next page load/refresh, when the mount effect below re-reads the stale
  // cached user before the periodic token refresh has a chance to correct it.
  const setUser = (userData: AuthState['user']) => {
    setUserState(userData);
    if (userData) {
      localStorage.setItem('mediahub-user', JSON.stringify(userData));
    } else {
      localStorage.removeItem('mediahub-user');
    }
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
    () => ({ token, user, login, logout, setUser, initializing }),
    [token, user, initializing]
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
