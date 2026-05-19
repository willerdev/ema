import * as SecureStore from 'expo-secure-store';

const KEYS = {
  pinEnabled: 'ema_pin_enabled',
  pinHash: 'ema_pin_hash',
  pinSalt: 'ema_pin_salt',
  biometricLoginEnabled: 'ema_biometric_login_enabled',
  secureAuthToken: 'ema_secure_auth_token',
  lastActiveAt: 'ema_last_active_at',
} as const;

async function getItem(key: string): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(key);
  } catch {
    return null;
  }
}

async function setItem(key: string, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value);
}

async function deleteItem(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key);
  } catch {
    // ignore
  }
}

export const securityStorage = {
  async isPinEnabled(): Promise<boolean> {
    return (await getItem(KEYS.pinEnabled)) === '1';
  },

  async getPinCredentials(): Promise<{ hash: string; salt: string } | null> {
    const hash = await getItem(KEYS.pinHash);
    const salt = await getItem(KEYS.pinSalt);
    if (!hash || !salt) return null;
    return { hash, salt };
  },

  async setPin(hash: string, salt: string): Promise<void> {
    await setItem(KEYS.pinHash, hash);
    await setItem(KEYS.pinSalt, salt);
    await setItem(KEYS.pinEnabled, '1');
  },

  async clearPin(): Promise<void> {
    await deleteItem(KEYS.pinHash);
    await deleteItem(KEYS.pinSalt);
    await deleteItem(KEYS.pinEnabled);
  },

  async isBiometricLoginEnabled(): Promise<boolean> {
    return (await getItem(KEYS.biometricLoginEnabled)) === '1';
  },

  async setBiometricLoginEnabled(enabled: boolean): Promise<void> {
    if (enabled) {
      await setItem(KEYS.biometricLoginEnabled, '1');
    } else {
      await deleteItem(KEYS.biometricLoginEnabled);
      await deleteItem(KEYS.secureAuthToken);
    }
  },

  async getSecureAuthToken(): Promise<string | null> {
    return getItem(KEYS.secureAuthToken);
  },

  async setSecureAuthToken(token: string): Promise<void> {
    await setItem(KEYS.secureAuthToken, token);
  },

  async clearSecureAuthToken(): Promise<void> {
    await deleteItem(KEYS.secureAuthToken);
  },

  async setLastActiveAt(ms: number): Promise<void> {
    await setItem(KEYS.lastActiveAt, String(ms));
  },

  async getLastActiveAt(): Promise<number> {
    const raw = await getItem(KEYS.lastActiveAt);
    const n = Number(raw);
    return Number.isFinite(n) ? n : Date.now();
  },
};
