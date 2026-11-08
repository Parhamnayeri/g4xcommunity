import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { User, AuthContextType } from '../types/auth';
import { fetchCurrentUser, logoutUser } from '../services/auth';
import { getCsrfToken } from '../services/api';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [csrfToken, setCsrfToken] = useState<string | null>(null);
  const [status, setStatus] = useState<AuthContextType['status']>('loading');

  const refreshUser = useCallback(async () => {
    try {
      const [currentUser, token] = await Promise.all([
        fetchCurrentUser(),
        getCsrfToken(),
      ]);
      setUser(currentUser);
      setCsrfToken(token);
      setStatus(currentUser ? 'authenticated' : 'unauthenticated');
    } catch {
      setUser(null);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const hasRole = useCallback((...roles: string[]): boolean => {
    if (!user || !user.roles) return false;
    return roles.some((role) => user.roles.includes(role));
  }, [user]);

  const value: AuthContextType = {
    user,
    status,
    csrfToken,
    loginUrl: '/auth/discord',
    logout: logoutUser,
    refreshUser,
    hasRole,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
