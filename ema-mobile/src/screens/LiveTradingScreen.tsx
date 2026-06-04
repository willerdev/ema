import { useCallback, useEffect, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { accountDisplayBalance, liveTradingService, type LiveTradingAccount } from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LiveTrading'>;

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function LiveTradingScreen() {
  const navigation = useNavigation<Nav>();
  const [accounts, setAccounts] = useState<LiveTradingAccount[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const data = await liveTradingService.listAccounts();
      setAccounts(data.accounts || []);
    } catch (e: any) {
      setError(e?.message || 'Failed to load live trading');
      setAccounts([]);
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
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Live trading</Text>
      <Text style={styles.sub}>Platform accounts with live quotes and open trades.</Text>
      {error ? (
        <Card>
          <Text style={styles.err}>{error}</Text>
        </Card>
      ) : null}
      <PrimaryButton label='Open new account' onPress={() => navigation.navigate('LiveTradingCreateBot')} style={{ marginBottom: 12 }} />
      {accounts.map((a) => (
        <Card key={a.id} style={{ marginBottom: 10 }}>
          <Pressable onPress={() => navigation.navigate('LiveTradingAccount', { accountId: a.id })}>
            <Text style={styles.name}>{a.accountName || a.botType}</Text>
            <Text style={styles.bal}>{fmtUsd(accountDisplayBalance(a))}</Text>
            <Text style={styles.meta}>Min deposit {fmtUsd(a.minDepositUsd)}</Text>
          </Pressable>
        </Card>
      ))}
      {!error && !accounts.length ? (
        <Card>
          <Text style={styles.meta}>No live accounts yet.</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 14 },
  name: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  bal: { color: palette.primary, fontSize: 22, fontWeight: '800', marginTop: 4 },
  meta: { color: palette.textSecondary, fontSize: 13, marginTop: 4 },
  err: { color: '#fbbf24' },
});
