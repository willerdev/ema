import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authService, LoginResult } from '../services/authService';
import { authStorage } from '../services/storage';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeTotpLogin: (preAuthToken: string, code: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const token = await authStorage.getToken();
        if (!token) return;
        const me = await authService.me();
        setUser(me.user);
      } catch {
        await authStorage.clear();
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const result = await authService.login(email, password);
    if (result.kind === 'session') {
      await authStorage.setToken(result.token);
      setUser(result.user);
    }
    return result;
  };

  const completeTotpLogin = async (preAuthToken: string, code: string) => {
    const response = await authService.verifyTotp(code, preAuthToken);
    await authStorage.setToken(response.token);
    setUser(response.user);
  };

  const register = async (email: string, password: string) => {
    const response = await authService.register(email, password);
    await authStorage.setToken(response.token);
    setUser(response.user);
  };

  const logout = async () => {
    await authStorage.clear();
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, loading, login, completeTotpLogin, register, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
