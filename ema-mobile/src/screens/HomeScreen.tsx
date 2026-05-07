import { useCallback, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Line, Path, Rect } from 'react-native-svg';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import { usePolling } from '../hooks/usePolling';
import { alpacaService } from '../services/alpacaService';
import { useTradingStore } from '../store/useTradingStore';
import { palette } from '../theme/colors';

export function HomeScreen({ navigation }: any) {
  const { user } = useAuth();
  const { account, market, orders, refreshDashboard, refreshTrades, loading, dashboardError } = useTradingStore();
  const [equitySeries, setEquitySeries] = useState<{ x: number; y: number }[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [alpacaConfigured, setAlpacaConfigured] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    await Promise.all([refreshDashboard(), refreshTrades()]);
    try {
      const status = await alpacaService.getStatus();
      setAlpacaConfigured(status.configured);
      const history = await alpacaService.getPortfolioHistory();
      const points = (history.equity || []).slice(-20).map((value, idx) => ({ x: idx + 1, y: Number(value || 0) }));
      setEquitySeries(points);
      setLastUpdatedAt(Date.now());
    } catch {
      setEquitySeries([]);
      setLastUpdatedAt(null);
    }
  }, [refreshDashboard, refreshTrades]);

  usePolling(refresh, 12000, true);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const dailyPL = useMemo(() => {
    if (!account) return 0;
    return Number(account.equity || 0) - Number(account.last_equity || account.equity || 0);
  }, [account]);

  const chartPath = useMemo(() => {
    if (equitySeries.length < 2) return '';
    const values = equitySeries.map((p) => p.y);
    const min = Math.min(...values);
    const max = Math.max(...values);
    const width = 300;
    const height = 120;
    return equitySeries
      .map((point, index) => {
        const x = (index / (equitySeries.length - 1)) * width;
        const normalized = max === min ? 0.5 : (point.y - min) / (max - min);
        const y = height - normalized * height;
        return `${index === 0 ? 'M' : 'L'} ${x} ${y}`;
      })
      .join(' ');
  }, [equitySeries]);

  const formatCurrency = (value?: string | number) => (value === undefined || value === null ? '--' : `$${Number(value).toFixed(2)}`);
  const stale = lastUpdatedAt ? Date.now() - lastUpdatedAt > 30000 : true;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.greeting}>Hello, {user?.email.split('@')[0]}</Text>
          <Text style={styles.sub}>Trading account overview {lastUpdatedAt ? `• ${stale ? 'stale' : 'live'}` : ''}</Text>
        </View>
        <View style={styles.headerIcons}>
          <Ionicons name='notifications-outline' size={22} color={palette.textPrimary} />
          <Ionicons name='person-circle-outline' size={30} color={palette.primary} />
        </View>
      </View>

      <Card>
        <Text style={styles.label}>Total Equity</Text>
        {dashboardError && <Text style={styles.error}>{dashboardError}</Text>}
        {loading && !account ? <View style={styles.skeletonBalance} /> : <Text style={styles.balance}>{formatCurrency(account?.equity)}</Text>}
        <Text style={[styles.pl, { color: dailyPL >= 0 ? palette.success : palette.danger }]}>Daily P/L: {account ? formatCurrency(dailyPL) : '--'}</Text>
        <Text style={styles.stat}>Buying Power: {formatCurrency(account?.buying_power)}</Text>
        <Text style={styles.stat}>Cash: {formatCurrency(account?.cash)}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Portfolio Equity</Text>
        {equitySeries.length > 1 ? (
          <View style={styles.chartWrap}>
            <Svg width='100%' height='120' viewBox='0 0 300 120' preserveAspectRatio='none'>
              <Path d={chartPath} stroke={palette.primary} strokeWidth={3} fill='none' />
            </Svg>
          </View>
        ) : (
          <Text style={styles.sub}>Portfolio data unavailable</Text>
        )}
      </Card>

      <Card>
        <Text style={styles.label}>Market Overview</Text>
        {market.map((item) => {
          const open = Number(item.open ?? item.price);
          const close = Number(item.close ?? item.price);
          const high = Number(item.high ?? Math.max(open, close));
          const low = Number(item.low ?? Math.min(open, close));
          const min = Math.min(low, open, close);
          const max = Math.max(high, open, close);
          const toY = (v: number) => {
            if (max === min) return 16;
            const ratio = (v - min) / (max - min);
            return 28 - ratio * 24;
          };

          return (
            <View key={item.symbol} style={styles.marketRow}>
              <View>
                <Text style={styles.marketSymbol}>{item.symbol}</Text>
                <Text style={styles.marketPrice}>${item.price.toFixed(2)}</Text>
              </View>
              <Svg width={34} height={32}>
                <Line x1={17} y1={toY(high)} x2={17} y2={toY(low)} stroke={palette.textSecondary} strokeWidth={2} />
                <Rect
                  x={11}
                  y={Math.min(toY(open), toY(close))}
                  width={12}
                  height={Math.max(3, Math.abs(toY(open) - toY(close)))}
                  fill={close >= open ? palette.success : palette.danger}
                  rx={2}
                />
              </Svg>
              <Text style={{ color: item.changePercent >= 0 ? palette.success : palette.danger }}>{item.changePercent.toFixed(2)}%</Text>
            </View>
          );
        })}
        {!market.length && !loading && <Text style={styles.sub}>No market data available</Text>}
      </Card>

      <View style={styles.actionRow}>
        <PrimaryButton label='Buy' onPress={() => navigation.navigate('Trades')} variant='success' disabled={!alpacaConfigured} style={{ flex: 1 }} />
        <View style={{ width: 10 }} />
        <PrimaryButton label='Sell' onPress={() => navigation.navigate('Trades')} variant='danger' disabled={!alpacaConfigured} style={{ flex: 1 }} />
      </View>
      <View style={styles.actionRow}>
        <PrimaryButton label='Deposit' onPress={() => navigation.navigate('Wallet')} style={{ flex: 1 }} />
        <View style={{ width: 10 }} />
        <PrimaryButton label='Withdraw' onPress={() => navigation.navigate('Wallet')} style={{ flex: 1 }} />
      </View>

      <Card>
        <Text style={styles.label}>Recent Activity</Text>
        {!alpacaConfigured && <Text style={styles.sub}>Configure Alpaca API keys in Settings to enable trading.</Text>}
        {orders.slice(0, 5).map((order) => (
          <Text key={order.id} style={styles.activityItem}>{order.symbol} {order.side} x{order.qty} ({order.status})</Text>
        ))}
        {!orders.length && <Text style={styles.sub}>No recent orders</Text>}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  headerIcons: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  greeting: { color: palette.textPrimary, fontSize: 24, fontWeight: '700' },
  sub: { color: palette.textSecondary },
  label: { color: palette.textSecondary, marginBottom: 8 },
  balance: { color: palette.textPrimary, fontSize: 32, fontWeight: '800' },
  pl: { fontSize: 16, marginVertical: 6, fontWeight: '600' },
  stat: { color: palette.textPrimary, marginBottom: 4 },
  marketRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  marketSymbol: { color: palette.textPrimary, fontWeight: '700' },
  marketPrice: { color: palette.textPrimary },
  actionRow: { flexDirection: 'row', marginBottom: 10 },
  activityItem: { color: palette.textPrimary, marginBottom: 5 },
  chartWrap: { height: 120, backgroundColor: palette.surfaceElevated, borderRadius: 12, padding: 8 },
  skeletonBalance: { height: 38, width: 190, borderRadius: 10, backgroundColor: palette.surfaceElevated, marginBottom: 8 },
  error: { color: palette.danger, marginBottom: 8 },
});
