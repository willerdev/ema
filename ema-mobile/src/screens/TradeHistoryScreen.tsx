import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { userTradeService, type RecordedTrade } from '../services/userTradeService';
import { palette } from '../theme/colors';

function fmtUsd(n: number) {
  const sign = n >= 0 ? '+' : '';
  return sign + '$' + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function sideLabel(side: string) {
  return side === 'sell' ? 'Sell' : 'Buy';
}

export function TradeHistoryScreen() {
  const [trades, setTrades] = useState<RecordedTrade[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await userTradeService.getHistory(100);
      setTrades(data.trades || []);
    } catch (e: any) {
      const status = (e as { status?: number })?.status;
      if (status === 404 || status === 503) {
        setError(
          'Trade history is not available on the server yet. Deploy the latest backend (user trades API) and try again.'
        );
      } else {
        setError(e?.message || 'Failed to load trade history');
      }
      setTrades([]);
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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Trade history</Text>
      <Text style={styles.sub}>Closed trades recorded on your account.</Text>

      {error ? (
        <Card>
          <Text style={styles.err}>{error}</Text>
        </Card>
      ) : null}

      {!error && trades.length === 0 ? (
        <Card>
          <Text style={styles.meta}>No trades recorded yet.</Text>
        </Card>
      ) : null}

      {trades.map((t) => {
        const profit = Number(t.profitUsd);
        const profitColor = profit >= 0 ? palette.success : palette.danger;
        return (
          <Card key={t.id} style={styles.rowCard}>
            <View style={styles.rowTop}>
              <Text style={styles.symbol}>{t.symbol}</Text>
              <Text style={[styles.profit, { color: profitColor }]}>{fmtUsd(profit)}</Text>
            </View>
            <Text style={styles.meta}>
              {sideLabel(t.side)} · Vol {Number(t.volume).toFixed(2)}
              {t.openPrice != null ? ` · Open ${t.openPrice}` : ''}
              {t.closePrice != null ? ` · Close ${t.closePrice}` : ''}
            </Text>
            <Text style={styles.meta}>{new Date(t.tradedAt).toLocaleString()}</Text>
            {t.notes ? <Text style={styles.notes}>{t.notes}</Text> : null}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 14, lineHeight: 18 },
  rowCard: { marginBottom: 10 },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  symbol: { color: palette.textPrimary, fontSize: 18, fontWeight: '700' },
  profit: { fontSize: 17, fontWeight: '800' },
  meta: { color: palette.textSecondary, fontSize: 13, marginTop: 2 },
  notes: { color: palette.textSecondary, fontSize: 12, marginTop: 8, fontStyle: 'italic' },
  err: { color: '#fbbf24' },
});
