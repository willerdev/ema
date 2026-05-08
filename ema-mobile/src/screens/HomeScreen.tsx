import { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { useAuth } from '../context/AuthContext';
import { useActivityFeed } from '../hooks/useActivityFeed';
import { usePolling } from '../hooks/usePolling';
import { cryptoWalletService } from '../services/cryptoWalletService';
import { useTradingStore } from '../store/useTradingStore';
import type { CryptoSummary } from '../types';
import { palette } from '../theme/colors';

export function HomeScreen() {
  const { user } = useAuth();
  const { account, orders, refreshDashboard, refreshTrades, loading, dashboardError } = useTradingStore();
  const [cryptoSummary, setCryptoSummary] = useState<CryptoSummary | null>(null);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const activity = useActivityFeed(orders, cryptoSummary?.activity || []);

  const refreshCrypto = useCallback(async () => {
    setCryptoError(null);
    try {
      // Queue a throttled backend refresh (max once/minute per user).
      try {
        await cryptoWalletService.refreshBalances();
      } catch {
        // summary call still returns cached balances/status
      }
      let s = await cryptoWalletService.getSummary();
      if (!s.onboarded) {
        try {
          await cryptoWalletService.onboard();
          s = await cryptoWalletService.getSummary();
        } catch (e: any) {
          setCryptoError(e?.message || 'Crypto unavailable');
          setCryptoSummary(null);
          return;
        }
      }
      setCryptoSummary(s);
    } catch (e: any) {
      setCryptoError(e?.message || 'Failed to load crypto');
      setCryptoSummary(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshTrades(), refreshCrypto()]);
  }, [refreshDashboard, refreshTrades, refreshCrypto]);

  usePolling(refresh, 60000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const ethBal = cryptoSummary?.balances.find((b) => b.asset === 'ETH')?.balance ?? '—';
  const usdtBal = cryptoSummary?.balances.find((b) => b.asset === 'USDT')?.balance ?? '—';
  const alpacaEquity = account?.equity !== undefined && account?.equity !== null ? `$${Number(account.equity).toFixed(2)}` : '—';
  const alpacaCash = account?.cash !== undefined && account?.cash !== null ? `$${Number(account.cash).toFixed(2)}` : '—';
  const syncLabel = (() => {
    const status = cryptoSummary?.balanceSync?.status || 'idle';
    const updatedAt = cryptoSummary?.balanceSync?.updatedAt;
    const msg = cryptoSummary?.balanceSync?.message;
    if (msg) return `Sync: ${status} - ${msg}`;
    if (!updatedAt) return `Sync: ${status}`;
    return `Sync: ${status} · ${new Date(updatedAt).toLocaleTimeString()}`;
  })();

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.greeting}>Hello, {user?.email?.split('@')[0]}</Text>
      <Text style={styles.sub}>Balances overview</Text>

      <Card>
        <Text style={styles.section}>Crypto (on-chain)</Text>
        {cryptoError ? <Text style={styles.warn}>{cryptoError}</Text> : null}
        <Text style={styles.meta}>{syncLabel}</Text>
        {!cryptoSummary && !cryptoError ? <Text style={styles.meta}>Loading crypto…</Text> : null}
        {cryptoSummary?.onboarded ? (
          <>
            <Text style={styles.balanceLine}>
              <Text style={styles.asset}>ETH</Text> {ethBal}
            </Text>
            <Text style={styles.balanceLine}>
              <Text style={styles.asset}>USDT</Text> {usdtBal}
            </Text>
          </>
        ) : cryptoSummary && !cryptoSummary.onboarded ? (
          <Text style={styles.meta}>Crypto wallet not ready</Text>
        ) : null}
      </Card>

      <Card>
        <Text style={styles.section}>Alpaca</Text>
        {dashboardError ? <Text style={styles.warn}>{dashboardError}</Text> : null}
        {loading && !account ? <Text style={styles.meta}>Loading…</Text> : null}
        <Text style={styles.big}>{alpacaEquity}</Text>
        <Text style={styles.meta}>Equity</Text>
        <Text style={styles.balanceLine}>
          <Text style={styles.asset}>Cash</Text> {alpacaCash}
        </Text>
      </Card>

      <Card>
        <Text style={styles.section}>Recent activity</Text>
        {activity.map((row) => (
          <View key={row.id} style={styles.activityRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.activityTitle}>{row.title}</Text>
              <Text style={styles.meta}>{row.subtitle}</Text>
            </View>
            {row.amountLabel ? <Text style={styles.amount}>{row.amountLabel}</Text> : null}
          </View>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  greeting: { color: palette.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 14 },
  section: { color: palette.textSecondary, fontWeight: '700', marginBottom: 10, fontSize: 15 },
  big: { color: palette.textPrimary, fontSize: 32, fontWeight: '800', marginBottom: 4 },
  balanceLine: { color: palette.textPrimary, marginBottom: 6, fontSize: 16 },
  asset: { color: palette.textSecondary, fontWeight: '600' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  warn: { color: '#fbbf24', marginBottom: 6 },
  activityRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: palette.border },
  activityTitle: { color: palette.textPrimary, fontWeight: '600' },
  amount: { color: palette.primary, fontWeight: '700' },
});
