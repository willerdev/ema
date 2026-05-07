import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { walletService } from '../services/walletService';
import { WalletTransaction } from '../types';
import { palette } from '../theme/colors';

const paymentMethods = ['bank_transfer', 'card', 'crypto'];

export function WalletScreen() {
  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('bank_transfer');
  const [referenceId, setReferenceId] = useState(`REF-${Date.now()}`);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  const [resetToken, setResetToken] = useState('');

  const refresh = useCallback(async () => {
    try {
      const data = await walletService.getWallet();
      setBalance(data.balance);
      setTransactions(data.transactions);
      setLastUpdatedAt(Date.now());
    } catch {
      // keep previous values on transient network failure
    }
  }, []);

  usePolling(refresh, 10000, true);
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onDeposit = async () => {
    try {
      await walletService.deposit(Number(amount), method, referenceId);
      refresh();
      Alert.alert('Done', 'Deposit request completed');
    } catch (error: any) {
      Alert.alert('Wallet Error', error.message);
    }
  };

  const onWithdraw = async () => {
    try {
      await walletService.withdraw(Number(amount), method);
      refresh();
      Alert.alert('Done', 'Withdrawal request submitted');
    } catch (error: any) {
      Alert.alert('Wallet Error', error.message);
    }
  };

  const onResetWallet = async () => {
    try {
      await walletService.resetWallet(resetToken);
      setAmount('');
      await refresh();
      Alert.alert('Done', 'Wallet and transaction history reset');
    } catch (error: any) {
      Alert.alert('Reset Error', error.message);
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Card>
        <Text style={styles.label}>Internal Wallet Balance</Text>
        <Text style={styles.balance}>{balance === null ? '--' : `$${balance.toFixed(2)}`}</Text>
        <Text style={styles.item}>{lastUpdatedAt ? `Status: ${Date.now() - lastUpdatedAt > 20000 ? 'stale' : 'live'}` : 'Status: unavailable'}</Text>
      </Card>

      <Card>
        <Text style={styles.label}>Deposit / Withdraw</Text>
        <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder='Amount' placeholderTextColor={palette.textSecondary} keyboardType='numeric' />
        <TextInput style={styles.input} value={referenceId} onChangeText={setReferenceId} placeholder='Reference ID' placeholderTextColor={palette.textSecondary} />
        <View style={styles.row}>
          {paymentMethods.map((m) => (
            <Text key={m} style={[styles.pill, method === m && styles.active]} onPress={() => setMethod(m)}>{m}</Text>
          ))}
        </View>
        <View style={styles.actions}>
          <PrimaryButton label='Deposit' onPress={onDeposit} style={{ flex: 1 }} />
          <View style={{ width: 8 }} />
          <PrimaryButton label='Withdraw' onPress={onWithdraw} variant='danger' style={{ flex: 1 }} />
        </View>
      </Card>

      <Card>
        <Text style={styles.label}>Transaction History</Text>
        {transactions.map((t) => (
          <Text key={t.id} style={styles.item}>{t.type.toUpperCase()} ${Number(t.amount).toFixed(2)} - {t.status} - {new Date(t.created_at).toLocaleDateString()}</Text>
        ))}
        {!transactions.length && <Text style={styles.item}>No transactions yet</Text>}
      </Card>
      <Card>
        <Text style={styles.label}>Developer Wallet Reset</Text>
        <Text style={styles.item}>Resets wallet balance and clears wallet transactions.</Text>
        <TextInput style={styles.input} value={resetToken} onChangeText={setResetToken} placeholder='DEV_RESET_TOKEN' placeholderTextColor={palette.textSecondary} secureTextEntry />
        <PrimaryButton label='Reset Wallet (Dev)' onPress={onResetWallet} variant='danger' disabled={!resetToken} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  balance: { color: palette.textPrimary, fontSize: 34, fontWeight: '800' },
  input: { backgroundColor: palette.surfaceElevated, borderWidth: 1, borderColor: palette.border, color: palette.textPrimary, borderRadius: 12, padding: 10, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  actions: { flexDirection: 'row' },
  pill: { color: palette.textPrimary, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  active: { borderColor: palette.primary, color: palette.primary },
  item: { color: palette.textPrimary, marginBottom: 6 },
});
