import { useCallback, useEffect, useState } from 'react';
import {
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { authService } from '../services/authService';
import { nowpaymentsService } from '../services/nowpaymentsService';
import { walletService } from '../services/walletService';
import {
  NowpaymentsCreateDepositResponse,
  NowpaymentsDepositStatus,
  NowpaymentsSummary,
  WalletTransaction,
} from '../types';
import { palette } from '../theme/colors';

type WalletTab = 'cash' | 'crypto';

const PAY_CURRENCY_OPTIONS = ['usdttrc20', 'btc', 'eth', 'ltc', 'trx'];

export function WalletScreen() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<WalletTab>('cash');

  const [balance, setBalance] = useState<number | null>(null);
  const [amount, setAmount] = useState('');
  const [cashWithdrawTotpCode, setCashWithdrawTotpCode] = useState('');
  const [totpEnabled, setTotpEnabled] = useState(false);
  const [transactions, setTransactions] = useState<WalletTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);

  const [npSummary, setNpSummary] = useState<NowpaymentsSummary | null>(null);
  const [npError, setNpError] = useState<string | null>(null);
  const [copyToast, setCopyToast] = useState<string | null>(null);

  const [depositUsdAmount, setDepositUsdAmount] = useState('');
  const [depositPayCurrency, setDepositPayCurrency] = useState('usdttrc20');
  const [activeDeposit, setActiveDeposit] = useState<NowpaymentsCreateDepositResponse | null>(null);
  const [depositStatus, setDepositStatus] = useState<NowpaymentsDepositStatus | null>(null);
  const [depositModalOpen, setDepositModalOpen] = useState(false);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawCurrency, setWithdrawCurrency] = useState('usdttrc20');
  const [withdrawAddress, setWithdrawAddress] = useState('');
  const [withdrawTotpCode, setWithdrawTotpCode] = useState('');
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);

  const refreshCash = useCallback(async () => {
    try {
      const data = await walletService.getWallet();
      setBalance(data.balance);
      setTransactions(data.transactions);
      setLastUpdatedAt(Date.now());
    } catch {
      // keep previous values on transient network failure
    }
    try {
      const totp = await authService.getTotpStatus();
      setTotpEnabled(Boolean(totp.enabled));
    } catch {
      setTotpEnabled(false);
    }
  }, []);

  const refreshNowpayments = useCallback(async () => {
    setNpError(null);
    try {
      const summary = await nowpaymentsService.getSummary();
      setNpSummary(summary);
    } catch (e: any) {
      setNpError(sanitizeError(e?.message || 'Failed to load crypto wallet'));
      setNpSummary(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    await refreshCash();
    if (tab === 'crypto') await refreshNowpayments();
  }, [refreshCash, refreshNowpayments, tab]);

  usePolling(refresh, 60000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const pollActiveDeposit = useCallback(async () => {
    if (!activeDeposit?.id) return;
    try {
      const status = await nowpaymentsService.getDeposit(activeDeposit.id);
      setDepositStatus(status);
      if (status.ledgerCredited || status.status === 'finished') {
        await refreshNowpayments();
      }
    } catch {
      // ignore poll errors
    }
  }, [activeDeposit?.id, refreshNowpayments]);

  useEffect(() => {
    if (!depositModalOpen || !activeDeposit?.id) return;
    void pollActiveDeposit();
    const t = setInterval(() => void pollActiveDeposit(), 15000);
    return () => clearInterval(t);
  }, [depositModalOpen, activeDeposit?.id, pollActiveDeposit]);

  const onCashDeposit = async () => {
    try {
      await walletService.deposit(Number(amount), 'bank_transfer', `REF-${Date.now()}`);
      setAmount('');
      refreshCash();
      Alert.alert('Done', 'Cash deposit recorded');
    } catch (error: any) {
      Alert.alert('Wallet Error', error.message);
    }
  };

  const onCashWithdraw = async () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n <= 0) return;
    const totpOk = !totpEnabled || cashWithdrawTotpCode.replace(/\s/g, '').length >= 6;
    if (!totpOk) return;
    try {
      await walletService.withdraw(n, 'bank_transfer', {
        ...(totpEnabled ? { totpCode: cashWithdrawTotpCode.replace(/\s/g, '') } : {}),
      });
      setAmount('');
      setCashWithdrawTotpCode('');
      refreshCash();
      Alert.alert('Done', 'Cash withdrawal request submitted');
    } catch (error: any) {
      Alert.alert('Wallet Error', error.message);
    }
  };

  const onCreateCryptoDeposit = async () => {
    const priceAmount = Number(depositUsdAmount);
    if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter a USD amount to deposit.');
      return;
    }
    try {
      setNpError(null);
      const created = await nowpaymentsService.createDeposit(priceAmount, depositPayCurrency, 'usd');
      setActiveDeposit(created);
      setDepositStatus({
        id: created.id,
        paymentId: created.paymentId,
        status: created.status,
        payAddress: created.payAddress,
        payAmount: created.payAmount,
        payCurrency: created.payCurrency,
        ledgerCredited: false,
      });
      setDepositModalOpen(true);
      await refreshNowpayments();
    } catch (e: any) {
      Alert.alert('Deposit failed', sanitizeError(e?.message || 'Could not create payment'));
    }
  };

  const onCryptoWithdraw = async () => {
    const n = Number(withdrawAmount);
    if (!Number.isFinite(n) || n <= 0 || !withdrawAddress.trim()) return;
    const totpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
    if (!totpOk) return;
    try {
      setNpError(null);
      await nowpaymentsService.createWithdrawal(
        withdrawCurrency,
        withdrawAddress.trim(),
        n,
        totpEnabled ? withdrawTotpCode.replace(/\s/g, '') : undefined
      );
      setWithdrawAmount('');
      setWithdrawAddress('');
      setWithdrawTotpCode('');
      setWithdrawModalOpen(false);
      await refreshNowpayments();
      Alert.alert('Submitted', 'Withdrawal sent to NOWPayments. Balance updates when payout completes.');
    } catch (e: any) {
      Alert.alert('Withdraw failed', sanitizeError(e?.message || 'Withdrawal failed'));
    }
  };

  const onCopyAddress = async (addr: string) => {
    try {
      await Clipboard.setStringAsync(addr);
      setCopyToast('Address copied');
      setTimeout(() => setCopyToast(null), 1800);
    } catch {
      Alert.alert('Copy failed', 'Could not copy address.');
    }
  };

  function sanitizeError(raw: string) {
    const text = String(raw || '');
    if (text.length > 200) return 'Service temporarily unavailable. Please retry.';
    return text;
  }

  const cashWithdrawTotpOk = !totpEnabled || cashWithdrawTotpCode.replace(/\s/g, '').length >= 6;
  const cashAmountOk = amount.trim().length > 0 && Number.isFinite(Number(amount)) && Number(amount) > 0;

  const cryptoWithdrawTotpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
  const cryptoWithdrawReady =
    withdrawAmount.trim().length > 0 &&
    Number.isFinite(Number(withdrawAmount)) &&
    Number(withdrawAmount) > 0 &&
    withdrawAddress.trim().length > 0 &&
    cryptoWithdrawTotpOk;

  const payAddress = depositStatus?.payAddress || activeDeposit?.payAddress;
  const payAmount = depositStatus?.payAmount || activeDeposit?.payAmount;
  const payStatus = depositStatus?.status || activeDeposit?.status || 'waiting';

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <View style={styles.tabRow}>
          <Text
            style={[styles.tab, tab === 'cash' && styles.tabActive]}
            onPress={() => {
              setTab('cash');
              void refreshCash();
            }}
          >
            Cash wallet
          </Text>
          <Text
            style={[styles.tab, tab === 'crypto' && styles.tabActive]}
            onPress={() => {
              setTab('crypto');
              void refreshNowpayments();
            }}
          >
            Crypto
          </Text>
        </View>

        {tab === 'cash' ? (
          <>
            <Card>
              <Text style={styles.label}>Cash wallet balance</Text>
              <Text style={styles.balance}>{balance === null ? '--' : `$${balance.toFixed(2)}`}</Text>
              <Text style={styles.item}>Internal USD ledger for airfarming and contracts.</Text>
              <Text style={styles.hint}>Crypto deposits and withdrawals are on the Crypto tab (NOWPayments).</Text>
            </Card>

            <Card>
              <Text style={styles.label}>Cash deposit / withdraw</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder='Amount (USD)'
                placeholderTextColor={palette.textSecondary}
                keyboardType='numeric'
              />
              {totpEnabled ? (
                <>
                  <Text style={styles.withdrawSectionLabel}>Authenticator (required for withdraw)</Text>
                  <TextInput
                    style={styles.input}
                    value={cashWithdrawTotpCode}
                    onChangeText={setCashWithdrawTotpCode}
                    placeholder='6-digit code'
                    placeholderTextColor={palette.textSecondary}
                    keyboardType='number-pad'
                    maxLength={10}
                  />
                </>
              ) : null}
              <View style={styles.actions}>
                <PrimaryButton label='Deposit' onPress={onCashDeposit} style={{ flex: 1 }} disabled={!cashAmountOk} />
                <View style={{ width: 8 }} />
                <PrimaryButton
                  label='Withdraw'
                  onPress={onCashWithdraw}
                  variant='danger'
                  style={{ flex: 1 }}
                  disabled={!cashAmountOk || !cashWithdrawTotpOk}
                />
              </View>
            </Card>

            <Card>
              <Text style={styles.label}>Transaction History</Text>
              {transactions.map((t) => (
                <Text key={t.id} style={styles.item}>
                  {t.type.toUpperCase()} ${Number(t.amount).toFixed(2)} - {t.status} -{' '}
                  {new Date(t.created_at).toLocaleDateString()}
                </Text>
              ))}
              {!transactions.length && <Text style={styles.item}>No transactions yet</Text>}
            </Card>
          </>
        ) : (
          <>
            {npError ? (
              <Card>
                <Text style={styles.errorText}>{npError}</Text>
                <PrimaryButton label='Retry' onPress={() => void refreshNowpayments()} />
              </Card>
            ) : null}

            <Card style={styles.heroCard}>
              <Text style={styles.heroCaption}>Crypto balances (NOWPayments)</Text>
              {npSummary?.balances?.length ? (
                npSummary.balances.map((b) => (
                  <View key={b.asset} style={styles.balanceRow}>
                    <Text style={styles.assetLabel}>{b.asset.toUpperCase()}</Text>
                    <Text style={styles.assetValue}>{b.available}</Text>
                    {Number(b.reserved) > 0 ? (
                      <Text style={styles.assetSub}>Reserved: {b.reserved}</Text>
                    ) : null}
                  </View>
                ))
              ) : (
                <Text style={styles.item}>No crypto balance yet. Create a deposit below.</Text>
              )}
              <View style={styles.quickActionsRow}>
                <PrimaryButton label='Deposit' onPress={() => setDepositModalOpen(true)} style={{ flex: 1 }} />
                <View style={{ width: 8 }} />
                <PrimaryButton label='Withdraw' onPress={() => setWithdrawModalOpen(true)} style={{ flex: 1 }} />
              </View>
            </Card>

            <Card>
              <Text style={styles.sectionTitle}>Recent activity</Text>
              {npSummary?.ledger?.slice(0, 12).map((e) => (
                <Text key={e.id} style={styles.item}>
                  {e.direction.toUpperCase()} {e.amount} {e.asset} ({e.source})
                </Text>
              ))}
              {!npSummary?.ledger?.length && <Text style={styles.item}>No ledger entries yet</Text>}
            </Card>

            <Card>
              <Text style={styles.sectionTitle}>Pending deposits</Text>
              {npSummary?.payments
                ?.filter((p) => !['finished', 'failed', 'expired', 'refunded'].includes(p.status))
                .map((p) => (
                  <Text key={p.id} style={styles.item}>
                    {p.payCurrency} {p.payAmount || p.priceAmount} — {p.status}
                  </Text>
                ))}
              {!npSummary?.payments?.some(
                (p) => !['finished', 'failed', 'expired', 'refunded'].includes(p.status)
              ) && <Text style={styles.item}>None</Text>}
            </Card>
          </>
        )}
      </ScrollView>

      {copyToast ? (
        <View style={styles.toastWrap}>
          <Text style={styles.toastText}>{copyToast}</Text>
        </View>
      ) : null}

      <Modal visible={depositModalOpen} transparent animationType='fade' onRequestClose={() => setDepositModalOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 24 : 0}
        >
          <View style={{ flex: 1 }}>
            <Pressable
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              onPress={() => {
                Keyboard.dismiss();
                setDepositModalOpen(false);
              }}
            />
            <View pointerEvents='box-none' style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', padding: 20 }]}>
              <ScrollView keyboardShouldPersistTaps='handled' style={{ maxHeight: '92%' }} showsVerticalScrollIndicator={false}>
                <View style={styles.modalCard}>
                  <Text style={styles.modalTitle}>Crypto deposit</Text>
                  {!activeDeposit ? (
                    <>
                      <Text style={styles.hint}>Amount is priced in USD; you pay in the selected cryptocurrency.</Text>
                      <TextInput
                        style={styles.input}
                        value={depositUsdAmount}
                        onChangeText={setDepositUsdAmount}
                        placeholder='Amount in USD'
                        placeholderTextColor={palette.textSecondary}
                        keyboardType='numeric'
                      />
                      <Text style={styles.withdrawSectionLabel}>Pay with</Text>
                      <View style={styles.row}>
                        {PAY_CURRENCY_OPTIONS.map((c) => (
                          <Text
                            key={c}
                            style={[styles.pill, depositPayCurrency === c && styles.active]}
                            onPress={() => setDepositPayCurrency(c)}
                          >
                            {c}
                          </Text>
                        ))}
                      </View>
                      <PrimaryButton label='Create payment' onPress={() => void onCreateCryptoDeposit()} />
                    </>
                  ) : (
                    <>
                      <Text style={styles.item}>Status: {payStatus}</Text>
                      <Text style={styles.item}>
                        Send {payAmount || '—'} {activeDeposit.payCurrency} to:
                      </Text>
                      <Text style={styles.modalMono}>{payAddress || 'Address pending…'}</Text>
                      {payAddress ? (
                        <View style={styles.qrWrap}>
                          <QRCode value={payAddress} size={140} color='#111827' backgroundColor='white' />
                        </View>
                      ) : null}
                      <PrimaryButton
                        label='Copy address'
                        onPress={() => {
                          if (payAddress) void onCopyAddress(payAddress);
                        }}
                        disabled={!payAddress}
                      />
                      <PrimaryButton label='Refresh status' onPress={() => void pollActiveDeposit()} style={{ marginTop: 8 }} />
                      {depositStatus?.ledgerCredited ? (
                        <Text style={styles.hint}>Payment credited to your crypto balance.</Text>
                      ) : null}
                      <PrimaryButton
                        label='New deposit'
                        onPress={() => {
                          setActiveDeposit(null);
                          setDepositStatus(null);
                          setDepositUsdAmount('');
                        }}
                        style={{ marginTop: 8 }}
                      />
                    </>
                  )}
                  <PrimaryButton label='Close' onPress={() => setDepositModalOpen(false)} style={{ marginTop: 12 }} />
                </View>
              </ScrollView>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={withdrawModalOpen} transparent animationType='fade' onRequestClose={() => setWithdrawModalOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top + 24 : 0}
        >
          <View style={{ flex: 1 }}>
            <Pressable
              style={[StyleSheet.absoluteFillObject, { backgroundColor: 'rgba(0,0,0,0.6)' }]}
              onPress={() => {
                Keyboard.dismiss();
                setWithdrawModalOpen(false);
              }}
            />
            <View pointerEvents='box-none' style={[StyleSheet.absoluteFillObject, { justifyContent: 'center', padding: 20 }]}>
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Crypto withdraw</Text>
                <Text style={styles.hint}>Requires NOWPayments custody balance on the merchant account.</Text>
                <TextInput
                  style={styles.input}
                  value={withdrawAmount}
                  onChangeText={setWithdrawAmount}
                  placeholder='Amount'
                  placeholderTextColor={palette.textSecondary}
                  keyboardType='numeric'
                />
                <Text style={styles.withdrawSectionLabel}>Currency</Text>
                <View style={styles.row}>
                  {PAY_CURRENCY_OPTIONS.map((c) => (
                    <Text
                      key={c}
                      style={[styles.pill, withdrawCurrency === c && styles.active]}
                      onPress={() => setWithdrawCurrency(c)}
                    >
                      {c}
                    </Text>
                  ))}
                </View>
                <TextInput
                  style={styles.input}
                  value={withdrawAddress}
                  onChangeText={setWithdrawAddress}
                  placeholder='Destination address'
                  placeholderTextColor={palette.textSecondary}
                  autoCapitalize='none'
                />
                {totpEnabled ? (
                  <TextInput
                    style={styles.input}
                    value={withdrawTotpCode}
                    onChangeText={setWithdrawTotpCode}
                    placeholder='Authenticator code'
                    placeholderTextColor={palette.textSecondary}
                    keyboardType='number-pad'
                    maxLength={10}
                  />
                ) : null}
                <PrimaryButton label='Submit withdrawal' onPress={() => void onCryptoWithdraw()} disabled={!cryptoWithdrawReady} />
                <PrimaryButton label='Cancel' onPress={() => setWithdrawModalOpen(false)} style={{ marginTop: 8 }} />
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
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
  withdrawSectionLabel: { color: palette.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 6, fontWeight: '600' },
  sectionTitle: { color: palette.textSecondary, marginBottom: 10, fontSize: 16, fontWeight: '700' },
  balance: { color: palette.textPrimary, fontSize: 34, fontWeight: '800' },
  input: { backgroundColor: palette.surfaceElevated, borderWidth: 1, borderColor: palette.border, color: palette.textPrimary, borderRadius: 12, padding: 10, marginBottom: 8 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  actions: { flexDirection: 'row' },
  pill: { color: palette.textPrimary, borderColor: palette.border, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  active: { borderColor: palette.primary, color: palette.primary },
  item: { color: palette.textPrimary, marginBottom: 6 },
  hint: { color: palette.textSecondary, marginTop: 8, fontSize: 12 },
  errorText: { color: '#f87171', marginBottom: 8 },
  heroCard: { paddingTop: 18, paddingBottom: 18 },
  heroCaption: { color: palette.textSecondary, marginBottom: 12, fontSize: 15 },
  balanceRow: { marginBottom: 10 },
  assetLabel: { color: palette.textSecondary, fontSize: 13 },
  assetValue: { color: palette.textPrimary, fontSize: 22, fontWeight: '700' },
  assetSub: { color: palette.textSecondary, fontSize: 12 },
  quickActionsRow: { flexDirection: 'row', marginTop: 12 },
  modalCard: {
    backgroundColor: palette.surface,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: palette.border,
    padding: 16,
  },
  modalTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 10 },
  modalMono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12, marginBottom: 8 },
  qrWrap: { alignItems: 'center', marginVertical: 12 },
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
