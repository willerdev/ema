import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { localMoneyService, LocalMoneyConfigResponse } from '../services/localMoneyService';

const REGION_CACHE_KEY = 'ema_local_money_region_v1';

const COUNTRY_ALIASES: Record<string, string> = {
  RW: 'RW',
  RWA: 'RW',
  RWANDA: 'RW',
  UG: 'UG',
  UGA: 'UG',
  UGANDA: 'UG',
};

type RegionCache = {
  countryCode: string;
  latitude: number;
  longitude: number;
  updatedAt: number;
};

function normalizeCountryCode(raw: string | null | undefined): string | null {
  const key = String(raw || '')
    .trim()
    .toUpperCase();
  if (!key) return null;
  return COUNTRY_ALIASES[key] || (key.length === 2 ? key : null);
}

async function readRegionCache(): Promise<RegionCache | null> {
  try {
    const raw = await AsyncStorage.getItem(REGION_CACHE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as RegionCache;
    if (!o?.countryCode || typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return null;
    return { ...o, countryCode: String(o.countryCode).toUpperCase() };
  } catch {
    return null;
  }
}

async function writeRegionCache(data: RegionCache) {
  await AsyncStorage.setItem(REGION_CACHE_KEY, JSON.stringify(data));
}

/** Dedupe mismatch alerts across P2P + Mobile money hook instances */
let mismatchAlertDedupeKey: string | null = null;

export function useLocalMoneyRegion() {
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [config, setConfig] = useState<LocalMoneyConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** True after hydrate from disk or GPS (avoids flashing location gate during startup). */
  const [hydrated, setHydrated] = useState(false);
  const reconcileStarted = useRef(false);

  const loadConfig = useCallback(async (code: string) => {
    const data = await localMoneyService.getConfig(code);
    setConfig(data);
    return data;
  }, []);

  const persistSuccess = useCallback(async (iso: string, latitude: number, longitude: number) => {
    await writeRegionCache({ countryCode: iso, latitude, longitude, updatedAt: Date.now() });
  }, []);

  const resolveCountryFromCoords = useCallback(async (latitude: number, longitude: number) => {
    const places = await Location.reverseGeocodeAsync({ latitude, longitude });
    return normalizeCountryCode(places[0]?.isoCountryCode);
  }, []);

  const reconcileWithLiveGps = useCallback(
    (cached: RegionCache) => {
      if (reconcileStarted.current) return;
      reconcileStarted.current = true;
      (async () => {
        try {
          const perm = await Location.getForegroundPermissionsAsync();
          if (perm.status !== 'granted') return;

          let pos: Location.LocationObject | null = null;
          try {
            pos = await Location.getLastKnownPositionAsync({
              maxAge: 3600_000,
              requiredAccuracy: 500,
            });
          } catch {
            pos = null;
          }
          if (!pos) {
            pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
          }
          if (!pos) return;

          const live = await resolveCountryFromCoords(pos.coords.latitude, pos.coords.longitude);
          if (!live || live === cached.countryCode) return;

          const dedupe = `${cached.countryCode}->${live}`;
          if (mismatchAlertDedupeKey === dedupe) return;
          mismatchAlertDedupeKey = dedupe;

          Alert.alert(
            'Location changed',
            `Saved region was ${cached.countryCode}; your device now suggests ${live}. Would you like to update rates for the new region?`,
            [
              { text: 'Keep saved', style: 'cancel' },
              {
                text: `Use ${live}`,
                onPress: async () => {
                  mismatchAlertDedupeKey = null;
                  setCountryCode(live);
                  setLocationStatus('granted');
                  setError(null);
                  await persistSuccess(live, pos.coords.latitude, pos.coords.longitude);
                  await loadConfig(live);
                },
              },
            ]
          );
        } catch {
          /* non-fatal */
        }
      })();
    },
    [loadConfig, persistSuccess, resolveCountryFromCoords]
  );

  const detectFromDevice = useCallback(
    async (opts: { requestPermission: boolean; showBusy: boolean } = { requestPermission: true, showBusy: true }) => {
      if (opts.showBusy) {
        setLocationStatus('requesting');
        setError(null);
        setLoading(true);
      }
      try {
        let granted = false;
        if (opts.requestPermission) {
          const r = await Location.requestForegroundPermissionsAsync();
          granted = r.status === 'granted';
        } else {
          const r = await Location.getForegroundPermissionsAsync();
          granted = r.status === 'granted';
        }
        if (!granted) {
          setLocationStatus('denied');
          setCountryCode(null);
          setConfig(null);
          return false;
        }

        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        const iso = await resolveCountryFromCoords(pos.coords.latitude, pos.coords.longitude);
        if (!iso) {
          setLocationStatus('denied');
          setCountryCode(null);
          setConfig(null);
          setError('Could not determine your country from location.');
          return false;
        }
        setLocationStatus('granted');
        setCountryCode(iso);
        await persistSuccess(iso, pos.coords.latitude, pos.coords.longitude);
        await loadConfig(iso);
        return true;
      } catch (e: any) {
        setLocationStatus('denied');
        setCountryCode(null);
        setConfig(null);
        setError(e?.message || 'Could not detect location');
        return false;
      } finally {
        setHydrated(true);
        if (opts.showBusy) setLoading(false);
      }
    },
    [loadConfig, persistSuccess, resolveCountryFromCoords]
  );

  const detectLocation = useCallback(async () => {
    reconcileStarted.current = false;
    mismatchAlertDedupeKey = null;
    return detectFromDevice({ requestPermission: true, showBusy: true });
  }, [detectFromDevice]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!alive) return;

        if (perm.status !== 'granted') {
          setLocationStatus(perm.status === 'denied' ? 'denied' : 'idle');
          setHydrated(true);
          return;
        }

        const cached = await readRegionCache();
        if (!alive) return;

        if (cached?.countryCode) {
          setCountryCode(cached.countryCode);
          setLocationStatus('granted');
          setError(null);
          try {
            await loadConfig(cached.countryCode);
          } catch {
            /* config API may fail; still allow UI with gate fallback below */
          } finally {
            setHydrated(true);
          }
          reconcileWithLiveGps(cached);
          return;
        }

        await detectFromDevice({ requestPermission: false, showBusy: true });
      } catch {
        if (alive) {
          setLocationStatus('idle');
          setHydrated(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap once on mount
  }, []);

  const locationReady = hydrated && locationStatus === 'granted' && Boolean(countryCode);

  return {
    countryCode,
    config,
    loading,
    error,
    locationStatus,
    locationReady,
    bootstrapComplete: hydrated,
    detectLocation,
    supported: Boolean(locationReady && config?.supported && config.region),
    region: config?.region ?? null,
    usdtPairLabel: config?.usdtPairLabel ?? 'USDT',
    sampleOffers: config?.sampleOffers ?? [],
  };
}
