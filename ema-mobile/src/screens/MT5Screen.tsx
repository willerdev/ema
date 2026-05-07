import { useCallback, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { mt5Service } from '../services/mt5Service';
import { Mt5AccountConfig, Mt5Balance, Mt5Position } from '../types';
import { palette } from '../theme/colors';

export function MT5Screen() {
  const insets = useSafeAreaInsets();
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
  const [detailOpen, setDetailOpen] = useState(false);
  const [positions, setPositions] = useState<Mt5Position[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
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
      const selected = rows.find((a) => a.id === nextSelected);
      if (selected) {
        setBalance({
          isLive: false,
          balance: Number(selected.cachedBalance ?? 0),
          equity: Number(selected.cachedEquity ?? selected.cachedBalance ?? 0),
          currency: selected.cachedCurrency || 'USD',
          login: selected.login,
          server: selected.server,
          accountName: selected.accountName,
          updatedAt: selected.balanceLastUpdatedAt || undefined,
        });
        setStatus(selected.balanceLastUpdatedAt ? `Last updated ${new Date(selected.balanceLastUpdatedAt).toLocaleString()}` : 'Balance not fetched yet');
      }
    } catch (error: any) {
      const message = String(error?.message || 'Unable to fetch MT5 data');
      if (message.includes('Server returned HTML (404)')) {
        setStatus('MT5 backend routes are not deployed yet. Deploy latest backend to Render.');
        return;
      }
      setStatus(message);
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

  const openAccountDetails = async (id: string) => {
    setSelectedAccountId(id);
    setDetailOpen(true);
    setDetailLoading(true);
    try {
      const [balanceData, openPositions] = await Promise.all([
        mt5Service.getBalance(id),
        mt5Service.getPositions(id),
      ]);
      setBalance(balanceData);
      setPositions(openPositions.positions || []);
      setStatus(balanceData.updatedAt ? `Last updated ${new Date(balanceData.updatedAt).toLocaleString()}` : 'Balance not fetched yet');
    } catch (error: any) {
      setStatus(String(error?.message || 'Unable to load MT5 account details'));
    } finally {
      setDetailLoading(false);
    }
  };

  const onRefreshLive = async () => {
    if (!selectedAccountId) return;
    try {
      setDetailLoading(true);
      const [liveBalance, openPositions] = await Promise.all([
        mt5Service.refreshBalance(selectedAccountId),
        mt5Service.getPositions(selectedAccountId),
      ]);
      setBalance(liveBalance);
      setPositions(openPositions.positions || []);
      setStatus(`Live now • ${new Date().toLocaleTimeString()}`);
      await refresh();
    } catch (error: any) {
      Alert.alert('MT5 Error', String(error?.message || 'Failed to refresh live balance'));
    } finally {
      setDetailLoading(false);
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
              <Pressable key={account.id} style={[styles.accountRow, selected && styles.accountRowActive]} onPress={() => openAccountDetails(account.id || '')}>
                <Text style={styles.accountTitle}>{account.accountName || account.login}</Text>
                <Text style={styles.item}>{account.server}</Text>
              </Pressable>
            );
          })}
        </Card>

        {accounts.length > 0 && (
          <Card>
            <Text style={styles.label}>Auto Balance Sync</Text>
            <Text style={styles.item}>Status: Connected</Text>
            <Text style={styles.item}>{status}</Text>
            <Text style={styles.balance}>{balance ? `${balance.currency} ${balance.balance.toFixed(2)}` : '--'}</Text>
            <Text style={styles.item}>Equity: {balance ? `${balance.currency} ${balance.equity.toFixed(2)}` : '--'}</Text>
            <Text style={styles.item}>Server: {balance?.server || '--'}</Text>
          </Card>
        )}
      </ScrollView>

      <Pressable style={styles.fab} onPress={() => setAddOpen(true)}>
        <Ionicons name='add' size={28} color={palette.background} />
      </Pressable>

      <Modal visible={addOpen} transparent animationType='slide'>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.modalBackdrop}>
          <Pressable style={StyleSheet.absoluteFillObject} onPress={() => setAddOpen(false)} />
          <View style={[styles.modalContent, { paddingBottom: Math.max(16, insets.bottom + 10) }]}>
            <ScrollView keyboardShouldPersistTaps='handled' contentContainerStyle={{ paddingBottom: 4 }}>
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
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={detailOpen} animationType='slide'>
        <View style={styles.detailContainer}>
          <View style={styles.detailHeader}>
            <Pressable onPress={() => setDetailOpen(false)}>
              <Ionicons name='arrow-back' size={24} color={palette.textPrimary} />
            </Pressable>
            <Text style={styles.detailTitle}>MT5 Account Details</Text>
            <View style={{ width: 24 }} />
          </View>
          <ScrollView contentContainerStyle={{ padding: 16 }}>
            <Card>
              <Text style={styles.label}>Balance Snapshot</Text>
              <Text style={styles.balance}>{balance ? `${balance.currency} ${balance.balance.toFixed(2)}` : '--'}</Text>
              <Text style={styles.item}>Equity: {balance ? `${balance.currency} ${balance.equity.toFixed(2)}` : '--'}</Text>
              <Text style={styles.item}>Server: {balance?.server || '--'}</Text>
              <Text style={styles.item}>
                {balance?.isLive
                  ? 'Status: live'
                  : `Status: cached${balance?.updatedAt ? ` • ${new Date(balance.updatedAt).toLocaleString()}` : ''}`}
              </Text>
              <PrimaryButton
                label={detailLoading ? 'Refreshing...' : 'Refresh Live Balance'}
                onPress={onRefreshLive}
                disabled={detailLoading}
              />
            </Card>
            <Card>
              <Text style={styles.label}>Running Trades</Text>
              {!positions.length && <Text style={styles.item}>No open positions</Text>}
              {positions.map((p, idx) => (
                <View key={p.id || `${p.symbol}-${idx}`} style={styles.positionRow}>
                  <View>
                    <Text style={styles.accountTitle}>{p.symbol || 'Unknown'}</Text>
                    <Text style={styles.item}>{String(p.type || '')} • Vol {Number(p.volume || 0).toFixed(2)}</Text>
                  </View>
                  <Text style={{ color: Number(p.profit || 0) >= 0 ? palette.success : palette.danger }}>
                    {Number(p.profit || 0).toFixed(2)}
                  </Text>
                </View>
              ))}
            </Card>
          </ScrollView>
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
  detailContainer: { flex: 1, backgroundColor: palette.background },
  detailHeader: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  detailTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '700' },
  positionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
});
