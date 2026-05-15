import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { OptionHighlightList } from '../components/OptionHighlightList';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { useToast } from '../hooks/useToast';
import { authService } from '../services/authService';
import { complianceService, isComplianceRequiredError } from '../services/complianceService';
import { nowpaymentsService } from '../services/nowpaymentsService';
import { whitelistWalletService } from '../services/whitelistWalletService';
import { walletService } from '../services/walletService';
import {
  NowpaymentsCreateDepositResponse,
  NowpaymentsDepositStatus,
  NowpaymentsSummary,
  WhitelistedWallet,
} from '../types';
import { palette } from '../theme/colors';
import { formatNetworkLabel, sanitizeUserFacingError } from '../utils/userFacingError';

const PAY_CURRENCY_OPTIONS = ['usdttrc20', 'btc', 'eth', 'ltc', 'trx'];

export function WalletScreen() {
  const { showToast } = useToast();

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [tradingBalance, setTradingBalance] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [npSummary, setNpSummary] = useState<NowpaymentsSummary | null>(null);
  const [npError, setNpError] = useState<string | null>(null);
  const [whitelistedWallets, setWhitelistedWallets] = useState<WhitelistedWallet[]>([]);
  const [selectedWhitelistId, setSelectedWhitelistId] = useState<string | null>(null);
  const depositCreditedToastShown = useRef(false);

  const [depositUsdAmount, setDepositUsdAmount] = useState('');
  const [depositPayCurrency, setDepositPayCurrency] = useState('usdttrc20');
  const [activeDeposit, setActiveDeposit] = useState<NowpaymentsCreateDepositResponse | null>(null);
  const [depositStatus, setDepositStatus] = useState<NowpaymentsDepositStatus | null>(null);
  const [depositModalOpen, setDepositModalOpen] = useState(false);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawCurrency, setWithdrawCurrency] = useState('usdttrc20');
  const [withdrawTotpCode, setWithdrawTotpCode] = useState('');
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [complianceComplete, setComplianceComplete] = useState(false);

  const alertComplianceRequired = () => {
    Alert.alert(
      'Profile required',
      'Complete your compliance profile in Settings before withdrawing.',
      [{ text: 'OK' }]
    );
  };

  const loadCompliance = useCallback(async () => {
    try {
      const data = await complianceService.getProfile();
      setComplianceComplete(Boolean(data.complete));
    } catch {
      setComplianceComplete(false);
    }
  }, []);

  const loadWhitelistedWallets = useCallback(async () => {
    try {
      const data = await whitelistWalletService.list();
      setWhitelistedWallets(data.wallets || []);
    } catch {
      setWhitelistedWallets([]);
    }
  }, []);

  const refreshNowpayments = useCallback(async () => {
    setNpError(null);
    try {
      const summary = await nowpaymentsService.getSummary();
      setNpSummary(summary);
    } catch (e: any) {
      setNpError(sanitizeError(e?.message || 'Failed to load wallet'));
      setNpSummary(null);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const cash = await walletService.getWallet();
      setTradingBalance(cash.balance);
    } catch {
      setTradingBalance(null);
    }
    try {
      const totp = await authService.getTotpStatus();
      setTotpEnabled(Boolean(totp.enabled));
    } catch {
      setTotpEnabled(false);
    }
    await Promise.all([loadCompliance(), loadWhitelistedWallets(), refreshNowpayments()]);
  }, [loadCompliance, loadWhitelistedWallets, refreshNowpayments]);

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
        if (status.ledgerCredited && !depositCreditedToastShown.current) {
          depositCreditedToastShown.current = true;
          showToast('Deposit credited to your wallet');
        }
      }
    } catch {
      // ignore poll errors
    }
  }, [activeDeposit?.id, refreshNowpayments, showToast]);

  useEffect(() => {
    if (!depositModalOpen || !activeDeposit?.id) return;
    void pollActiveDeposit();
    const t = setInterval(() => void pollActiveDeposit(), 15000);
    return () => clearInterval(t);
  }, [depositModalOpen, activeDeposit?.id, pollActiveDeposit]);

  const onCreateDeposit = async () => {
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
      depositCreditedToastShown.current = false;
      await refreshNowpayments();
      showToast('Payment created — send crypto to the address shown');
    } catch (e: any) {
      Alert.alert('Deposit failed', sanitizeError(e?.message || 'Could not create payment'));
    }
  };

  const onWithdraw = async () => {
    if (!complianceComplete) {
      alertComplianceRequired();
      return;
    }
    const selected = whitelistedWallets.find((w) => w.id === selectedWhitelistId);
    if (!selected) {
      Alert.alert('Select wallet', 'Add and select a whitelisted wallet in Settings.');
      return;
    }
    const n = Number(withdrawAmount);
    if (!Number.isFinite(n) || n <= 0) return;
    const totpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
    if (!totpOk) return;
    try {
      setNpError(null);
      await nowpaymentsService.createWithdrawal(
        selected.currency,
        selected.address,
        n,
        totpEnabled ? withdrawTotpCode.replace(/\s/g, '') : undefined
      );
      setWithdrawAmount('');
      setSelectedWhitelistId(null);
      setWithdrawTotpCode('');
      setWithdrawModalOpen(false);
      await refreshNowpayments();
      showToast('Withdrawal submitted');
    } catch (e: any) {
      if (isComplianceRequiredError(e)) alertComplianceRequired();
      else Alert.alert('Withdraw failed', sanitizeError(e?.message || 'Withdrawal failed'));
    }
  };

  const openWithdrawModal = () => {
    if (!complianceComplete) {
      alertComplianceRequired();
      return;
    }
    const forCurrency = whitelistedWallets.filter((w) => w.currency === withdrawCurrency);
    if (forCurrency.length === 0) {
      Alert.alert('No whitelisted wallet', `Add a ${withdrawCurrency} wallet in Settings first.`);
      return;
    }
    if (!selectedWhitelistId || !forCurrency.some((w) => w.id === selectedWhitelistId)) {
      setSelectedWhitelistId(forCurrency[0].id);
    }
    setWithdrawModalOpen(true);
  };

  const onCopyAddress = async (addr: string) => {
    try {
      await Clipboard.setStringAsync(addr);
      showToast('Address copied');
    } catch {
      Alert.alert('Copy failed', 'Could not copy address.');
    }
  };

  function sanitizeError(raw: string) {
    return sanitizeUserFacingError(raw, 'Service temporarily unavailable. Please try again.');
  }

  const walletsForWithdrawCurrency = whitelistedWallets.filter((w) => w.currency === withdrawCurrency);
  const withdrawTotpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
  const withdrawReady =
    withdrawAmount.trim().length > 0 &&
    Number.isFinite(Number(withdrawAmount)) &&
    Number(withdrawAmount) > 0 &&
    Boolean(selectedWhitelistId) &&
    walletsForWithdrawCurrency.some((w) => w.id === selectedWhitelistId) &&
    withdrawTotpOk;

  const payAddress = depositStatus?.payAddress || activeDeposit?.payAddress;
  const payAmount = depositStatus?.payAmount || activeDeposit?.payAmount;
  const payStatus = depositStatus?.status || activeDeposit?.status || 'waiting';

  const inputStyle = {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  } as const;

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={{ padding: 16 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        {!complianceComplete ? (
          <Card style={styles.complianceBanner}>
            <Text style={styles.complianceBannerText}>
              Complete your compliance profile in Settings before you can withdraw.
            </Text>
          </Card>
        ) : null}

        {npError ? (
          <Card>
            <Text style={styles.errorText}>{npError}</Text>
            <PrimaryButton label='Retry' onPress={() => void refreshNowpayments()} />
          </Card>
        ) : null}

        <Card style={styles.heroCard}>
          <Text style={styles.heroCaption}>Wallet balances</Text>
          {npSummary?.balances?.length ? (
            npSummary.balances.map((b) => (
              <View key={b.asset} style={styles.balanceRow}>
                <Text style={styles.assetLabel}>{b.asset.toUpperCase()}</Text>
                <Text style={styles.assetValue}>{b.available}</Text>
                {Number(b.reserved) > 0 ? <Text style={styles.assetSub}>Reserved: {b.reserved}</Text> : null}
              </View>
            ))
          ) : (
            <Text style={styles.item}>No balance yet. Deposit crypto to get started.</Text>
          )}
          {tradingBalance != null && tradingBalance > 0 ? (
            <Text style={styles.hint}>
              Trading balance (airfarming / contracts): ${tradingBalance.toFixed(2)} USD — separate from crypto wallet.
            </Text>
          ) : null}
          <View style={styles.quickActionsRow}>
            <PrimaryButton label='Deposit' onPress={() => setDepositModalOpen(true)} style={{ flex: 1 }} />
            <View style={{ width: 8 }} />
            <PrimaryButton
              label='Withdraw'
              onPress={openWithdrawModal}
              style={{ flex: 1 }}
              disabled={!complianceComplete}
            />
          </View>
        </Card>

        <Card>
          <Text style={styles.sectionTitle}>Recent activity</Text>
          {npSummary?.ledger?.slice(0, 12).map((e) => (
            <Text key={e.id} style={styles.item}>
              {e.direction.toUpperCase()} {e.amount} {e.asset} ({e.source})
            </Text>
          ))}
          {!npSummary?.ledger?.length && <Text style={styles.item}>No activity yet</Text>}
        </Card>
      </ScrollView>

      <FormModal
        visible={depositModalOpen}
        title='Deposit'
        onClose={() => setDepositModalOpen(false)}
        footer={
          activeDeposit ? (
            <PrimaryButton label='Close' onPress={() => setDepositModalOpen(false)} style={{ marginTop: 12 }} />
          ) : undefined
        }
      >
        {!activeDeposit ? (
          <>
            <Text style={styles.hint}>Amount is priced in USD; you pay in the selected cryptocurrency.</Text>
            <TextInput
              style={inputStyle}
              value={depositUsdAmount}
              onChangeText={setDepositUsdAmount}
              placeholder='Amount in USD'
              placeholderTextColor={palette.textSecondary}
              keyboardType='numeric'
            />
            <Text style={styles.fieldLabel}>Network</Text>
            <OptionHighlightList
              options={PAY_CURRENCY_OPTIONS}
              value={depositPayCurrency}
              onChange={setDepositPayCurrency}
              formatLabel={formatNetworkLabel}
            />
            <PrimaryButton label='Create payment' onPress={() => void onCreateDeposit()} />
          </>
        ) : (
          <>
            <Text style={styles.item}>Status: {payStatus}</Text>
            <Text style={styles.item}>
              Send {payAmount || '—'} {activeDeposit.payCurrency} to:
            </Text>
            <Text style={styles.mono}>{payAddress || 'Address pending…'}</Text>
            {payAddress ? (
              <View style={styles.qrWrap}>
                <QRCode value={payAddress} size={140} color='#111827' backgroundColor='white' />
              </View>
            ) : null}
            <PrimaryButton label='Copy address' onPress={() => payAddress && void onCopyAddress(payAddress)} disabled={!payAddress} />
            <PrimaryButton label='Refresh status' onPress={() => void pollActiveDeposit()} style={{ marginTop: 8 }} />
            <PrimaryButton
              label='New deposit'
              onPress={() => {
                setActiveDeposit(null);
                setDepositStatus(null);
                setDepositUsdAmount('');
                depositCreditedToastShown.current = false;
              }}
              style={{ marginTop: 8 }}
            />
          </>
        )}
      </FormModal>

      <FormModal visible={withdrawModalOpen} title='Withdraw' onClose={() => setWithdrawModalOpen(false)}>
        <Text style={styles.hint}>Withdraw to a whitelisted address from Settings.</Text>
        <TextInput
          style={inputStyle}
          value={withdrawAmount}
          onChangeText={setWithdrawAmount}
          placeholder='Amount'
          placeholderTextColor={palette.textSecondary}
          keyboardType='numeric'
        />
        <Text style={styles.fieldLabel}>Network</Text>
        <OptionHighlightList
          options={PAY_CURRENCY_OPTIONS}
          value={withdrawCurrency}
          onChange={(c) => {
            setWithdrawCurrency(c);
            const first = whitelistedWallets.find((w) => w.currency === c);
            setSelectedWhitelistId(first?.id ?? null);
          }}
          formatLabel={formatNetworkLabel}
        />
        <Text style={styles.fieldLabel}>Whitelisted wallet</Text>
        {walletsForWithdrawCurrency.length ? (
          <OptionHighlightList
            options={walletsForWithdrawCurrency.map((w) => w.id!)}
            value={selectedWhitelistId || walletsForWithdrawCurrency[0].id!}
            onChange={setSelectedWhitelistId}
            formatLabel={(id) => {
              const w = whitelistedWallets.find((x) => x.id === id);
              return w?.label || formatNetworkLabel(w?.currency || withdrawCurrency);
            }}
          />
        ) : (
          <Text style={styles.hint}>Add a {formatNetworkLabel(withdrawCurrency)} wallet in Settings.</Text>
        )}
        {selectedWhitelistId ? (
          <Text style={styles.mono}>{whitelistedWallets.find((w) => w.id === selectedWhitelistId)?.address}</Text>
        ) : null}
        {totpEnabled ? (
          <TextInput
            style={inputStyle}
            value={withdrawTotpCode}
            onChangeText={setWithdrawTotpCode}
            placeholder='Authenticator code'
            placeholderTextColor={palette.textSecondary}
            keyboardType='number-pad'
            maxLength={10}
          />
        ) : null}
        <PrimaryButton label='Submit withdrawal' onPress={() => void onWithdraw()} disabled={!withdrawReady} />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 6, fontWeight: '600' },
  sectionTitle: { color: palette.textSecondary, marginBottom: 10, fontSize: 16, fontWeight: '700' },
  item: { color: palette.textPrimary, marginBottom: 6 },
  hint: { color: palette.textSecondary, marginTop: 4, marginBottom: 8, fontSize: 12 },
  errorText: { color: '#f87171', marginBottom: 8 },
  heroCard: { paddingTop: 18, paddingBottom: 18 },
  heroCaption: { color: palette.textSecondary, marginBottom: 12, fontSize: 15 },
  balanceRow: { marginBottom: 10 },
  assetLabel: { color: palette.textSecondary, fontSize: 13 },
  assetValue: { color: palette.textPrimary, fontSize: 22, fontWeight: '700' },
  assetSub: { color: palette.textSecondary, fontSize: 12 },
  quickActionsRow: { flexDirection: 'row', marginTop: 12 },
  mono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12, marginBottom: 8 },
  qrWrap: { alignItems: 'center', marginVertical: 12 },
  complianceBanner: { marginBottom: 12, borderColor: '#f59e0b' },
  complianceBannerText: { color: palette.textPrimary, fontSize: 13, lineHeight: 18 },
});
