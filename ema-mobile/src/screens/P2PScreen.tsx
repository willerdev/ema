import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { LocationGateCard } from '../components/LocationGateCard';
import { PrimaryButton } from '../components/PrimaryButton';
import { useLocalMoneyRegion } from '../hooks/useLocalMoneyRegion';
import { ExtraStackParamList } from '../types';
import { palette } from '../theme/colors';

export type P2PSide = 'buy' | 'sell';

export type P2POffer = {
  id: string;
  side: P2PSide;
  asset: string;
  fiat: string;
  price: number;
  limitMin: number;
  limitMax: number;
  paymentMethods: string[];
  trader: string;
  completedTrades: number;
  rating: number;
};

type SideFilter = 'all' | P2PSide;
type Nav = NativeStackNavigationProp<ExtraStackParamList, 'P2P'>;

export function P2PScreen() {
  const navigation = useNavigation<Nav>();
  const {
    supported,
    region,
    usdtPairLabel,
    sampleOffers,
    loading,
    locationStatus,
    locationReady,
    detectLocation,
    error,
  } = useLocalMoneyRegion();
  const [sideFilter, setSideFilter] = useState<SideFilter>('all');
  const [assetFilter, setAssetFilter] = useState<string>('all');

  const offers: P2POffer[] = useMemo(() => {
    if (supported && sampleOffers.length) {
      return sampleOffers.map((o) => ({
        id: o.id,
        side: o.side,
        asset: o.asset,
        fiat: o.fiat,
        price: o.price,
        limitMin: o.limitMin,
        limitMax: o.limitMax,
        paymentMethods: o.paymentMethods,
        trader: o.trader,
        completedTrades: o.completedTrades,
        rating: o.rating,
      }));
    }
    return [];
  }, [supported, sampleOffers]);

  const assets = useMemo(() => ['all', ...Array.from(new Set(offers.map((o) => o.asset)))], [offers]);

  const filtered = useMemo(() => {
    return offers.filter((o) => {
      if (sideFilter !== 'all' && o.side !== sideFilter) return false;
      if (assetFilter !== 'all' && o.asset !== assetFilter) return false;
      return true;
    });
  }, [offers, sideFilter, assetFilter]);

  if (!locationReady) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Text style={styles.sub}>
          Enable location to see peer offers and local USDT rates for where you are.
        </Text>
        <LocationGateCard locationStatus={locationStatus} error={error} onEnableLocation={detectLocation} />
      </ScrollView>
    );
  }

  if (!supported || !region) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
        <Card>
          <Text style={styles.emptyTitle}>Not available in your region</Text>
          <Text style={styles.meta}>Local P2P and mobile money are not offered where you are located.</Text>
        </Card>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text style={styles.sub}>
        Rates for {region.countryName}: {usdtPairLabel}. Trade USDT using mobile money.
      </Text>

      <Card style={styles.rateCard}>
        <Text style={styles.rateValue}>
          1 USDT ≈ {region.usdtToFiatRate.toLocaleString()} {region.fiatLabel}
        </Text>
      </Card>

      <PrimaryButton
        label='Deposit or withdraw (mobile money)'
        onPress={() => navigation.navigate('LocalMoney')}
        style={{ marginBottom: 14 }}
      />

      <View style={styles.filterRow}>
        {(['all', 'buy', 'sell'] as SideFilter[]).map((key) => (
          <Pressable
            key={key}
            style={[styles.filterChip, sideFilter === key && styles.filterChipActive]}
            onPress={() => setSideFilter(key)}
          >
            <Text style={[styles.filterChipText, sideFilter === key && styles.filterChipTextActive]}>
              {key === 'all' ? 'All' : key === 'buy' ? 'Buy' : 'Sell'}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.assetScroll}>
        {assets.map((a) => (
          <Pressable
            key={a}
            style={[styles.assetChip, assetFilter === a && styles.assetChipActive]}
            onPress={() => setAssetFilter(a)}
          >
            <Text style={[styles.assetChipText, assetFilter === a && styles.assetChipTextActive]}>
              {a === 'all' ? 'All assets' : a}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {loading ? <Text style={styles.meta}>Loading offers…</Text> : null}

      {!loading && !filtered.length ? (
        <Card>
          <Text style={styles.emptyTitle}>No local offers</Text>
          <Text style={styles.meta}>Open Mobile money from Extra to deposit or withdraw.</Text>
        </Card>
      ) : null}

      {filtered.map((offer) => (
        <Card key={offer.id} style={styles.offerCard}>
          <View style={styles.offerHeader}>
            <View>
              <Text style={styles.offerSide}>
                {offer.side === 'buy' ? 'Buy' : 'Sell'} {offer.asset}
              </Text>
              <Text style={styles.trader}>{offer.trader}</Text>
            </View>
            <View style={styles.ratingWrap}>
              <Text style={styles.rating}>{offer.rating}%</Text>
              <Text style={styles.meta}>{offer.completedTrades} trades</Text>
            </View>
          </View>

          <Text style={styles.price}>
            {offer.price.toLocaleString(undefined, { maximumFractionDigits: 2 })} {offer.fiat}
          </Text>
          <Text style={styles.meta}>
            Limit {offer.limitMin.toLocaleString()} – {offer.limitMax.toLocaleString()} {offer.fiat}
          </Text>
          <Text style={styles.meta}>Pay via: {offer.paymentMethods.join(' · ')}</Text>

          <PrimaryButton
            compact
            label={offer.side === 'sell' ? `Buy ${offer.asset}` : `Sell ${offer.asset}`}
            onPress={() => navigation.navigate('LocalMoney')}
            style={{ marginTop: 10, alignSelf: 'flex-start' }}
          />
        </Card>
      ))}

      <Text style={styles.footerNote}>
        Complete a trade via Mobile money. Two-factor authentication is required for withdrawals.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  sub: { color: palette.textSecondary, lineHeight: 20, marginBottom: 14, fontSize: 13 },
  rateCard: { marginBottom: 12 },
  rateValue: { color: palette.primary, fontSize: 18, fontWeight: '800' },
  filterRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  filterChip: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    backgroundColor: palette.surfaceElevated,
  },
  filterChipActive: { borderColor: palette.primary, backgroundColor: '#1f2937' },
  filterChipText: { color: palette.textSecondary, fontWeight: '600', fontSize: 13 },
  filterChipTextActive: { color: palette.primary },
  assetScroll: { marginBottom: 14, maxHeight: 40 },
  assetChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
    marginRight: 8,
    backgroundColor: palette.surfaceElevated,
  },
  assetChipActive: { borderColor: palette.primary },
  assetChipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '600' },
  assetChipTextActive: { color: palette.primary },
  offerCard: { marginBottom: 10 },
  offerHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  offerSide: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  trader: { color: palette.textSecondary, fontSize: 13, marginTop: 2 },
  ratingWrap: { alignItems: 'flex-end' },
  rating: { color: palette.success, fontWeight: '700' },
  price: { color: palette.primary, fontSize: 20, fontWeight: '800', marginBottom: 4 },
  meta: { color: palette.textSecondary, fontSize: 12, marginBottom: 2 },
  emptyTitle: { color: palette.textPrimary, fontWeight: '700', marginBottom: 4 },
  footerNote: { color: palette.textSecondary, fontSize: 11, textAlign: 'center', marginTop: 8, lineHeight: 16 },
});
