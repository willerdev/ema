import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  accountDisplayBalance,
  liveTradingService,
  type LiveTradingAccount,
  type LiveTradingBotType,
} from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LiveTrading'>;

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function botMeta(botType: LiveTradingBotType) {
  if (botType === 'synthetix_ea') {
    return { label: 'Synthetix', icon: 'pulse' as const, tint: '#38BDF8' };
  }
  return { label: 'Quantix', icon: 'flash' as const, tint: '#A78BFA' };
}

export function LiveTradingScreen() {
  const navigation = useNavigation<Nav>();
  const [accounts, setAccounts] = useState<LiveTradingAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await liveTradingService.listAccounts();
      setAccounts(data.accounts || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load live trading');
      setAccounts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const totals = useMemo(() => {
    const balance = accounts.reduce((sum, a) => sum + accountDisplayBalance(a), 0);
    const openPl = accounts.reduce((sum, a) => sum + Number(a.openProfit || 0), 0);
    return { balance, openPl, count: accounts.length };
  }, [accounts]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <LinearGradient colors={['#1A2A44', '#111827', palette.background]} style={styles.hero}>
        <View style={styles.heroTop}>
          <View style={styles.heroIconWrap}>
            <Ionicons name='trending-up' size={22} color={palette.primary} />
          </View>
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live markets</Text>
          </View>
        </View>
        <Text style={styles.title}>Live trading</Text>
        <Text style={styles.sub}>Platform accounts with real-time quotes and open positions.</Text>
        <View style={styles.heroStats}>
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Total equity</Text>
            <Text style={styles.heroStatValue}>{loading ? '—' : fmtUsd(totals.balance)}</Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Open P/L</Text>
            <Text style={[styles.heroStatValue, totals.openPl >= 0 ? styles.plUp : styles.plDown]}>
              {loading ? '—' : (totals.openPl >= 0 ? '+' : '') + fmtUsd(totals.openPl)}
            </Text>
          </View>
          <View style={styles.heroDivider} />
          <View style={styles.heroStat}>
            <Text style={styles.heroStatLabel}>Accounts</Text>
            <Text style={styles.heroStatValue}>{loading ? '—' : String(totals.count)}</Text>
          </View>
        </View>
      </LinearGradient>

      <View style={styles.featureRow}>
        {[
          { icon: 'stats-chart' as const, label: 'Live quotes' },
          { icon: 'swap-horizontal' as const, label: 'Open trades' },
          { icon: 'wallet' as const, label: 'Fund anytime' },
        ].map((f) => (
          <View key={f.label} style={styles.featureChip}>
            <Ionicons name={f.icon} size={14} color={palette.primary} />
            <Text style={styles.featureChipText}>{f.label}</Text>
          </View>
        ))}
      </View>

      {error ? (
        <View style={styles.errorBanner}>
          <Ionicons name='warning-outline' size={18} color='#FBBF24' />
          <Text style={styles.err}>{error}</Text>
        </View>
      ) : null}

      <PrimaryButton
        label='Open new account'
        onPress={() => navigation.navigate('LiveTradingCreateBot')}
        style={styles.cta}
      />

      {loading && !accounts.length ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={palette.primary} />
          <Text style={styles.meta}>Loading accounts…</Text>
        </View>
      ) : null}

      {accounts.map((a) => {
        const meta = botMeta(a.botType);
        const bal = accountDisplayBalance(a);
        const pl = Number(a.openProfit || 0);
        return (
          <Pressable
            key={a.id}
            style={({ pressed }) => [styles.accountCard, pressed && styles.accountCardPressed]}
            onPress={() => navigation.navigate('LiveTradingAccount', { accountId: a.id })}
          >
            <View style={styles.accountTop}>
              <View style={[styles.botBadge, { borderColor: meta.tint + '55', backgroundColor: meta.tint + '18' }]}>
                <Ionicons name={meta.icon} size={14} color={meta.tint} />
                <Text style={[styles.botBadgeText, { color: meta.tint }]}>{meta.label}</Text>
              </View>
              <Ionicons name='chevron-forward' size={18} color={palette.textSecondary} />
            </View>
            <Text style={styles.name}>{a.accountName || meta.label + ' account'}</Text>
            <Text style={styles.login}>Login {a.login}</Text>
            <View style={styles.accountBottom}>
              <View>
                <Text style={styles.balLabel}>Balance</Text>
                <Text style={styles.bal}>{fmtUsd(bal)}</Text>
              </View>
              <View style={styles.accountMetaCol}>
                <Text style={styles.metaLabel}>Open P/L</Text>
                <Text style={[styles.plValue, pl >= 0 ? styles.plUp : styles.plDown]}>
                  {pl >= 0 ? '+' : ''}
                  {fmtUsd(pl)}
                </Text>
              </View>
              <View style={styles.minChip}>
                <Text style={styles.minChipText}>Min {fmtUsd(a.minDepositUsd)}</Text>
              </View>
            </View>
          </Pressable>
        );
      })}

      {!loading && !error && !accounts.length ? (
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <Ionicons name='bar-chart-outline' size={28} color={palette.primary} />
          </View>
          <Text style={styles.emptyTitle}>No live accounts yet</Text>
          <Text style={styles.emptyBody}>Create a platform account to stream quotes, fund from cash, and manage open trades.</Text>
          <PrimaryButton label='Create first account' onPress={() => navigation.navigate('LiveTradingCreateBot')} style={{ marginTop: 14 }} />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { paddingBottom: 28 },
  hero: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
  },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  heroIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.primary + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  title: { color: palette.textPrimary, fontSize: 28, fontWeight: '800', marginBottom: 6 },
  sub: { color: palette.textSecondary, lineHeight: 20, marginBottom: 16 },
  heroStats: {
    flexDirection: 'row',
    backgroundColor: palette.surface + 'CC',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 12,
    paddingHorizontal: 8,
  },
  heroStat: { flex: 1, alignItems: 'center' },
  heroStatLabel: { color: palette.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 4 },
  heroStatValue: { color: palette.textPrimary, fontSize: 15, fontWeight: '800' },
  heroDivider: { width: 1, backgroundColor: palette.border, marginVertical: 2 },
  plUp: { color: palette.success },
  plDown: { color: palette.danger },
  featureRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 16, marginTop: 14, marginBottom: 6 },
  featureChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  featureChipText: { color: palette.textSecondary, fontSize: 12, fontWeight: '600' },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 10,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#FBBF2418',
    borderWidth: 1,
    borderColor: '#FBBF2444',
  },
  err: { color: '#FBBF24', flex: 1, fontSize: 13 },
  cta: { marginHorizontal: 16, marginTop: 12, marginBottom: 14 },
  loadingWrap: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  accountCard: {
    marginHorizontal: 16,
    marginBottom: 12,
    padding: 16,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
  },
  accountCardPressed: { opacity: 0.92, transform: [{ scale: 0.995 }] },
  accountTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  botBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
  },
  botBadgeText: { fontSize: 12, fontWeight: '700' },
  name: { color: palette.textPrimary, fontSize: 18, fontWeight: '800' },
  login: { color: palette.textSecondary, fontSize: 12, marginTop: 2, marginBottom: 12 },
  accountBottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  balLabel: { color: palette.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  bal: { color: palette.primary, fontSize: 22, fontWeight: '800' },
  accountMetaCol: { flex: 1 },
  metaLabel: { color: palette.textSecondary, fontSize: 11, fontWeight: '600', marginBottom: 2 },
  plValue: { fontSize: 15, fontWeight: '800' },
  minChip: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  minChipText: { color: palette.textSecondary, fontSize: 11, fontWeight: '700' },
  meta: { color: palette.textSecondary, fontSize: 13 },
  empty: {
    marginHorizontal: 16,
    marginTop: 8,
    padding: 22,
    borderRadius: 18,
    backgroundColor: palette.surface,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  emptyIcon: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: palette.primary + '18',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  emptyTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 6 },
  emptyBody: { color: palette.textSecondary, textAlign: 'center', lineHeight: 20 },
});
