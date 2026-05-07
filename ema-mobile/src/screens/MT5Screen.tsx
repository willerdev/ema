import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { mt5Service } from '../services/mt5Service';
import { Mt5AccountConfig, Mt5Balance } from '../types';
import { palette } from '../theme/colors';

export function MT5Screen() {
  const [accounts, setAccounts] = useState<Mt5AccountConfig[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [accountName, setAccountName] = useState('');
  const [balance, setBalance] = useState<Mt5Balance | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [status, setStatus] = useState('Connect your MT5 account to fetch balance automatically.');

  const refresh = useCallback(async () => {
    try {
      const list = await mt5Service.listAccounts();
      const rows = list.accounts || [];
      setAccounts(rows);
      if (!rows.length) {
        setSelectedAccountId('');
        setBalance(null);
        setStatus('No MT5 accounts connected yet.');
        return;
      }

      const nextSelected = rows.find((a) => a.id === selectedAccountId)?.id || rows[0].id || '';
      setSelectedAccountId(nextSelected);

      if (nextSelected) {
        const balanceData = await mt5Service.getBalance(nextSelected);
        setBalance(balanceData);
        setStatus(`Live sync ${new Date().toLocaleTimeString()}`);
      }
    } catch (error: any) {
      setStatus(error?.message || 'Unable to fetch MT5 data');
    }
  }, [selectedAccountId]);

  usePolling(refresh, 15000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onSave = async () => {
    if (!login || !password || !server) {
      Alert.alert('Validation', 'MT5 login, password and server are required.');
      return;
    }
    try {
      setLoading(true);
      await mt5Service.saveAccount({ login, password, server, accountName });
      setAddOpen(false);
      setLogin('');
      setPassword('');
      setServer('');
      setAccountName('');
      await refresh();
      Alert.alert('Saved', 'MT5 account linked and balance sync started.');
    } catch (error: any) {
      Alert.alert('MT5 Error', error?.message || 'Failed to save MT5 account');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <Card>
          <Text style={styles.label}>Connected MT5 Accounts</Text>
          {!accounts.length && <Text style={styles.item}>No MT5 accounts connected yet.</Text>}
          {accounts.map((account) => {
            const selected = account.id === selectedAccountId;
            return (
              <Pressable key={account.id} style={[styles.accountRow, selected && styles.accountRowActive]} onPress={() => setSelectedAccountId(account.id || '')}>
                <Text style={styles.accountTitle}>{account.accountName || account.login}</Text>
                <Text style={styles.item}>{account.server}</Text>
              </Pressable>
            );
          })}
        </Card>

        <Card>
          <Text style={styles.label}>Auto Balance Sync</Text>
          <Text style={styles.item}>Status: {accounts.length ? 'Connected' : 'Not connected'}</Text>
          <Text style={styles.item}>{status}</Text>
          <Text style={styles.balance}>{balance ? `${balance.currency} ${balance.balance.toFixed(2)}` : '--'}</Text>
          <Text style={styles.item}>Equity: {balance ? `${balance.currency} ${balance.equity.toFixed(2)}` : '--'}</Text>
          <Text style={styles.item}>Server: {balance?.server || '--'}</Text>
        </Card>
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}>
        <Ionicons name='add' size={28} color={palette.background} />
      </Pressable>

      <Modal visible={addOpen} transparent animationType='slide'>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalContent}>
            <Text style={styles.label}>Add MT5 Account</Text>
            <TextInput style={styles.input} value={login} onChangeText={setLogin} placeholder='MT5 Login ID' placeholderTextColor={palette.textSecondary} />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder='MT5 Password' secureTextEntry placeholderTextColor={palette.textSecondary} />
            <TextInput style={styles.input} value={server} onChangeText={setServer} placeholder='Broker Server (e.g. Broker-Demo)' placeholderTextColor={palette.textSecondary} />
            <TextInput style={styles.input} value={accountName} onChangeText={setAccountName} placeholder='Account Name (optional)' placeholderTextColor={palette.textSecondary} />
            <View style={styles.modalRow}>
              <PrimaryButton label={loading ? 'Saving...' : 'Save MT5 Account'} onPress={onSave} disabled={loading} style={{ flex: 1 }} />
              <View style={{ width: 8 }} />
              <PrimaryButton label='Cancel' onPress={() => setAddOpen(false)} variant='danger' style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  item: { color: palette.textPrimary, marginBottom: 6 },
  balance: { color: palette.textPrimary, fontSize: 32, fontWeight: '800', marginVertical: 8 },
  accountRow: { borderWidth: 1, borderColor: palette.border, borderRadius: 12, padding: 10, marginBottom: 8, backgroundColor: palette.surfaceElevated },
  accountRowActive: { borderColor: palette.primary },
  accountTitle: { color: palette.textPrimary, fontWeight: '700', marginBottom: 3 },
  fab: {
    position: 'absolute',
    right: 18,
    bottom: 22,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: palette.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  modalContent: { backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  modalRow: { flexDirection: 'row' },
});
