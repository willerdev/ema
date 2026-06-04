import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { Card } from '../components/Card';
import { QuoteRow } from '../components/QuoteRow';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  accountDisplayBalance,
  liveTradingService,
  type LivePosition,
  type LivePrice,
  type LiveTradingAccount,
} from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Tab = 'quotes' | 'trades';

type R = RouteProp<RootStackParamList, 'LiveTradingAccount'>;

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LiveTradingAccountScreen() {
  const route = useRoute<R>();
  const accountId = route.params.accountId;
  const [tab, setTab] = useState<Tab>('quotes');
  const [summary, setSummary] = useState<LiveTradingAccount | null>(null);
  const [prices, setPrices] = useState<LivePrice[]>([]);
  const [positions, setPositions] = useState<LivePosition[]>([]);
  const [fundAmount, setFundAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  const loadSummary = useCallback(async () => {
    try {
      setSummary(await liveTradingService.getSummary(accountId));
    } catch (e: any) {
      setError(e?.message || 'Failed to load account');
    }
  }, [accountId]);

  const loadQuotes = useCallback(async () => {
    try {
      const data = await liveTradingService.getPrices();
      setPrices(data.prices || []);
    } catch {
      setPrices([]);
    }
  }, []);

  const loadTrades = useCallback(async () => {
    try {
      const data = await liveTradingService.getPositions(accountId);
      setPositions(data.positions || []);
      setError(null);
    } catch (e: any) {
      setPositions([]);
      setError(e?.message || null);
    }
  }, [accountId]);

  useEffect(() => {
    void loadSummary();
    const id = setInterval(() => void loadSummary(), 1000);
    return () => clearInterval(id);
  }, [loadSummary]);

  useEffect(() => {
    if (tab === 'quotes') void loadQuotes();
    else void loadTrades();
  }, [tab, loadQuotes, loadTrades]);

  const onFund = async () => {
    const n = Number(fundAmount);
    if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
    try {
      const res = await liveTradingService.fund(accountId, n);
      setSummary(res.account);
      setFundAmount('');
      Alert.alert('Funded', `Balance ${fmtUsd(accountDisplayBalance(res.account))}`);
    } catch (e: any) {
      Alert.alert('Fund', e?.message || 'Failed');
    }
  };

  const onClose = (p: LivePosition) => {
    Alert.alert('Close trade', `Close ${p.symbol}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        onPress: async () => {
          try {
            await liveTradingService.closePosition(accountId, p.id);
            await loadTrades();
            await loadSummary();
          } catch (e: any) {
            Alert.alert('Close', e?.message || 'Failed');
          }
        },
      },
    ]);
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 80 }}>
        <Text style={styles.balance}>{summary ? fmtUsd(accountDisplayBalance(summary)) : '—'}</Text>
        <Text style={styles.balanceSub}>
          Deposited {summary ? fmtUsd(summary.depositedBalance) : '—'}
          {summary?.snapshotFresh ? ` · Open P/L ${fmtUsd(summary.openProfit)}` : ''}
        </Text>
        <View style={styles.fundRow}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={fundAmount}
            onChangeText={setFundAmount}
            placeholder={`Fund (min ${summary?.minDepositUsd ?? 0})`}
            placeholderTextColor={palette.textSecondary}
            keyboardType='numeric'
          />
          <PrimaryButton compact label='Fund' onPress={() => void onFund()} />
        </View>
        <View style={styles.tabs}>
          {(['quotes', 'trades'] as Tab[]).map((t) => (
            <Pressable key={t} style={[styles.tab, tab === t && styles.tabOn]} onPress={() => setTab(t)}>
              <Text style={[styles.tabText, tab === t && styles.tabTextOn]}>{t === 'quotes' ? 'Quotes' : 'Trades'}</Text>
            </Pressable>
          ))}
        </View>
        {tab === 'quotes' ? (
          <Card>
            {prices.map((p) => (
              <QuoteRow key={p.symbol} price={p} />
            ))}
            {!prices.length ? <Text style={styles.meta}>No quotes yet.</Text> : null}
          </Card>
        ) : (
          <Card>
            {error ? <Text style={styles.err}>{error}</Text> : null}
            {positions.map((p) => (
              <View key={p.id} style={styles.tradeRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.tradeSym}>{p.symbol}</Text>
                  <Text style={styles.meta}>
                    {p.side} · {p.volume.toFixed(2)} @ {p.openPrice.toFixed(5)}
                  </Text>
                </View>
                <Text style={{ color: p.profit >= 0 ? palette.success : palette.danger, fontWeight: '700' }}>
                  {p.profit.toFixed(2)}
                </Text>
                <PrimaryButton compact label='Close' onPress={() => onClose(p)} />
              </View>
            ))}
            {!positions.length && !error ? <Text style={styles.meta}>No open trades right now.</Text> : null}
          </Card>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  balance: { color: palette.primary, fontSize: 32, fontWeight: '800', textAlign: 'center' },
  balanceSub: { color: palette.textSecondary, textAlign: 'center', marginBottom: 12 },
  fundRow: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 10,
  },
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 12 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 10, backgroundColor: palette.surfaceElevated, alignItems: 'center' },
  tabOn: { backgroundColor: palette.primary },
  tabText: { color: palette.textSecondary, fontWeight: '700' },
  tabTextOn: { color: palette.background },
  meta: { color: palette.textSecondary, fontSize: 13, paddingVertical: 8 },
  err: { color: '#fbbf24', marginBottom: 8 },
  tradeRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: palette.border },
  tradeSym: { color: palette.textPrimary, fontWeight: '700' },
});
