import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { NetworkGridCompact } from '../components/NetworkGridCompact';
import { OptionGrid } from '../components/OptionGrid';
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
  NowpaymentsSummary,
  WalletTransaction,
  WhitelistedWallet,
} from '../types';
import { palette } from '../theme/colors';
import { formatNetworkLabel, sanitizeUserFacingError } from '../utils/userFacingError';
import { ActivityListSkeleton, BalanceSkeleton } from '../components/Skeleton';
import { WalletActivityList } from '../components/WalletActivityList';
import {
  combinedWithdrawableForNetwork,
  findBalanceForNetwork,
  maxWithdrawableAmount,
} from '../utils/walletDisplay';
import {
  navigateToCryptoDepositPayment,
  navigateToTransactionDetail,
  navigateToTransactionHistory,
} from '../utils/navigationHelpers';
import { mergeAllWalletActivity } from '../utils/walletActivity';

const PAY_CURRENCY_OPTIONS = ['usdttrc20', 'btc', 'eth', 'ltc', 'trx'];
const WITHDRAW_CURRENCY_OPTIONS = ['usdttrc20', 'eth'] as const;

export function WalletScreen() {
  const navigation = useNavigation();
  const { showToast } = useToast();

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [cashTransactions, setCashTransactions] = useState<WalletTransaction[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const [npSummary, setNpSummary] = useState<NowpaymentsSummary | null>(null);
  const [npLoading, setNpLoading] = useState(true);
  const [npError, setNpError] = useState<string | null>(null);
  const [whitelistedWallets, setWhitelistedWallets] = useState<WhitelistedWallet[]>([]);
  const [selectedWhitelistId, setSelectedWhitelistId] = useState<string | null>(null);
  const [depositUsdAmount, setDepositUsdAmount] = useState('');
  const [depositPayCurrency, setDepositPayCurrency] = useState('usdttrc20');
  const [depositModalOpen, setDepositModalOpen] = useState(false);
  const [depositSubmitting, setDepositSubmitting] = useState(false);

  const [withdrawAmount, setWithdrawAmount] = useState('');
  const [withdrawCurrency, setWithdrawCurrency] = useState('usdttrc20');
  const [withdrawTotpCode, setWithdrawTotpCode] = useState('');
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false);
  const [withdrawSubmitting, setWithdrawSubmitting] = useState(false);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [withdrawModalMax, setWithdrawModalMax] = useState(0);
  const [withdrawModalCurrencyLabel, setWithdrawModalCurrencyLabel] = useState('USDT (TRC20)');
  const [complianceComplete, setComplianceComplete] = useState(false);
  const clientIpLoaded = useRef(false);

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
    } finally {
      setNpLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const cash = await walletService.getWallet();
      setCashTransactions(cash.transactions ?? []);
    } catch {
      setCashTransactions([]);
    }
    try {
      const totp = await authService.getTotpStatus();
      setTotpEnabled(Boolean(totp.enabled));
    } catch {
      setTotpEnabled(false);
    }
    await Promise.all([loadCompliance(), loadWhitelistedWallets(), refreshNowpayments()]);
  }, [loadCompliance, loadWhitelistedWallets, refreshNowpayments]);

  usePolling(refresh, 60000, !withdrawModalOpen && !depositModalOpen);

  useEffect(() => {
    if (clientIpLoaded.current) return;
    clientIpLoaded.current = true;
    void nowpaymentsService
      .getClientIp()
      .then((r) => setClientIp(r.ip && r.ip !== 'unknown' ? r.ip : null))
      .catch(() => setClientIp(null));
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onCreateDeposit = async () => {
    const priceAmount = Number(depositUsdAmount);
    if (!Number.isFinite(priceAmount) || priceAmount <= 0) {
      Alert.alert('Invalid amount', 'Enter a USD amount to deposit.');
      return;
    }
    try {
      setDepositSubmitting(true);
      setNpError(null);
      const created = await nowpaymentsService.createDeposit(priceAmount, depositPayCurrency, 'usd');
      setDepositModalOpen(false);
      setDepositUsdAmount('');
      navigateToCryptoDepositPayment(navigation, created);
    } catch (e: any) {
      Alert.alert('Deposit failed', sanitizeError(e?.message || 'Could not create payment'));
    } finally {
      setDepositSubmitting(false);
    }
  };

  const availableForWithdraw = combinedWithdrawableForNetwork(npSummary, withdrawCurrency);
  const maxWithdraw = maxWithdrawableAmount(availableForWithdraw);

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
    if (maxWithdraw > 0 && n > maxWithdraw) {
      Alert.alert(
        'Gas reserve required',
        `Keep at least 5% of your balance for network fees. Maximum withdrawable now: ${maxWithdraw.toFixed(6)}.`
      );
      return;
    }
    const totpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
    if (!totpOk) return;
    try {
      setWithdrawSubmitting(true);
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
    } finally {
      setWithdrawSubmitting(false);
    }
  };

  const openWithdrawModal = () => {
    if (!complianceComplete) {
      alertComplianceRequired();
      return;
    }
    const forCurrency = whitelistedWallets.filter((w) => w.currency === withdrawCurrency);
    if (forCurrency.length === 0) {
      Alert.alert('No whitelisted wallet', `Add a ${formatNetworkLabel(withdrawCurrency)} wallet in Settings first.`);
      return;
    }
    const nextId =
      selectedWhitelistId && forCurrency.some((w) => w.id === selectedWhitelistId)
        ? selectedWhitelistId
        : forCurrency[0].id;
    const snapMax = maxWithdrawableAmount(combinedWithdrawableForNetwork(npSummary, withdrawCurrency));
    setSelectedWhitelistId(nextId ?? null);
    setWithdrawModalMax(snapMax);
    setWithdrawModalCurrencyLabel(formatNetworkLabel(withdrawCurrency));
    setWithdrawSubmitting(false);
    setWithdrawModalOpen(true);
  };

  function sanitizeError(raw: string) {
    return sanitizeUserFacingError(raw, 'Service temporarily unavailable. Please try again.');
  }

  const walletsForWithdrawCurrency = whitelistedWallets.filter((w) => w.currency === withdrawCurrency);
  const withdrawTotpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
  const withdrawNum = Number(withdrawAmount);
  const gasMax = withdrawModalOpen ? withdrawModalMax : maxWithdraw;
  const withinGasReserve = gasMax <= 0 || !Number.isFinite(withdrawNum) || withdrawNum <= gasMax;
  const withdrawReady =
    withdrawAmount.trim().length > 0 &&
    Number.isFinite(withdrawNum) &&
    withdrawNum > 0 &&
    withinGasReserve &&
    Boolean(selectedWhitelistId) &&
    walletsForWithdrawCurrency.some((w) => w.id === selectedWhitelistId) &&
    withdrawTotpOk;

  const allActivity = useMemo(
    () => mergeAllWalletActivity(npSummary, cashTransactions),
    [npSummary, cashTransactions]
  );
  const recentActivity = useMemo(() => allActivity.slice(0, 5), [allActivity]);
  const walletLoading = npLoading && !npSummary && !npError;

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

        <Card style={styles.gasCard}>
          <Text style={styles.gasTitle}>Network fee reserve</Text>
          <Text style={styles.gasText}>
            Leave at least 5% of your wallet balance for blockchain gas fees. If you withdraw everything at once, you may not be
            able to deposit again until you add funds back to cover fees.
          </Text>
          {!totpEnabled ? (
            <Text style={styles.gasText}>Enable two-factor authentication in Settings for stronger withdrawal protection.</Text>
          ) : null}
        </Card>

        {walletLoading ? (
          <BalanceSkeleton />
        ) : (
          <Card style={styles.heroCard}>
            <Text style={styles.heroCaption}>Wallet balances</Text>
            {npSummary?.balances?.length || (npSummary?.cashWalletUsd ?? 0) > 0 ? (
              <>
                {(npSummary?.cashWalletUsd ?? 0) > 0 ? (
                  <View key='cash-wallet' style={styles.balanceRow}>
                    <Text style={styles.assetLabel}>CASH (USD)</Text>
                    <Text style={styles.assetValue}>{npSummary!.cashWalletUsd!.toFixed(2)}</Text>
                    <Text style={styles.assetSub}>Withdrawable as USDT to whitelisted addresses</Text>
                  </View>
                ) : null}
                {npSummary?.balances?.map((b) => (
                  <View key={b.asset} style={styles.balanceRow}>
                    <Text style={styles.assetLabel}>{b.asset.toUpperCase()}</Text>
                    <Text style={styles.assetValue}>{b.available}</Text>
                    {Number(b.reserved) > 0 ? <Text style={styles.assetSub}>Reserved: {b.reserved}</Text> : null}
                  </View>
                ))}
              </>
            ) : (
              <Text style={styles.item}>No balance yet. Deposit crypto to get started.</Text>
            )}
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
        )}

        {walletLoading && !allActivity.length ? (
          <ActivityListSkeleton rows={5} />
        ) : (
          <Card style={styles.activityCard}>
            <View style={styles.activityHeader}>
              <Text style={styles.sectionTitle}>Recent activity</Text>
              {allActivity.length > 5 ? (
                <Pressable onPress={() => navigateToTransactionHistory(navigation)}>
                  <Text style={styles.moreLink}>More</Text>
                </Pressable>
              ) : null}
            </View>
            <WalletActivityList
              rows={recentActivity}
              variant='compact'
              emptyMessage='No activity yet.'
              onPressRow={(row) => navigateToTransactionDetail(navigation, row)}
            />
            {allActivity.length > 0 && allActivity.length <= 5 ? (
              <PrimaryButton
                label='View all transactions'
                onPress={() => navigateToTransactionHistory(navigation)}
                style={{ marginTop: 12 }}
              />
            ) : null}
          </Card>
        )}
      </ScrollView>

      <FormModal visible={depositModalOpen} title='Deposit' onClose={() => setDepositModalOpen(false)}>
        <Text style={styles.hint}>Amount is priced in USD; you pay in the selected network.</Text>
        <TextInput
          style={inputStyle}
          value={depositUsdAmount}
          onChangeText={setDepositUsdAmount}
          placeholder='Amount in USD'
          placeholderTextColor={palette.textSecondary}
          keyboardType='numeric'
        />
        <Text style={styles.fieldLabel}>Network</Text>
        <NetworkGridCompact
          options={PAY_CURRENCY_OPTIONS}
          value={depositPayCurrency}
          onChange={setDepositPayCurrency}
          formatLabel={formatNetworkLabel}
          featuredOptions={['usdttrc20', 'eth']}
        />
        <PrimaryButton
          label={depositSubmitting ? 'Creating…' : 'Create payment'}
          onPress={() => void onCreateDeposit()}
          disabled={depositSubmitting}
        />
      </FormModal>

      <FormModal
        visible={withdrawModalOpen}
        title='Withdraw'
        avoidKeyboard={false}
        onClose={() => setWithdrawModalOpen(false)}
      >
        <Text style={styles.hint}>Withdraw to a whitelisted address from Settings.</Text>
        <View style={styles.ipSlot}>
          <Text style={styles.ipText}>
            {clientIp
              ? `Your IP: ${clientIp}\nIf withdrawals fail, ask support to whitelist this IP for payouts.`
              : 'Loading your IP…'}
          </Text>
        </View>
        <Text style={styles.gasTextModal}>
          Keep 5% in your wallet for gas. Max withdrawable:{' '}
          {withdrawModalMax > 0 ? withdrawModalMax.toFixed(6) : '—'} {withdrawModalCurrencyLabel}. Emptying the wallet
          can block future deposits.
        </Text>
        <TextInput
          style={inputStyle}
          value={withdrawAmount}
          onChangeText={setWithdrawAmount}
          placeholder='Amount'
          placeholderTextColor={palette.textSecondary}
          keyboardType='numeric'
        />
        <Text style={styles.fieldLabel}>Network</Text>
        <OptionGrid
          options={WITHDRAW_CURRENCY_OPTIONS}
          value={withdrawCurrency as (typeof WITHDRAW_CURRENCY_OPTIONS)[number]}
          onChange={(c) => {
            setWithdrawCurrency(c);
            setWithdrawModalCurrencyLabel(formatNetworkLabel(c));
            setWithdrawModalMax(maxWithdrawableAmount(combinedWithdrawableForNetwork(npSummary, c)));
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
        <PrimaryButton
          label={withdrawSubmitting ? 'Submitting…' : 'Submit withdrawal'}
          onPress={() => void onWithdraw()}
          disabled={!withdrawReady || withdrawSubmitting}
        />
      </FormModal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  label: { color: palette.textSecondary, marginBottom: 8 },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 6, fontWeight: '600' },
  sectionTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  activityHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  moreLink: { color: palette.primary, fontSize: 14, fontWeight: '700' },
  activityCard: { paddingTop: 16, paddingBottom: 8 },
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
  complianceBanner: { marginBottom: 12, borderColor: '#f59e0b' },
  complianceBannerText: { color: palette.textPrimary, fontSize: 13, lineHeight: 18 },
  gasCard: { marginBottom: 12, borderColor: palette.primary, borderLeftWidth: 3 },
  gasTitle: { color: palette.primary, fontWeight: '700', marginBottom: 6, fontSize: 14 },
  gasText: { color: palette.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  gasTextModal: { color: '#fbbf24', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  ipSlot: { minHeight: 52, marginBottom: 10, justifyContent: 'center' },
  ipText: { color: palette.textSecondary, fontSize: 11, lineHeight: 16 },
});
