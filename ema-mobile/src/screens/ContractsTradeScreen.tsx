import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { contractsService, type ContractsSummary } from '../services/contractsService';
import { palette } from '../theme/colors';

export function ContractsTradeScreen() {
  const [summary, setSummary] = useState<ContractsSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const glow = useSharedValue(1);

  useEffect(() => {
    glow.value = withRepeat(withSequence(withTiming(1.03, { duration: 700 }), withTiming(1, { duration: 700 })), -1, true);
  }, [glow]);

  const balanceStyle = useAnimatedStyle(() => ({
    transform: [{ scale: glow.value }],
  }));

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await contractsService.getSummary();
      setSummary(s);
    } catch (e: any) {
      setError(e?.message || 'Failed to load contracts');
      setSummary(null);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  const onDeposit = async () => {
    try {
      const n = Number(amount);
      if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
      const s = await contractsService.deposit(n);
      setSummary(s);
      setAmount('');
    } catch (e: any) {
      Alert.alert('Contracts', e?.message || 'Deposit failed');
    }
  };

  const onWithdraw = async () => {
    try {
      const n = Number(amount);
      if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
      const s = await contractsService.withdraw(n);
      setSummary(s);
      setAmount('');
    } catch (e: any) {
      Alert.alert('Contracts', e?.message || 'Withdraw failed');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Contracts</Text>

      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <PrimaryButton label='Retry' onPress={() => void load()} />
        </Card>
      ) : null}

      {summary ? (
        <>
          <Animated.View style={balanceStyle}>
            <Card>
              <Text style={styles.label}>Contract balance</Text>
              <Text style={styles.big}>{summary.contractBalance.toFixed(8)}</Text>
              <Text style={styles.meta}>Cash wallet (internal): ${summary.cashWallet.toFixed(2)}</Text>
            </Card>
          </Animated.View>

          <Card>
            <Text style={styles.label}>Move funds</Text>
            <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder='Amount' placeholderTextColor={palette.textSecondary} keyboardType='numeric' />
            <View style={styles.row}>
              <PrimaryButton label='Deposit' onPress={() => void onDeposit()} style={{ flex: 1 }} />
              <View style={{ width: 8 }} />
              <PrimaryButton label='Withdraw' onPress={() => void onWithdraw()} variant='danger' style={{ flex: 1 }} />
            </View>
          </Card>
        </>
      ) : !error ? (
        <Card>
          <Text style={styles.meta}>Loading…</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  label: { color: palette.textSecondary, marginBottom: 8 },
  big: { color: palette.primary, fontSize: 30, fontWeight: '800' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  input: { backgroundColor: palette.surfaceElevated, borderWidth: 1, borderColor: palette.border, color: palette.textPrimary, borderRadius: 12, padding: 10, marginBottom: 8 },
  row: { flexDirection: 'row' },
  error: { color: palette.danger, marginBottom: 8 },
});
