import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { RouteProp, useRoute } from '@react-navigation/native';
import { QuoteRow } from '../components/QuoteRow';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  accountDisplayBalance,
  liveTradingService,
  type LivePosition,
  type LivePrice,
  type LiveTradingAccount,
  type LiveTradingBotType,
} from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Tab = 'quotes' | 'trades';

type R = RouteProp<RootStackParamList, 'LiveTradingAccount'>;

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function botLabel(botType?: LiveTradingBotType) {
  if (botType === 'synthetix_ea') return 'Synthetix program';
  if (botType === 'quantix_ea') return 'Quantix program';
  return 'Live account';
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
  const [refreshing, setRefreshing] = useState(false);

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

  const refreshAll = useCallback(async () => {
    await Promise.all([loadSummary(), tab === 'quotes' ? loadQuotes() : loadTrades()]);
  }, [loadSummary, loadQuotes, loadTrades, tab]);

  useEffect(() => {
    void loadSummary();
    const id = setInterval(() => void loadSummary(), 1000);
    return () => clearInterval(id);
  }, [loadSummary]);

  useEffect(() => {
    if (tab === 'quotes') void loadQuotes();
    else void loadTrades();
  }, [tab, loadQuotes, loadTrades]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refreshAll();
    setRefreshing(false);
  }, [refreshAll]);

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

  const balance = summary ? accountDisplayBalance(summary) : null;
  const deposited = summary ? Number(summary.depositedBalance) : null;
  const openPl = summary ? Number(summary.openProfit || 0) : 0;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <LinearGradient colors={['#1A2A44', '#111827']} style={styles.hero}>
          <View style={styles.heroHeader}>
            <View>
              <Text style={styles.heroEyebrow}>{summary ? botLabel(summary.botType) : 'Live account'}</Text>
              <Text style={styles.heroName}>{summary?.accountName || 'Trading account'}</Text>
              {summary?.login ? <Text style={styles.heroLogin}>Login {summary.login}</Text> : null}
            </View>
            {summary?.snapshotFresh ? (
              <View style={styles.livePill}>
                <View style={styles.liveDot} />
                <Text style={styles.liveText}>Live</Text>
              </View>
            ) : null}
          </View>

          <Text style={styles.balance}>{balance != null ? fmtUsd(balance) : '—'}</Text>
          <Text style={styles.balanceLabel}>Total equity</Text>

          <View style={styles.statRow}>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Deposited</Text>
              <Text style={styles.statValue}>{deposited != null ? fmtUsd(deposited) : '—'}</Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Open P/L</Text>
              <Text style={[styles.statValue, openPl >= 0 ? styles.plUp : styles.plDown]}>
                {summary ? (openPl >= 0 ? '+' : '') + fmtUsd(openPl) : '—'}
              </Text>
            </View>
            <View style={styles.statBox}>
              <Text style={styles.statLabel}>Min fund</Text>
              <Text style={styles.statValue}>{summary ? fmtUsd(summary.minDepositUsd) : '—'}</Text>
            </View>
          </View>
        </LinearGradient>

        <View style={styles.fundCard}>
          <View style={styles.sectionHeader}>
            <Ionicons name='add-circle-outline' size={18} color={palette.primary} />
            <Text style={styles.sectionTitle}>Add funds from cash</Text>
          </View>
          <View style={styles.fundRow}>
            <TextInput
              style={styles.input}
              value={fundAmount}
              onChangeText={setFundAmount}
              placeholder={summary ? `Min ${summary.minDepositUsd}` : 'Amount'}
              placeholderTextColor={palette.textSecondary}
              keyboardType='numeric'
            />
            <PrimaryButton compact label='Fund' onPress={() => void onFund()} />
          </View>
        </View>

        <View style={styles.tabBar}>
          {(['quotes', 'trades'] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <Pressable key={t} style={[styles.tab, active && styles.tabOn]} onPress={() => setTab(t)}>
                <Ionicons
                  name={t === 'quotes' ? 'stats-chart' : 'swap-horizontal'}
                  size={16}
                  color={active ? palette.background : palette.textSecondary}
                />
                <Text style={[styles.tabText, active && styles.tabTextOn]}>{t === 'quotes' ? 'Quotes' : 'Trades'}</Text>
              </Pressable>
            );
          })}
        </View>

        {tab === 'quotes' ? (
          <View style={styles.panel}>
            <View style={styles.tableHeader}>
              <Text style={[styles.tableHead, { flex: 1 }]}>Symbol</Text>
              <Text style={styles.tableHead}>Bid</Text>
              <Text style={styles.tableHead}>Ask</Text>
            </View>
            {prices.map((p, i) => (
              <View key={p.symbol} style={i === prices.length - 1 ? styles.quoteRowLast : undefined}>
                <QuoteRow price={p} />
              </View>
            ))}
            {!prices.length ? (
              <View style={styles.emptyPanel}>
                <Ionicons name='pulse-outline' size={22} color={palette.textSecondary} />
                <Text style={styles.meta}>No quotes yet.</Text>
              </View>
            ) : null}
          </View>
        ) : (
          <View style={styles.panel}>
            {error ? (
              <View style={styles.errorInline}>
                <Ionicons name='warning-outline' size={16} color='#FBBF24' />
                <Text style={styles.err}>{error}</Text>
              </View>
            ) : null}
            {positions.map((p) => {
              const isBuy = String(p.side).toLowerCase().includes('buy');
              return (
                <View key={p.id} style={styles.tradeCard}>
                  <View style={styles.tradeTop}>
                    <View>
                      <Text style={styles.tradeSym}>{p.symbol}</Text>
                      <View style={styles.tradeMetaRow}>
                        <View style={[styles.sideBadge, isBuy ? styles.sideBuy : styles.sideSell]}>
                          <Text style={styles.sideBadgeText}>{p.side}</Text>
                        </View>
                        <Text style={styles.meta}>
                          {p.volume.toFixed(2)} lots @ {p.openPrice.toFixed(5)}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.tradePl, p.profit >= 0 ? styles.plUp : styles.plDown]}>
                      {p.profit >= 0 ? '+' : ''}
                      {p.profit.toFixed(2)}
                    </Text>
                  </View>
                  <PrimaryButton compact label='Close position' variant='danger' onPress={() => onClose(p)} style={styles.closeBtn} />
                </View>
              );
            })}
            {!positions.length && !error ? (
              <View style={styles.emptyPanel}>
                <Ionicons name='file-tray-outline' size={22} color={palette.textSecondary} />
                <Text style={styles.meta}>No open trades right now.</Text>
              </View>
            ) : null}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { paddingBottom: 28 },
  hero: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 18,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 },
  heroEyebrow: { color: palette.primary, fontSize: 12, fontWeight: '700', marginBottom: 4 },
  heroName: { color: palette.textPrimary, fontSize: 20, fontWeight: '800' },
  heroLogin: { color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  livePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: palette.success },
  liveText: { color: palette.textSecondary, fontSize: 12, fontWeight: '700' },
  balance: { color: palette.textPrimary, fontSize: 36, fontWeight: '800', textAlign: 'center' },
  balanceLabel: { color: palette.textSecondary, textAlign: 'center', marginBottom: 14, fontSize: 13 },
  statRow: { flexDirection: 'row', gap: 8 },
  statBox: {
    flex: 1,
    backgroundColor: palette.surface + 'AA',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 10,
    paddingHorizontal: 8,
    alignItems: 'center',
  },
  statLabel: { color: palette.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  statValue: { color: palette.textPrimary, fontSize: 13, fontWeight: '800' },
  plUp: { color: palette.success },
  plDown: { color: palette.danger },
  fundCard: {
    marginHorizontal: 16,
    marginTop: 14,
    padding: 14,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sectionTitle: { color: palette.textPrimary, fontSize: 15, fontWeight: '700' },
  fundRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: {
    flex: 1,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 11,
    fontSize: 15,
  },
  tabBar: {
    flexDirection: 'row',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 14,
    marginBottom: 10,
    padding: 4,
    borderRadius: 14,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  tab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabOn: { backgroundColor: palette.primary },
  tabText: { color: palette.textSecondary, fontWeight: '700', fontSize: 14 },
  tabTextOn: { color: palette.background },
  panel: {
    marginHorizontal: 16,
    borderRadius: 16,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingBottom: 4,
  },
  tableHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 4,
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  tableHead: { width: 88, textAlign: 'right', color: palette.textSecondary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  quoteRowLast: { marginBottom: 4 },
  tradeCard: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  tradeTop: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginBottom: 10 },
  tradeSym: { color: palette.textPrimary, fontWeight: '800', fontSize: 16, marginBottom: 6 },
  tradeMetaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  sideBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  sideBuy: { backgroundColor: palette.success + '22' },
  sideSell: { backgroundColor: palette.danger + '22' },
  sideBadgeText: { color: palette.textPrimary, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  tradePl: { fontSize: 18, fontWeight: '800' },
  closeBtn: { alignSelf: 'flex-start' },
  meta: { color: palette.textSecondary, fontSize: 13 },
  emptyPanel: { alignItems: 'center', justifyContent: 'center', paddingVertical: 28, gap: 8 },
  errorInline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  err: { color: '#FBBF24', flex: 1, fontSize: 13 },
});
