import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { authService, LoginResult } from '../services/authService';
import { securityStorage } from '../services/securityStorage';
import { authStorage } from '../services/storage';
import { authenticateBiometric } from '../utils/biometrics';
import { User } from '../types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  completeTotpLogin: (preAuthToken: string, code: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  loginWithBiometric: () => Promise<boolean>;
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

  const persistSession = async (token: string, nextUser: User) => {
    await authStorage.setToken(token);
    const bioOn = await securityStorage.isBiometricLoginEnabled();
    if (bioOn) {
      await securityStorage.setSecureAuthToken(token);
    }
    await securityStorage.setLastActiveAt(Date.now());
    setUser(nextUser);
  };

  const login = async (email: string, password: string): Promise<LoginResult> => {
    const result = await authService.login(email, password);
    if (result.kind === 'session') {
      await persistSession(result.token, result.user);
    }
    return result;
  };

  const completeTotpLogin = async (preAuthToken: string, code: string) => {
    const response = await authService.verifyTotp(code, preAuthToken);
    await persistSession(response.token, response.user);
  };

  const register = async (email: string, password: string) => {
    const response = await authService.register(email, password);
    await persistSession(response.token, response.user);
  };

  const loginWithBiometric = async (): Promise<boolean> => {
    const enabled = await securityStorage.isBiometricLoginEnabled();
    const token = await securityStorage.getSecureAuthToken();
    if (!enabled || !token) return false;
    const ok = await authenticateBiometric('Sign in to Airfarms');
    if (!ok) return false;
    try {
      await authStorage.setToken(token);
      const me = await authService.me();
      await securityStorage.setLastActiveAt(Date.now());
      setUser(me.user);
      return true;
    } catch {
      await authStorage.clear();
      await securityStorage.clearSecureAuthToken();
      return false;
    }
  };

  const logout = async () => {
    await authStorage.clear();
    await securityStorage.clearSecureAuthToken();
    setUser(null);
  };

  const value = useMemo(
    () => ({ user, loading, login, completeTotpLogin, register, loginWithBiometric, logout }),
    [user, loading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
