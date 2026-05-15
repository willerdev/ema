import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { nowpaymentsService } from '../services/nowpaymentsService';
import { useTradingStore } from '../store/useTradingStore';
import type { NowpaymentsLedgerRow, NowpaymentsSummary } from '../types';
import { palette } from '../theme/colors';

function formatLedgerTime(createdAt: string) {
  const ms = Date.parse(createdAt);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function ledgerTitle(row: NowpaymentsLedgerRow) {
  const dir = row.direction === 'in' ? 'Deposit' : 'Withdrawal';
  return `${dir} · ${row.asset.toUpperCase()}`;
}

export function HomeScreen() {
  const { user } = useAuth();
  const { account, refreshDashboard, loading, dashboardError } = useTradingStore();
  const [npSummary, setNpSummary] = useState<NowpaymentsSummary | null>(null);
  const [cryptoError, setCryptoError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refreshCrypto = useCallback(async () => {
    setCryptoError(null);
    try {
      const summary = await nowpaymentsService.getSummary();
      setNpSummary(summary);
    } catch (e: any) {
      setCryptoError(e?.message || 'Failed to load wallet');
      setNpSummary(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    await Promise.all([refreshCrypto(), refreshDashboard()]);
  }, [refreshCrypto, refreshDashboard]);

  usePolling(refresh, 60000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const recentLedger = useMemo(() => {
    const rows = npSummary?.ledger ?? [];
    return [...rows].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 15);
  }, [npSummary?.ledger]);

  const alpacaEquity =
    account?.equity !== undefined && account?.equity !== null ? `$${Number(account.equity).toFixed(2)}` : null;
  const alpacaCash = account?.cash !== undefined && account?.cash !== null ? `$${Number(account.cash).toFixed(2)}` : null;
  const showAlpaca = Boolean(alpacaEquity || alpacaCash || dashboardError);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.greeting}>Hello, {user?.email?.split('@')[0]}</Text>
      <Text style={styles.sub}>Wallet overview</Text>

      <Card style={styles.disclaimerCard}>
        <Text style={styles.disclaimerTitle}>Important notice</Text>
        <Text style={styles.disclaimerText}>
          Withdrawals may be denied if anti-money laundering (AML) concerns are detected, if the withdrawal address is not
          on your whitelist, or if your account is flagged by a government or other authority with the legal power to do so.
        </Text>
        <Text style={styles.disclaimerText}>
          Deposits below $100 may not be credited and those funds can be lost. Always verify minimum amounts before sending.
        </Text>
        <Text style={[styles.disclaimerText, { marginBottom: 0 }]}>
          We will never hold your assets unless you violate these terms. Ema will never call or text you asking you to move
          funds, share passwords, or approve actions outside this app. Do not follow instructions from phone calls or SMS —
          they are scams.
        </Text>
      </Card>

      <Card style={styles.cryptoHero}>
        <Text style={styles.cryptoHeroLabel}>Crypto wallet</Text>
        {cryptoError ? <Text style={styles.warn}>{cryptoError}</Text> : null}
        {!npSummary && !cryptoError ? <Text style={styles.meta}>Loading balances…</Text> : null}
        {npSummary?.balances?.length ? (
          npSummary.balances.map((b) => (
            <View key={b.asset} style={styles.balanceRow}>
              <Text style={styles.assetCode}>{b.asset.toUpperCase()}</Text>
              <Text style={styles.balanceValue}>{b.available}</Text>
              {Number(b.reserved) > 0 ? <Text style={styles.reserved}>Reserved: {b.reserved}</Text> : null}
            </View>
          ))
        ) : npSummary && !cryptoError ? (
          <Text style={styles.meta}>No balance yet — deposit from the Wallet tab.</Text>
        ) : null}
        {npSummary && !npSummary.configured ? (
          <Text style={styles.meta}>Payments provider not fully configured on server.</Text>
        ) : null}
      </Card>

      <Card style={styles.activityCard}>
        <Text style={styles.section}>Recent transactions</Text>
        {recentLedger.length ? (
          recentLedger.map((row) => (
            <View key={row.id} style={styles.activityRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.activityTitle}>{ledgerTitle(row)}</Text>
                <Text style={styles.meta}>
                  {formatLedgerTime(row.createdAt)} · {row.source}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={styles.amount}>
                  {row.direction === 'in' ? '+' : '−'}
                  {row.amount} {row.asset.toUpperCase()}
                </Text>
                <Text
                  style={[
                    styles.badge,
                    row.direction === 'in' ? styles.badgeIn : styles.badgeOut,
                  ]}
                >
                  {row.direction === 'in' ? 'IN' : 'OUT'}
                </Text>
              </View>
            </View>
          ))
        ) : (
          <Text style={styles.meta}>No transactions yet.</Text>
        )}
      </Card>

      {showAlpaca ? (
        <View style={styles.alpacaFootnoteWrap}>
          {dashboardError ? <Text style={styles.alpacaFootnote}>{dashboardError}</Text> : null}
          {loading && !account && !dashboardError ? <Text style={styles.alpacaFootnote}>Broker sync…</Text> : null}
          {alpacaEquity || alpacaCash ? (
            <Text style={styles.alpacaFootnote}>
              Broker (Alpaca){alpacaEquity ? ` · equity ${alpacaEquity}` : ''}
              {alpacaCash ? ` · cash ${alpacaCash}` : ''}
            </Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  greeting: { color: palette.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 14 },
  disclaimerCard: { borderColor: '#b45309', backgroundColor: '#1c1917' },
  disclaimerTitle: { color: '#fbbf24', fontSize: 15, fontWeight: '700', marginBottom: 10 },
  disclaimerText: { color: palette.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: 10 },
  cryptoHero: { marginBottom: 12 },
  cryptoHeroLabel: { color: palette.textSecondary, fontSize: 14, fontWeight: '700', marginBottom: 12 },
  balanceRow: { marginBottom: 14 },
  assetCode: { color: palette.textSecondary, fontSize: 13, fontWeight: '600', marginBottom: 2 },
  balanceValue: { color: palette.textPrimary, fontSize: 28, fontWeight: '800' },
  reserved: { color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  section: { color: palette.textSecondary, fontWeight: '700', marginBottom: 10, fontSize: 15 },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  warn: { color: '#fbbf24', marginBottom: 6 },
  activityCard: { marginBottom: 8 },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  activityTitle: { color: palette.textPrimary, fontWeight: '600' },
  amount: { color: palette.primary, fontWeight: '700', fontSize: 15 },
  badge: { marginTop: 6, fontSize: 11, fontWeight: '800', paddingVertical: 2, paddingHorizontal: 8, borderRadius: 999, overflow: 'hidden' },
  badgeIn: { color: '#052e16', backgroundColor: '#86efac' },
  badgeOut: { color: '#450a0a', backgroundColor: '#fca5a5' },
  alpacaFootnoteWrap: { paddingHorizontal: 4, paddingBottom: 24 },
  alpacaFootnote: { color: palette.textSecondary, fontSize: 11, lineHeight: 16, textAlign: 'center' },
});
