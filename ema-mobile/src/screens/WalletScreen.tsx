import { useCallback, useState } from 'react';
import { Alert, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
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
  const [copyToast, setCopyToast] = useState<string | null>(null);
  const [receiveModalOpen, setReceiveModalOpen] = useState(false);
  const [sendModalOpen, setSendModalOpen] = useState(false);
  const [quickServicesModalOpen, setQuickServicesModalOpen] = useState(false);

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

  usePolling(refresh, 60000, true);

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
    try {
      await Clipboard.setStringAsync(addr);
      setCopyToast('Wallet address copied');
      setTimeout(() => setCopyToast(null), 1800);
    } catch {
      Alert.alert('Copy failed', 'Could not copy address. Please try again.');
    }
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

  const primaryWalletAddress = cryptoSummary?.depositAddress || cryptoSummary?.wallets?.[0]?.address || null;
  const ethBalance = cryptoSummary?.balances.find((b) => b.asset === 'ETH')?.balance || '0';
  const usdtBalance = cryptoSummary?.balances.find((b) => b.asset === 'USDT')?.balance || '0';
  const totalBalanceDisplay = (() => {
    const total = (parseFloat(ethBalance) || 0) + (parseFloat(usdtBalance) || 0);
    return Number.isFinite(total) ? total.toFixed(4) : '0.0000';
  })();

  return (
    <View style={styles.container}>
      <ScrollView
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
              <Card style={styles.heroCard}>
                <Text style={styles.heroCaption}>Crypto Wallet Balance</Text>
                <Text style={styles.heroBalance}>{totalBalanceDisplay}</Text>
                <View style={styles.heroMetaRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroMetaLabel}>Ethereum Address</Text>
                    <Text style={styles.heroMetaValue}>{primaryWalletAddress ? `${primaryWalletAddress.slice(0, 8)}...${primaryWalletAddress.slice(-6)}` : 'Not ready'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.heroMetaLabel}>Assets Enabled</Text>
                    <Text style={styles.heroMetaValue}>ETH + USDT</Text>
                  </View>
                </View>
                <View style={styles.quickActionsRow}>
                  <PrimaryButton label='Receive' onPress={() => setReceiveModalOpen(true)} style={{ flex: 1 }} />
                  <View style={{ width: 8 }} />
                  <PrimaryButton label='Send' onPress={() => setSendModalOpen(true)} style={{ flex: 1 }} />
                </View>
              </Card>

              <Card>
                <Text style={styles.sectionTitle}>Assets</Text>
                <View style={styles.assetGrid}>
                  <View style={styles.assetTile}>
                    <Text style={styles.assetLabel}>ETH</Text>
                    <Text style={styles.assetValue}>{ethBalance}</Text>
                    <Text style={styles.assetSub}>Main wallet</Text>
                  </View>
                  <View style={styles.assetTile}>
                    <Text style={styles.assetLabel}>USDT</Text>
                    <Text style={styles.assetValue}>{usdtBalance}</Text>
                    <Text style={styles.assetSub}>Wallet ready by default</Text>
                  </View>
                </View>
              </Card>

              <Card>
                <Text style={styles.sectionTitle}>Options</Text>
                <Text style={styles.item}>Open quick actions to send, receive, or check services.</Text>
                <PrimaryButton label='Open Quick Services' onPress={() => setQuickServicesModalOpen(true)} />
              </Card>

              <Card>
                <Text style={styles.sectionTitle}>Recent Activity</Text>
                {cryptoSummary.activity.map((t) => (
                  <Text key={t.id} style={styles.item}>
                    {t.direction.toUpperCase()} {t.amountDisplay} {t.asset} — {(t.txHash || '').slice(0, 10)}…
                  </Text>
                ))}
                {!cryptoSummary.activity.length && <Text style={styles.item}>No recorded transfers yet</Text>}
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
      {copyToast ? (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{copyToast}</Text>
        </View>
      ) : null}

      <Modal visible={receiveModalOpen} transparent animationType='fade' onRequestClose={() => setReceiveModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Receive Crypto</Text>
            <Text style={styles.modalLabel}>Chain</Text>
            <Text style={styles.modalValue}>Ethereum</Text>
            <Text style={styles.modalLabel}>Address</Text>
            <Text style={styles.modalMono}>{primaryWalletAddress || 'Not available'}</Text>
            {primaryWalletAddress ? (
              <View style={styles.qrWrap}>
                <QRCode value={primaryWalletAddress} size={160} color={palette.textPrimary} backgroundColor='white' />
              </View>
            ) : null}
            <View style={styles.modalButtonRow}>
              <PrimaryButton
                label='Copy address'
                onPress={() => {
                  if (primaryWalletAddress) void onCopyAddress(primaryWalletAddress);
                }}
                style={{ flex: 1 }}
              />
              <View style={{ width: 8 }} />
              <PrimaryButton label='Dismiss' onPress={() => setReceiveModalOpen(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={sendModalOpen} transparent animationType='fade' onRequestClose={() => setSendModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Send Crypto</Text>
            <TextInput style={styles.input} value={cryptoSendTo} onChangeText={setCryptoSendTo} placeholder='To address 0x…' placeholderTextColor={palette.textSecondary} autoCapitalize='none' />
            <TextInput style={styles.input} value={cryptoSendAmount} onChangeText={setCryptoSendAmount} placeholder='Amount' placeholderTextColor={palette.textSecondary} />
            <View style={styles.row}>
              {(['ETH', 'USDT'] as const).map((a) => (
                <Text key={a} style={[styles.pill, cryptoSendAsset === a && styles.active]} onPress={() => setCryptoSendAsset(a)}>{a}</Text>
              ))}
            </View>
            <View style={styles.modalButtonRow}>
              <PrimaryButton
                label='Send on-chain'
                onPress={async () => {
                  await onCryptoSend();
                  setSendModalOpen(false);
                }}
                disabled={!cryptoSendTo.trim() || !cryptoSendAmount.trim()}
                style={{ flex: 1 }}
              />
              <View style={{ width: 8 }} />
              <PrimaryButton label='Dismiss' onPress={() => setSendModalOpen(false)} style={{ flex: 1 }} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={quickServicesModalOpen} transparent animationType='fade' onRequestClose={() => setQuickServicesModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Quick Services</Text>
            <View style={styles.serviceRow}>
              <Pressable
                style={styles.servicePill}
                onPress={() => {
                  setQuickServicesModalOpen(false);
                  setReceiveModalOpen(true);
                }}
              >
                <Text style={styles.servicePillText}>Receive</Text>
              </Pressable>
              <Pressable
                style={styles.servicePill}
                onPress={() => {
                  setCryptoSendAsset('ETH');
                  setQuickServicesModalOpen(false);
                  setSendModalOpen(true);
                }}
              >
                <Text style={styles.servicePillText}>Send ETH</Text>
              </Pressable>
              <Pressable
                style={styles.servicePill}
                onPress={() => {
                  setCryptoSendAsset('USDT');
                  setQuickServicesModalOpen(false);
                  setSendModalOpen(true);
                }}
              >
                <Text style={styles.servicePillText}>Send USDT</Text>
              </Pressable>
              <Pressable
                style={styles.servicePill}
                onPress={() => {
                  setQuickServicesModalOpen(false);
                  Alert.alert('Swap', 'Swap is currently unavailable.');
                }}
              >
                <Text style={styles.servicePillText}>Swap</Text>
              </Pressable>
            </View>
            <PrimaryButton label='Dismiss' onPress={() => setQuickServicesModalOpen(false)} style={{ marginTop: 12 }} />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  tabRow: { flexDirection: 'row', gap: 12, marginBottom: 16 },
  tab: { flex: 1, textAlign: 'center', color: palette.textSecondary, paddingVertical: 10, borderRadius: 12, borderWidth: 1, borderColor: palette.border },
  tabActive: { color: palette.primary, borderColor: palette.primary },
  label: { color: palette.textSecondary, marginBottom: 8 },
  sectionTitle: { color: palette.textSecondary, marginBottom: 10, fontSize: 16, fontWeight: '700' },
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
  heroCard: { paddingTop: 18, paddingBottom: 18 },
  heroCaption: { color: palette.textSecondary, marginBottom: 6, fontSize: 15 },
  heroBalance: { color: palette.textPrimary, fontSize: 40, fontWeight: '800', marginBottom: 14 },
  heroMetaRow: { flexDirection: 'row', gap: 12, borderTopWidth: 1, borderTopColor: palette.border, paddingTop: 12, marginBottom: 12 },
  heroMetaLabel: { color: palette.textSecondary, fontSize: 12, marginBottom: 4 },
  heroMetaValue: { color: palette.textPrimary, fontSize: 14, fontWeight: '600' },
  quickActionsRow: { flexDirection: 'row' },
  assetGrid: { flexDirection: 'row', gap: 10 },
  assetTile: { flex: 1, backgroundColor: palette.surfaceElevated, borderRadius: 12, borderWidth: 1, borderColor: palette.border, padding: 12 },
  assetLabel: { color: palette.textSecondary, fontSize: 13, marginBottom: 4 },
  assetValue: { color: palette.textPrimary, fontSize: 22, fontWeight: '700', marginBottom: 4 },
  assetSub: { color: palette.textSecondary, fontSize: 12 },
  serviceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  servicePill: { borderRadius: 999, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.surfaceElevated, paddingVertical: 10, paddingHorizontal: 14 },
  servicePillText: { color: palette.textPrimary, fontWeight: '600' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
  },
  modalTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 },
  modalLabel: { color: palette.textSecondary, marginTop: 6, marginBottom: 2, fontSize: 13 },
  modalValue: { color: palette.textPrimary, fontWeight: '600' },
  modalMono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12 },
  qrWrap: { alignItems: 'center', marginVertical: 12 },
  modalButtonRow: { flexDirection: 'row', marginTop: 8 },
  toastWrap: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    backgroundColor: '#0f172a',
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  toastText: { color: palette.textPrimary, textAlign: 'center', fontWeight: '600' },
});
