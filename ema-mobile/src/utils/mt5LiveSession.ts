import AsyncStorage from '@react-native-async-storage/async-storage';

const LIVE_PAUSED_KEY = 'ema.mt5.livePaused';

/** Default true — live MetaApi sync only after user taps Connect live. */
export async function isMt5LivePaused(): Promise<boolean> {
  const v = await AsyncStorage.getItem(LIVE_PAUSED_KEY);
  if (v === null) return true;
  return v === '1';
}

export async function setMt5LivePaused(paused: boolean): Promise<void> {
  await AsyncStorage.setItem(LIVE_PAUSED_KEY, paused ? '1' : '0');
}
