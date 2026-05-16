import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { ActivityListSkeleton, BalanceSkeleton } from '../components/Skeleton';
import { WalletActivityList } from '../components/WalletActivityList';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { useTransactionFeed } from '../hooks/useTransactionFeed';
import { useTradingStore } from '../store/useTradingStore';
import { palette } from '../theme/colors';
import { navigateToTransactionDetail, navigateToTransactionHistory } from '../utils/navigationHelpers';
import { filterActivityToday } from '../utils/walletActivity';

const HOME_NOTICE_DISMISS_KEY = 'ema_home_notice_dismissed_v2';

export function HomeScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { account, refreshDashboard, loading, dashboardError } = useTradingStore();
  const { npSummary, rows, loading: feedLoading, error: cryptoError, refresh: refreshFeed } = useTransactionFeed();
  const [refreshing, setRefreshing] = useState(false);
  const [noticeVisible, setNoticeVisible] = useState(true);

  useEffect(() => {
    void AsyncStorage.getItem(HOME_NOTICE_DISMISS_KEY).then((v) => {
      setNoticeVisible(v !== '1');
    });
  }, []);

  const dismissNotice = () => {
    setNoticeVisible(false);
    void AsyncStorage.setItem(HOME_NOTICE_DISMISS_KEY, '1');
  };

  const refresh = useCallback(async () => {
    await Promise.all([refreshFeed(), refreshDashboard()]);
  }, [refreshFeed, refreshDashboard]);

  usePolling(refresh, 60000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const recentActivity = useMemo(() => filterActivityToday(rows, 5), [rows]);
  const balancesLoading = feedLoading && !npSummary && !cryptoError;

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

      {noticeVisible ? (
        <Card style={styles.disclaimerCard}>
          <View style={styles.disclaimerHeader}>
            <Text style={styles.disclaimerTitle}>Important notice</Text>
            <Pressable onPress={dismissNotice} hitSlop={12} accessibilityLabel='Dismiss notice'>
              <Ionicons name='close-circle' size={22} color={palette.textSecondary} />
            </Pressable>
          </View>
          <Text style={styles.disclaimerText}>
            Withdrawals may be denied if anti-money laundering (AML) concerns are detected, if the withdrawal address is not
            on your whitelist, or if your account is flagged by a government or other authority with the legal power to do so.
          </Text>
          <Text style={styles.disclaimerText}>
            Deposits below $100 may not be credited and those funds can be lost. Always verify minimum amounts before sending.
          </Text>
          <Text style={styles.disclaimerText}>
            You can lose funds through market moves, failed transfers, or policy enforcement. If a sudden change in withdrawal
            pattern is detected — for example a single withdrawal more than double your last two withdrawals — your account may
            be flagged for possible theft and withdrawals paused while we review. Enable two-factor authentication in Settings
            to protect your account.
          </Text>
          <Text style={[styles.disclaimerText, { marginBottom: 0 }]}>
            We will never hold your assets unless you violate these terms. Ema will never call or text you asking you to move
            funds, share passwords, or approve actions outside this app. Do not follow instructions from phone calls or SMS —
            they are scams.
          </Text>
        </Card>
      ) : null}

      {balancesLoading ? (
        <BalanceSkeleton />
      ) : (
        <Card style={styles.cryptoHero}>
          <Text style={styles.cryptoHeroLabel}>Crypto wallet</Text>
          {cryptoError ? <Text style={styles.warn}>{cryptoError}</Text> : null}
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
            <Text style={styles.meta}>Deposits are temporarily unavailable. Please try again later.</Text>
          ) : null}
        </Card>
      )}

      {feedLoading && !rows.length ? (
        <ActivityListSkeleton rows={5} />
      ) : (
        <Card style={styles.activityCard}>
          <View style={styles.activityHeader}>
            <Text style={styles.section}>Today&apos;s transactions</Text>
            {rows.length > 5 ? (
              <Pressable onPress={() => navigateToTransactionHistory(navigation)}>
                <Text style={styles.moreLink}>More</Text>
              </Pressable>
            ) : null}
          </View>
          <WalletActivityList
            rows={recentActivity}
            variant='compact'
            emptyMessage='No transactions today.'
            onPressRow={(row) => navigateToTransactionDetail(navigation, row)}
          />
          {rows.length > 0 && recentActivity.length === 0 ? (
            <PrimaryButton
              label='View all history'
              onPress={() => navigateToTransactionHistory(navigation)}
              style={{ marginTop: 12 }}
            />
          ) : null}
        </Card>
      )}

      {showAlpaca ? (
        <View style={styles.alpacaFootnoteWrap}>
          {dashboardError ? <Text style={styles.alpacaFootnote}>{dashboardError}</Text> : null}
          {loading && !account && !dashboardError ? <Text style={styles.alpacaFootnote}>Broker sync…</Text> : null}
          {alpacaEquity || alpacaCash ? (
            <Text style={styles.alpacaFootnote}>
              Linked broker{alpacaEquity ? ` · equity ${alpacaEquity}` : ''}
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
  disclaimerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  disclaimerTitle: { color: '#fbbf24', fontSize: 15, fontWeight: '700', flex: 1 },
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
  activityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 },
  moreLink: { color: palette.primary, fontSize: 14, fontWeight: '700' },
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
