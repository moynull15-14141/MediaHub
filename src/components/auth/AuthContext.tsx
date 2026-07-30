import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

interface AuthState {
  token: string | null;
  user: { id: string; email: string; createdAt: string; cookieUploadedAt?: string | null } | null;
}

interface AuthContextValue extends AuthState {
  login: (token: string, user: AuthState['user']) => void;
  logout: () => void;
  setUser: (user: AuthState['user']) => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUserState] = useState<AuthState['user']>(null);

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
  }, []);

  const login = (newToken: string, userData: AuthState['user']) => {
    setToken(newToken);
    setUserState(userData);
    localStorage.setItem('mediahub-token', newToken);
    localStorage.setItem('mediahub-user', JSON.stringify(userData));
  };

  const logout = () => {
    setToken(null);
    setUserState(null);
    localStorage.removeItem('mediahub-token');
    localStorage.removeItem('mediahub-user');
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
