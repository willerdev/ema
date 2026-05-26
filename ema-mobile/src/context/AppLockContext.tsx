import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { securityStorage } from '../services/securityStorage';
import { authenticateBiometric, canUseBiometrics } from '../utils/biometrics';
import { verifyPin } from '../utils/pin';

const IDLE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 15_000;

interface AppLockContextValue {
  locked: boolean;
  pinEnabled: boolean;
  biometricAvailable: boolean;
  biometricLoginEnabled: boolean;
  suspendLock: (v: boolean) => void;
  recordActivity: () => void;
  unlockWithPin: (pin: string) => Promise<boolean>;
  unlockWithBiometric: () => Promise<boolean>;
  refreshSecurityPrefs: () => Promise<void>;
}

const AppLockContext = createContext<AppLockContextValue | undefined>(undefined);

export function AppLockProvider({
  children,
  isAuthenticated,
}: {
  children: React.ReactNode;
  isAuthenticated: boolean;
}) {
  const [locked, setLocked] = useState(false);
  const [pinEnabled, setPinEnabled] = useState(false);
  const [biometricAvailable, setBiometricAvailable] = useState(false);
  const [biometricLoginEnabled, setBiometricLoginEnabled] = useState(false);
  const suspendRef = useRef(false);
  const lastActiveRef = useRef(Date.now());

  const refreshSecurityPrefs = useCallback(async () => {
    const [pinOn, bioOn, bioOk] = await Promise.all([
      securityStorage.isPinEnabled(),
      securityStorage.isBiometricLoginEnabled(),
      canUseBiometrics(),
    ]);
    setPinEnabled(pinOn);
    setBiometricLoginEnabled(bioOn);
    setBiometricAvailable(bioOk);
  }, []);

  useEffect(() => {
    void refreshSecurityPrefs();
  }, [refreshSecurityPrefs, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const now = Date.now();
    lastActiveRef.current = now;
    void securityStorage.setLastActiveAt(now);
    setLocked(false);
  }, [isAuthenticated]);

  const recordActivity = useCallback(() => {
    const now = Date.now();
    lastActiveRef.current = now;
    void securityStorage.setLastActiveAt(now);
    if (locked) return;
  }, [locked]);

  const suspendLock = useCallback((v: boolean) => {
    suspendRef.current = v;
    if (v) recordActivity();
  }, [recordActivity]);

  const maybeLock = useCallback(async () => {
    if (!isAuthenticated || suspendRef.current) return;
    const enabled = await securityStorage.isPinEnabled();
    if (!enabled) return;
    const last = await securityStorage.getLastActiveAt();
    lastActiveRef.current = last;
    if (Date.now() - last >= IDLE_MS) {
      setLocked(true);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      setLocked(false);
      return;
    }
    void maybeLock();
    const id = setInterval(() => void maybeLock(), CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [isAuthenticated, maybeLock]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        void maybeLock();
      } else if (state === 'background' || state === 'inactive') {
        void securityStorage.setLastActiveAt(lastActiveRef.current);
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, maybeLock]);

  const unlockWithPin = useCallback(async (pin: string) => {
    const creds = await securityStorage.getPinCredentials();
    if (!creds) return false;
    const ok = await verifyPin(pin, creds.salt, creds.hash);
    if (!ok) return false;
    const now = Date.now();
    lastActiveRef.current = now;
    await securityStorage.setLastActiveAt(now);
    setLocked(false);
    return true;
  }, []);

  const unlockWithBiometric = useCallback(async () => {
    const bioOn = await securityStorage.isBiometricLoginEnabled();
    if (!bioOn) return false;
    const ok = await authenticateBiometric('Unlock Airfarms');
    if (!ok) return false;
    const now = Date.now();
    lastActiveRef.current = now;
    await securityStorage.setLastActiveAt(now);
    setLocked(false);
    return true;
  }, []);

  const value = useMemo(
    () => ({
      locked,
      pinEnabled,
      biometricAvailable,
      biometricLoginEnabled,
      suspendLock,
      recordActivity,
      unlockWithPin,
      unlockWithBiometric,
      refreshSecurityPrefs,
    }),
    [
      locked,
      pinEnabled,
      biometricAvailable,
      biometricLoginEnabled,
      suspendLock,
      recordActivity,
      unlockWithPin,
      unlockWithBiometric,
      refreshSecurityPrefs,
    ]
  );

  return <AppLockContext.Provider value={value}>{children}</AppLockContext.Provider>;
}

export function useAppLock() {
  const ctx = useContext(AppLockContext);
  if (!ctx) throw new Error('useAppLock must be used inside AppLockProvider');
  return ctx;
}
