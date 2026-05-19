import * as Crypto from 'expo-crypto';

const PIN_LENGTH = 4;

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function hashPin(pin: string, salt: string): Promise<string> {
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
}

export async function verifyPin(pin: string, salt: string, expectedHash: string): Promise<boolean> {
  if (!isValidPin(pin)) return false;
  const hash = await hashPin(pin, salt);
  return hash === expectedHash;
}

export function generatePinSalt(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export { PIN_LENGTH };
