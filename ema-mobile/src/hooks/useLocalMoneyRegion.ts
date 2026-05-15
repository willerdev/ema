import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import { complianceService } from '../services/complianceService';
import { localMoneyService, LocalMoneyConfigResponse, LocalMoneyRegion } from '../services/localMoneyService';

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
  const [regions, setRegions] = useState<LocalMoneyRegion[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConfig = useCallback(async (code: string) => {
    const data = await localMoneyService.getConfig(code);
    setConfig(data);
    return data;
  }, []);

  const detectLocation = useCallback(async () => {
    setLocationStatus('requesting');
    setError(null);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setLocationStatus('denied');
        const profile = await complianceService.getProfile();
        const fromProfile = normalizeCountryCode(profile.profile?.country);
        if (fromProfile) {
          setCountryCode(fromProfile);
          await loadConfig(fromProfile);
        }
        return;
      }
      setLocationStatus('granted');
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const places = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });
      const iso = normalizeCountryCode(places[0]?.isoCountryCode);
      if (iso) {
        setCountryCode(iso);
        await loadConfig(iso);
        return;
      }
      setLocationStatus('denied');
    } catch (e: any) {
      setLocationStatus('denied');
      setError(e?.message || 'Could not detect location');
    }
  }, [loadConfig]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { regions: list } = await localMoneyService.getRegions();
        if (!cancelled) setRegions(list);
        await detectLocation();
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'Failed to load local money settings');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [detectLocation]);

  const selectCountry = useCallback(
    async (code: string) => {
      const normalized = normalizeCountryCode(code);
      if (!normalized) return;
      setCountryCode(normalized);
      setLoading(true);
      try {
        await loadConfig(normalized);
      } finally {
        setLoading(false);
      }
    },
    [loadConfig]
  );

  return {
    countryCode,
    config,
    regions,
    loading,
    error,
    locationStatus,
    detectLocation,
    selectCountry,
    supported: Boolean(config?.supported && config.region),
    region: config?.region ?? null,
    usdtPairLabel: config?.usdtPairLabel ?? 'USDT',
    sampleOffers: config?.sampleOffers ?? [],
  };
}
