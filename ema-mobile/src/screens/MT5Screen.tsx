import { useCallback, useEffect, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
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
import { useToast } from '../hooks/useToast';
import { mt5Service } from '../services/mt5Service';
import { Mt5AccountConfig, Mt5Balance, Mt5HistoryDeal, Mt5Position } from '../types';
import { palette } from '../theme/colors';
import { isMt5LivePaused, setMt5LivePaused } from '../utils/mt5LiveSession';
import { withTimeout } from '../utils/withTimeout';

type Mt5Panel = 'balance' | 'positions' | 'history';

function formatTime(iso: string | null | undefined) {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return String(iso);
  return new Date(ms).toLocaleString();
}

function sideLabel(type: string | undefined) {
  const t = String(type || '').toLowerCase();
  if (t.includes('buy') || t === '0') return 'Buy';
  if (t.includes('sell') || t === '1') return 'Sell';
  return type || '—';
}

export function MT5Screen() {
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();

  const [accounts, setAccounts] = useState<Mt5AccountConfig[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [panel, setPanel] = useState<Mt5Panel>('balance');
  const [fabOpen, setFabOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [server, setServer] = useState('');
  const [accountName, setAccountName] = useState('');

  const [balance, setBalance] = useState<Mt5Balance | null>(null);
  const [positions, setPositions] = useState<Mt5Position[]>([]);
  const [history, setHistory] = useState<Mt5HistoryDeal[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [closingId, setClosingId] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [liveConnected, setLiveConnected] = useState(false);
  const [status, setStatus] = useState('Save your MT5 details, then connect live when you are ready.');

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId);

  const loadAccounts = useCallback(async () => {
    const list = await withTimeout(mt5Service.listAccounts(), 8000, 'MT5 accounts');
    const rows = list.accounts || [];
    setAccounts(rows);
    if (!rows.length) {
      setSelectedAccountId('');
      return;
    }
    setSelectedAccountId((prev) => (rows.some((a) => a.id === prev) ? prev : rows[0].id || ''));
  }, []);

  const loadCachedBalance = useCallback(async (accountId: string) => {
    const snap = await mt5Service.getBalance(accountId);
    setBalance({
      ...snap,
      isLive: false,
    });
    const updated = snap.updatedAt ? `Saved · ${formatTime(snap.updatedAt)}` : 'Saved — connect live to sync';
    setStatus(updated);
    return snap;
  }, []);

  const loadLiveBalance = useCallback(async (accountId: string) => {
    const live = await withTimeout(mt5Service.refreshBalance(accountId), 45000, 'MT5 live sync');
    setBalance(live);
    setStatus(`Live · ${new Date().toLocaleTimeString()}`);
    return live;
  }, []);

  const loadPositions = useCallback(async (accountId: string) => {
    const res = await mt5Service.getPositions(accountId);
    setPositions(res.positions || []);
  }, []);

  const loadHistory = useCallback(async (accountId: string) => {
    const res = await mt5Service.getHistory(accountId, 30);
    setHistory(res.deals || []);
  }, []);

  const refreshPanel = useCallback(
    async (accountId: string, target: Mt5Panel, live: boolean) => {
      if (!accountId) return;
      if (!live) {
        if (target === 'balance') await loadCachedBalance(accountId);
        else setStatus('Connect live to load positions and history.');
        return;
      }
      if (target === 'balance') await loadLiveBalance(accountId);
      else if (target === 'positions') await loadPositions(accountId);
      else await loadHistory(accountId);
    },
    [loadCachedBalance, loadLiveBalance, loadPositions, loadHistory]
  );

  const refreshAll = useCallback(async () => {
    if (addOpen || fabOpen) return;
    try {
      await loadAccounts();
    } catch (error: any) {
      setStatus(String(error?.message || 'Unable to load MT5 accounts'));
    }
  }, [addOpen, fabOpen, loadAccounts]);

  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const paused = await isMt5LivePaused();
        setLiveConnected(!paused);
        await refreshAll();
      })();
    }, [refreshAll])
  );

  useEffect(() => {
    if (!selectedAccountId) return;
    setLoading(true);
    void refreshPanel(selectedAccountId, panel, liveConnected)
      .catch((error: any) => setStatus(String(error?.message || 'Failed to load MT5 data')))
      .finally(() => setLoading(false));
  }, [selectedAccountId, liveConnected]);

  const onPullRefresh = useCallback(async () => {
    if (!selectedAccountId) {
      setRefreshing(true);
      await refreshAll();
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    try {
      await refreshPanel(selectedAccountId, panel, liveConnected);
    } catch (error: any) {
      Alert.alert('MT5', String(error?.message || 'Refresh failed'));
    } finally {
      setRefreshing(false);
    }
  }, [selectedAccountId, panel, liveConnected, refreshPanel, refreshAll]);

  const selectPanel = async (next: Mt5Panel) => {
    setPanel(next);
    setFabOpen(false);
    if (!selectedAccountId) {
      Alert.alert('MT5', 'Connect an account first.');
      return;
    }
    setLoading(true);
    try {
      await refreshPanel(selectedAccountId, next, liveConnected);
    } catch (error: any) {
      Alert.alert('MT5', String(error?.message || 'Failed to load data'));
    } finally {
      setLoading(false);
    }
  };

  const onRemoveAccount = (account: Mt5AccountConfig) => {
    if (!account.id) return;
    const label = account.accountName || account.login || 'this account';
    Alert.alert(
      'Remove MT5 connection',
      `Remove ${label} from Airfarms? Saved credentials and cached balance will be deleted. This does not close your broker account.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setRemovingId(account.id!);
              try {
                const res = await mt5Service.deleteAccount(account.id!);
                const rows = res.accounts || [];
                setAccounts(rows);
                if (account.id === selectedAccountId) {
                  await setMt5LivePaused(true);
                  setLiveConnected(false);
                  setBalance(null);
                  setPositions([]);
                  setHistory([]);
                  setSelectedAccountId(rows[0]?.id || '');
                  setStatus(
                    rows.length
                      ? 'Connection removed. Select another account or connect live.'
                      : 'No MT5 account linked. Use + to connect.'
                  );
                }
                showToast('MT5 connection removed');
              } catch (error: any) {
                Alert.alert('MT5', String(error?.message || 'Failed to remove connection'));
              } finally {
                setRemovingId(null);
              }
            })();
          },
        },
      ]
    );
  };

  const onConnectLive = async () => {
    if (!selectedAccountId) {
      Alert.alert('MT5', 'Select or save an account first.');
      return;
    }
    setLoading(true);
    try {
      await setMt5LivePaused(false);
      setLiveConnected(true);
      await refreshPanel(selectedAccountId, panel, true);
      showToast('Connected to live MT5 data');
    } catch (error: any) {
      setLiveConnected(false);
      await setMt5LivePaused(true);
      Alert.alert('Live connection failed', String(error?.message || 'Try again later.'));
    } finally {
      setLoading(false);
    }
  };

  const onDisconnectLive = async () => {
    await setMt5LivePaused(true);
    setLiveConnected(false);
    setPositions([]);
    setHistory([]);
    if (selectedAccountId) {
      await loadCachedBalance(selectedAccountId).catch(() => {
        setBalance(null);
        setStatus('Disconnected — saved details kept. Connect live when ready.');
      });
    } else {
      setBalance(null);
      setStatus('Disconnected — connect live when ready.');
    }
    showToast('Live MT5 disconnected');
  };

  usePolling(() => {
    if (!selectedAccountId || !liveConnected || addOpen || fabOpen) return;
    void refreshPanel(selectedAccountId, panel, true).catch(() => {});
  }, 15000, true);

  const onSaveAccount = async () => {
    if (!login || !password || !server) {
      Alert.alert('Validation', 'MT5 login, password and server are required.');
      return;
    }
    try {
      setLoading(true);
      const saved = await mt5Service.saveAccount({ login, password, server, accountName });
      setAddOpen(false);
      setFabOpen(false);
      setLogin('');
      setPassword('');
      setServer('');
      setAccountName('');
      await setMt5LivePaused(true);
      setLiveConnected(false);
      await loadAccounts();
      const id = saved.account?.id || '';
      if (id) {
        setSelectedAccountId(id);
        setPanel('balance');
        await loadCachedBalance(id);
      }
      showToast('MT5 details saved — tap Connect live when ready');
    } catch (error: any) {
      Alert.alert('MT5 Error', error?.message || 'Failed to save MT5 account');
    } finally {
      setLoading(false);
    }
  };

  const onClosePosition = (position: Mt5Position) => {
    if (!selectedAccountId || !position.id) return;
    Alert.alert('Close position', `Close ${position.symbol} ${sideLabel(position.type)}?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Close',
        style: 'destructive',
        onPress: async () => {
          setClosingId(position.id!);
          try {
            await mt5Service.closePosition(selectedAccountId, position.id!);
            showToast('Close request sent');
            await loadPositions(selectedAccountId);
            await loadLiveBalance(selectedAccountId);
          } catch (error: any) {
            Alert.alert('Close failed', String(error?.message || 'Could not close position'));
          } finally {
            setClosingId(null);
          }
        },
      },
    ]);
  };

  const renderBalance = () => (
    <Card>
      <Text style={styles.cardTitle}>{liveConnected ? 'Live balance' : 'Account balance'}</Text>
      {loading && !balance ? <ActivityIndicator color={palette.primary} style={{ marginVertical: 12 }} /> : null}
      <Text style={styles.balanceMain}>
        {balance ? `${balance.currency} ${balance.balance.toFixed(2)}` : '—'}
      </Text>
      <Text style={styles.meta}>Equity: {balance ? `${balance.currency} ${balance.equity.toFixed(2)}` : '—'}</Text>
      <Text style={styles.meta}>Login: {balance?.login || selectedAccount?.login || '—'}</Text>
      <Text style={styles.meta}>Server: {balance?.server || selectedAccount?.server || '—'}</Text>
      <Text style={styles.meta}>
        {liveConnected ? 'Live connection active' : 'Offline — showing saved details only'}
      </Text>
      <Text style={styles.meta}>{status}</Text>
      <View style={styles.liveRow}>
        {liveConnected ? (
          <PrimaryButton compact label='Disconnect' variant='danger' onPress={() => void onDisconnectLive()} />
        ) : (
          <PrimaryButton
            compact
            label={loading ? 'Connecting…' : 'Connect live'}
            onPress={() => void onConnectLive()}
            disabled={loading || !selectedAccountId}
          />
        )}
      </View>
    </Card>
  );

  const renderPositions = () => (
    <Card>
      <Text style={styles.cardTitle}>Open positions</Text>
      {loading && !positions.length ? <ActivityIndicator color={palette.primary} style={{ marginVertical: 12 }} /> : null}
      {!positions.length && !loading ? <Text style={styles.meta}>No open positions</Text> : null}
      {positions.map((p, idx) => (
        <View key={p.id || `${p.symbol}-${idx}`} style={styles.positionRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.positionSymbol}>{p.symbol || '—'}</Text>
            <Text style={styles.meta}>
              {sideLabel(p.type)} · Vol {Number(p.volume || 0).toFixed(2)} · Open {Number(p.openPrice || 0).toFixed(5)}
            </Text>
            <Text style={styles.meta}>Price {Number(p.currentPrice || 0).toFixed(5)}</Text>
          </View>
          <View style={styles.positionActions}>
            <Text style={{ color: Number(p.profit || 0) >= 0 ? palette.success : palette.danger, fontWeight: '700' }}>
              {Number(p.profit || 0).toFixed(2)}
            </Text>
            <PrimaryButton
              compact
              label={closingId === p.id ? '…' : 'Close'}
              variant='danger'
              onPress={() => onClosePosition(p)}
              disabled={!p.id || closingId === p.id}
            />
          </View>
        </View>
      ))}
    </Card>
  );

  const renderHistory = () => (
    <Card>
      <Text style={styles.cardTitle}>Trade history (30 days)</Text>
      {loading && !history.length ? <ActivityIndicator color={palette.primary} style={{ marginVertical: 12 }} /> : null}
      {!history.length && !loading ? <Text style={styles.meta}>No closed deals in this period</Text> : null}
      {history.map((d) => (
        <View key={d.id} style={styles.historyRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.positionSymbol}>{d.symbol || '—'}</Text>
            <Text style={styles.meta}>
              {sideLabel(d.type)} · Vol {Number(d.volume || 0).toFixed(2)} @ {Number(d.price || 0).toFixed(5)}
            </Text>
            <Text style={styles.meta}>{formatTime(d.time)}</Text>
          </View>
          <Text style={{ color: Number(d.profit || 0) >= 0 ? palette.success : palette.danger, fontWeight: '700' }}>
            {Number(d.profit || 0).toFixed(2)}
          </Text>
        </View>
      ))}
    </Card>
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 120 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onPullRefresh} tintColor={palette.primary} />}
      >
        <Text style={styles.title}>MT5</Text>
        <Text style={styles.sub}>Live account data from your connected broker</Text>

        <Card>
          <Text style={styles.cardTitle}>Accounts</Text>
          {!accounts.length ? <Text style={styles.meta}>No MT5 account linked yet. Use + to connect.</Text> : null}
          {accounts.map((account) => {
            const selected = account.id === selectedAccountId;
            const removing = account.id === removingId;
            return (
              <View key={account.id} style={[styles.accountRow, selected && styles.accountRowActive]}>
                <Pressable
                  style={styles.accountRowMain}
                  onPress={() => {
                    if (!account.id || removing) return;
                    setSelectedAccountId(account.id);
                    void refreshPanel(account.id, panel, liveConnected);
                  }}
                >
                  <Text style={styles.accountTitle}>{account.accountName || account.login}</Text>
                  <Text style={styles.meta}>{account.server}</Text>
                </Pressable>
                <Pressable
                  style={styles.removeBtn}
                  onPress={() => onRemoveAccount(account)}
                  disabled={removing}
                  hitSlop={10}
                  accessibilityLabel='Remove MT5 connection'
                >
                  {removing ? (
                    <ActivityIndicator size='small' color={palette.danger} />
                  ) : (
                    <Ionicons name='trash-outline' size={20} color={palette.danger} />
                  )}
                </Pressable>
              </View>
            );
          })}
        </Card>

        {selectedAccountId ? (
          <>
            <View style={styles.panelTabs}>
              {(['balance', 'positions', 'history'] as Mt5Panel[]).map((key) => (
                <Pressable
                  key={key}
                  style={[styles.panelTab, panel === key && styles.panelTabActive]}
                  onPress={() => void selectPanel(key)}
                >
                  <Text style={[styles.panelTabText, panel === key && styles.panelTabTextActive]}>
                    {key === 'balance' ? 'Balance' : key === 'positions' ? 'Positions' : 'History'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {panel === 'balance' ? renderBalance() : null}
            {panel === 'positions' ? renderPositions() : null}
            {panel === 'history' ? renderHistory() : null}
          </>
        ) : (
          <Card>
            <Text style={styles.meta}>{status}</Text>
          </Card>
        )}
      </ScrollView>

      {fabOpen ? (
        <Pressable style={styles.fabBackdrop} onPress={() => setFabOpen(false)} />
      ) : null}

      {fabOpen ? (
        <View style={[styles.fabMenu, { bottom: 88 + insets.bottom }]}>
          <Pressable style={styles.fabMenuItem} onPress={() => void selectPanel('balance')}>
            <Ionicons name='wallet-outline' size={20} color={palette.textPrimary} />
            <Text style={styles.fabMenuText}>Live balance</Text>
          </Pressable>
          <Pressable style={styles.fabMenuItem} onPress={() => void selectPanel('positions')}>
            <Ionicons name='stats-chart-outline' size={20} color={palette.textPrimary} />
            <Text style={styles.fabMenuText}>Open positions</Text>
          </Pressable>
          <Pressable style={styles.fabMenuItem} onPress={() => void selectPanel('history')}>
            <Ionicons name='time-outline' size={20} color={palette.textPrimary} />
            <Text style={styles.fabMenuText}>History</Text>
          </Pressable>
          <Pressable
            style={styles.fabMenuItem}
            onPress={() => {
              setFabOpen(false);
              if (!selectedAccountId) {
                Alert.alert('MT5', 'Select an account first.');
                return;
              }
              setLoading(true);
              void refreshPanel(selectedAccountId, panel, liveConnected)
                .then(() => showToast(liveConnected ? 'Refreshed live data' : 'Reloaded saved details'))
                .catch((e: any) => Alert.alert('MT5', e?.message || 'Refresh failed'))
                .finally(() => setLoading(false));
            }}
          >
            <Ionicons name='refresh-outline' size={20} color={palette.textPrimary} />
            <Text style={styles.fabMenuText}>Refresh live</Text>
          </Pressable>
          <Pressable
            style={styles.fabMenuItem}
            onPress={() => {
              setFabOpen(false);
              setAddOpen(true);
            }}
          >
            <Ionicons name='add-circle-outline' size={20} color={palette.primary} />
            <Text style={[styles.fabMenuText, { color: palette.primary }]}>Add MT5 account</Text>
          </Pressable>
        </View>
      ) : null}

      <Pressable
        style={[styles.fab, { bottom: 22 + insets.bottom }]}
        onPress={() => setFabOpen((v) => !v)}
      >
        <Ionicons name={fabOpen ? 'close' : 'menu'} size={26} color={palette.background} />
      </Pressable>

      <Modal visible={addOpen} transparent animationType='slide' onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 48 : 0}
          style={{ flex: 1 }}
        >
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              Keyboard.dismiss();
              setAddOpen(false);
            }}
          />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(16, insets.bottom + 10) }]}>
            <Text style={styles.cardTitle}>Add MT5 account</Text>
            <Text style={styles.meta}>
              Your login details are saved securely. Live sync runs only when you tap Connect live.
            </Text>
            <TextInput style={styles.input} value={login} onChangeText={setLogin} placeholder='MT5 Login ID' placeholderTextColor={palette.textSecondary} />
            <TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder='MT5 Password' secureTextEntry placeholderTextColor={palette.textSecondary} />
            <TextInput style={styles.input} value={server} onChangeText={setServer} placeholder='Broker server' placeholderTextColor={palette.textSecondary} />
            <TextInput style={styles.input} value={accountName} onChangeText={setAccountName} placeholder='Label (optional)' placeholderTextColor={palette.textSecondary} />
            <View style={styles.modalRow}>
              <PrimaryButton label={loading ? 'Saving…' : 'Save details'} onPress={() => void onSaveAccount()} disabled={loading} style={{ flex: 1 }} />
              <View style={{ width: 8 }} />
              <PrimaryButton label='Cancel' onPress={() => setAddOpen(false)} variant='danger' style={{ flex: 1 }} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 14 },
  cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '700', marginBottom: 8 },
  meta: { color: palette.textSecondary, marginBottom: 4, fontSize: 13 },
  balanceMain: { color: palette.textPrimary, fontSize: 34, fontWeight: '800', marginVertical: 8 },
  liveRow: { flexDirection: 'row', marginTop: 12, gap: 8 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  accountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    backgroundColor: palette.surfaceElevated,
  },
  accountRowActive: { borderColor: palette.primary },
  accountRowMain: { flex: 1, paddingRight: 8 },
  removeBtn: { padding: 6, justifyContent: 'center', alignItems: 'center', minWidth: 32 },
  accountTitle: { color: palette.textPrimary, fontWeight: '700', marginBottom: 2 },
  panelTabs: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  panelTab: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  panelTabActive: { borderColor: palette.primary, backgroundColor: palette.surfaceElevated },
  panelTabText: { color: palette.textSecondary, fontSize: 12, fontWeight: '600' },
  panelTabTextActive: { color: palette.primary },
  positionRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  positionSymbol: { color: palette.textPrimary, fontWeight: '700', fontSize: 16, marginBottom: 2 },
  positionActions: { alignItems: 'flex-end', gap: 8, marginLeft: 8 },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 8,
    shadowColor: palette.shadow,
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  fabBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.35)' },
  fabMenu: {
    position: 'absolute',
    right: 18,
    backgroundColor: palette.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 6,
    minWidth: 200,
    elevation: 10,
  },
  fabMenuItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 16 },
  fabMenuText: { color: palette.textPrimary, fontSize: 15, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  modalSheet: { backgroundColor: palette.surface, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16 },
  modalRow: { flexDirection: 'row', marginTop: 8 },
});
