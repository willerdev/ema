import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { cryptoWalletService } from '../services/cryptoWalletService';
import { walletService } from '../services/walletService';
import { CryptoSummary, WalletTransaction } from '../types';
import { palette } from '../theme/colors';

type WalletTab = 'cash' | 'crypto';

export function WalletScreen() {
  const [tab, setTab] = useState<WalletTab>('cash');

  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [cryptoSummary, setCryptoSummary] = useState<CryptoSummary | null>(null);
  const [cryptoSendTo, setCryptoSendTo] = useState('');
  const [cryptoSendAmount, setCryptoSendAmount] = useState('');
  const [cryptoSendAsset, setCryptoSendAsset] = useState<'ETH' | 'USDT'>('ETH');
  const [cryptoError, setCryptoError] = useState<string | null>(null);

  const refreshCash = useCallback(async () => {
    try {
      const data = await walletService.getWallet();
      setBalance(data.balance);
      setTransactions(data.transactions);
      setLastUpdatedAt(Date.now());
    } catch {
      // keep previous values on transient network failure
    }
  }, []);

  const refreshCrypto = useCallback(async () => {
    setCryptoError(null);
    try {
      let summary = await cryptoWalletService.getSummary();
      if (!summary.onboarded) {
        try {
          await cryptoWalletService.onboard();
          summary = await cryptoWalletService.getSummary();
        } catch (e: any) {
          setCryptoError(e?.message || 'Crypto onboarding failed');
          setCryptoSummary(null);
          return;
        }
      }
      setCryptoSummary(summary);
    } catch (e: any) {
      setCryptoError(e?.message || 'Failed to load crypto wallet');
      setCryptoSummary(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    await refreshCash();
    if (tab === 'crypto') await refreshCrypto();
  }, [refreshCash, refreshCrypto, tab]);

  usePolling(refresh, 10000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onDeposit = async () => {
    try {
      await walletService.deposit(Number(amount), 'crypto', `REF-${Date.now()}`);
      refreshCash();
      Alert.alert('Done', 'Deposit request completed');
    } catch (error: any) {
      Alert.alert('Wallet Error', error.message);
    }
  };

  const onWithdraw = async () => {
    try {
      await walletService.withdraw(Number(amount), 'crypto');
      refreshCash();
      Alert.alert('Done', 'Withdrawal request submitted');
    } catch (error: any) {
      Alert.alert('Wallet Error', error.message);
    }
  };

  const onCopyAddress = async (addr: string) => {
    Alert.alert('Receive address', addr);
  };

  const onCryptoSend = async () => {
    try {
      setCryptoError(null);
      const r = await cryptoWalletService.send(cryptoSendTo.trim(), cryptoSendAmount.trim(), cryptoSendAsset);
      setCryptoSendTo('');
      setCryptoSendAmount('');
      await refreshCrypto();
      Alert.alert('Sent', r.txId ? `Tx: ${r.txId}` : 'Transaction submitted');
    } catch (e: any) {
      setCryptoError(e?.message || 'Send failed');
    }
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <View style={styles.tabRow}>
        <Text style={[styles.tab, tab === 'cash' && styles.tabActive]} onPress={() => setTab('cash')}>
          Cash wallet
        </Text>
        <Text style={[styles.tab, tab === 'crypto' && styles.tabActive]} onPress={() => { setTab('crypto'); void refreshCrypto(); }}>
          Crypto (ETH / USDT)
        </Text>
      </View>

      {tab === 'cash' ? (
        <>
          <Card>
            <Text style={styles.label}>Internal Wallet Balance</Text>
            <Text style={styles.balance}>{balance === null ? '--' : `$${balance.toFixed(2)}`}</Text>
            <Text style={styles.item}>{lastUpdatedAt ? `Status: ${Date.now() - lastUpdatedAt > 20000 ? 'stale' : 'live'}` : 'Status: unavailable'}</Text>
          </Card>

          <Card>
            <Text style={styles.label}>Deposit / Withdraw</Text>
            <TextInput style={styles.input} value={amount} onChangeText={setAmount} placeholder='Amount' placeholderTextColor={palette.textSecondary} keyboardType='numeric' />
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
        </>
      ) : (
        <>
          {cryptoError ? (
            <Card>
              <Text style={styles.errorText}>{cryptoError}</Text>
              <PrimaryButton label='Retry' onPress={() => void refreshCrypto()} />
            </Card>
          ) : null}

          {cryptoSummary?.onboarded ? (
            <>
              <Card>
                <Text style={styles.label}>Receive (Ethereum)</Text>
                <Text style={styles.mono}>{cryptoSummary.depositAddress || '—'}</Text>
                {cryptoSummary.depositAddress ? (
                  <PrimaryButton label='Copy address' onPress={() => void onCopyAddress(cryptoSummary.depositAddress!)} style={{ marginTop: 8 }} />
                ) : null}
                <Text style={styles.hint}>Send ETH or USDT (ERC-20) on Ethereum mainnet to this address.</Text>
              </Card>

              <Card>
                <Text style={styles.label}>Balances (on-chain)</Text>
                {cryptoSummary.balances.map((b) => (
                  <Text key={b.asset} style={styles.item}>
                    {b.asset}: {b.balance}
                  </Text>
                ))}
                {!cryptoSummary.balances.length && <Text style={styles.item}>No balance data</Text>}
              </Card>

              <Card>
                <Text style={styles.label}>Send</Text>
                <TextInput style={styles.input} value={cryptoSendTo} onChangeText={setCryptoSendTo} placeholder='To address 0x…' placeholderTextColor={palette.textSecondary} autoCapitalize='none' />
                <TextInput style={styles.input} value={cryptoSendAmount} onChangeText={setCryptoSendAmount} placeholder='Amount' placeholderTextColor={palette.textSecondary} />
                <View style={styles.row}>
                  {(['ETH', 'USDT'] as const).map((a) => (
                    <Text key={a} style={[styles.pill, cryptoSendAsset === a && styles.active]} onPress={() => setCryptoSendAsset(a)}>{a}</Text>
                  ))}
                </View>
                <PrimaryButton label='Send on-chain' onPress={() => void onCryptoSend()} disabled={!cryptoSendTo.trim() || !cryptoSendAmount.trim()} />
              </Card>

              <Card>
                <Text style={styles.label}>Activity</Text>
                {cryptoSummary.activity.map((t) => (
                  <Text key={t.id} style={styles.item}>
                    {t.direction.toUpperCase()} {t.amountDisplay} {t.asset} — {(t.txHash || '').slice(0, 10)}…
                  </Text>
                ))}
                {!cryptoSummary.activity.length && <Text style={styles.item}>No recorded transfers yet</Text>}
              </Card>

              <Card>
                <Text style={styles.label}>Swap</Text>
                <Text style={styles.item}>{cryptoSummary.swap.message}</Text>
                <PrimaryButton label='Swap status' onPress={async () => {
                  const s = await cryptoWalletService.getSwapStatus();
                  Alert.alert('Swap', s.message);
                }} />
              </Card>
            </>
          ) : cryptoError ? null : (
            <Card>
              <Text style={styles.item}>Preparing your crypto wallet…</Text>
            </Card>
          )}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  tabRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  tab: { flex: 1, textAlign: 'center', color: palette.textSecondary, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: palette.border },
  tabActive: { color: palette.primary, borderColor: palette.primary },
  label: { color: palette.textSecondary, marginBottom: 8 },
  balance: { color: palette.textPrimary, fontSize: 34, fontWeight: '800' },
  input: { backgroundColor: palette.surfaceElevated, borderWidth: 1, borderColor: palette.border, color: palette.textPrimary, borderRadius: 12, padding: 10, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  actions: { flexDirection: 'row' },
  pill: { color: palette.textPrimary, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  active: { borderColor: palette.primary, color: palette.primary },
  item: { color: palette.textPrimary, marginBottom: 6 },
  mono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12 },
  hint: { color: palette.textSecondary, marginTop: 8, fontSize: 12 },
  errorText: { color: '#f87171', marginBottom: 8 },
});
