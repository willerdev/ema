import { useCallback, useState } from 'react';
import * as Location from 'expo-location';
import { localMoneyService, LocalMoneyConfigResponse } from '../services/localMoneyService';

const COUNTRY_ALIASES: Record<string, string> = {
  RW: 'RW',
  RWA: 'RW',
  RWANDA: 'RW',
  UG: 'UG',
  UGA: 'UG',
  UGANDA: 'UG',
};

function normalizeCountryCode(raw: string | null | undefined): string | null {
  const key = String(raw || '')
    .trim()
    .toUpperCase();
  if (!key) return null;
  return COUNTRY_ALIASES[key] || (key.length === 2 ? key : null);
}

export function useLocalMoneyRegion() {
  const [countryCode, setCountryCode] = useState<string | null>(null);
  const [locationStatus, setLocationStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied'>('idle');
  const [config, setConfig] = useState<LocalMoneyConfigResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async (code: string) => {
    const data = await localMoneyService.getConfig(code);
    setConfig(data);
    return data;
  }, []);

  const detectLocation = useCallback(async () => {
    setLocationStatus('requesting');
    setError(null);
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('denied');
        setCountryCode(null);
        setConfig(null);
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const iso = normalizeCountryCode(places[0]?.isoCountryCode);
      if (!iso) {
        setLocationStatus('denied');
        setCountryCode(null);
        setConfig(null);
        setError('Could not determine your country from location.');
        return;
      }
      setLocationStatus('granted');
      setCountryCode(iso);
      await loadConfig(iso);
    } catch (e: any) {
      setLocationStatus('denied');
      setCountryCode(null);
      setConfig(null);
      setError(e?.message || 'Could not detect location');
    } finally {
      setLoading(false);
    }
  }, [loadConfig]);

  const locationReady = locationStatus === 'granted' && Boolean(countryCode);

  return {
    countryCode,
    config,
    loading,
    error,
    locationStatus,
    locationReady,
    detectLocation,
    supported: Boolean(locationReady && config?.supported && config.region),
    region: config?.region ?? null,
    usdtPairLabel: config?.usdtPairLabel ?? 'USDT',
    sampleOffers: config?.sampleOffers ?? [],
  };
}
