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
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { NetworkGridCompact } from '../components/NetworkGridCompact';
import { OptionGrid } from '../components/OptionGrid';
import { OptionHighlightList } from '../components/OptionHighlightList';
import { PrimaryButton } from '../components/PrimaryButton';
import { WithdrawalProgressSteps } from '../components/WithdrawalProgressSteps';
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
  maxWithdrawableAmount,
  sumUsdtFamilyAvailable,
} from '../utils/walletDisplay';
import {
  navigateToAirfarmingTrade,
  navigateToCryptoDepositPayment,
  navigateToSendById,
  navigateToSupport,
  navigateToTransactionDetail,
  navigateToTransactionHistory,
  navigateToVipFarmersTrade,
} from '../utils/navigationHelpers';
import { mergeAllWalletActivity } from '../utils/walletActivity';

const PAY_CURRENCY_OPTIONS = ['usdttrc20', 'btc', 'eth', 'ltc', 'trx'];
const WITHDRAW_CURRENCY_OPTIONS = ['usdttrc20', 'eth'] as const;
const GAS_BANNER_DISMISS_PREFIX = 'ema_wallet_gas_banner_dismissed_';

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function WalletScreen() {
  const navigation = useNavigation();
  const { user } = useAuth();
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
  const [withdrawShowProgress, setWithdrawShowProgress] = useState(false);
  const [withdrawProgressStep, setWithdrawProgressStep] = useState(0);
  const [withdrawProgressError, setWithdrawProgressError] = useState<string | null>(null);
  const [clientIp, setClientIp] = useState<string | null>(null);
  const [withdrawModalMax, setWithdrawModalMax] = useState(0);
  const [withdrawModalCurrencyLabel, setWithdrawModalCurrencyLabel] = useState('USDT (TRC20)');
  const [complianceComplete, setComplianceComplete] = useState(false);
  const [gasBannerDismissed, setGasBannerDismissed] = useState(false);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const clientIpLoaded = useRef(false);

  const gasDismissKey = user?.id ? `${GAS_BANNER_DISMISS_PREFIX}${user.id}` : null;

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

  usePolling(refresh, 60000, !withdrawModalOpen && !depositModalOpen && !transferModalOpen);

  useEffect(() => {
    if (!gasDismissKey) {
      setGasBannerDismissed(false);
      return;
    }
    void AsyncStorage.getItem(gasDismissKey).then((v) => setGasBannerDismissed(v === '1'));
  }, [gasDismissKey]);

  const dismissGasBanner = async () => {
    if (gasDismissKey) await AsyncStorage.setItem(gasDismissKey, '1');
    setGasBannerDismissed(true);
  };

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

  const ensureClientIp = useCallback(async () => {
    if (clientIp) return clientIp;
    try {
      const r = await nowpaymentsService.getClientIp();
      const ip = r.ip && r.ip !== 'unknown' ? r.ip : null;
      setClientIp(ip);
      return ip;
    } catch {
      return null;
    }
  }, [clientIp]);

  const closeWithdrawModal = () => {
    if (withdrawSubmitting && withdrawShowProgress && withdrawProgressStep < 4 && !withdrawProgressError) {
      return;
    }
    setWithdrawModalOpen(false);
    setWithdrawShowProgress(false);
    setWithdrawProgressStep(0);
    setWithdrawProgressError(null);
    setWithdrawSubmitting(false);
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
    if (maxWithdraw > 0 && n > maxWithdraw) {
      Alert.alert(
        'Gas reserve required',
        `Keep at least 5% of your balance for network fees. Maximum withdrawable now: ${Math.floor(maxWithdraw)}.`
      );
      return;
    }
    const totpOk = !totpEnabled || withdrawTotpCode.replace(/\s/g, '').length >= 6;
    if (!totpOk) return;

    setWithdrawSubmitting(true);
    setWithdrawShowProgress(true);
    setWithdrawProgressStep(0);
    setWithdrawProgressError(null);
    setNpError(null);

    try {
      setWithdrawProgressStep(0);
      await delay(650);

      setWithdrawProgressStep(1);
      await delay(800);

      setWithdrawProgressStep(2);
      await ensureClientIp();
      await delay(900);

      setWithdrawProgressStep(3);
      await nowpaymentsService.createWithdrawal(
        selected.currency,
        selected.address,
        n,
        totpEnabled ? withdrawTotpCode.replace(/\s/g, '') : undefined
      );

      setWithdrawProgressStep(4);
      await delay(1400);

      setWithdrawAmount('');
      setSelectedWhitelistId(null);
      setWithdrawTotpCode('');
      setWithdrawModalOpen(false);
      setWithdrawShowProgress(false);
      setWithdrawProgressStep(0);
      await refreshNowpayments();
      showToast('Withdrawal submitted');
    } catch (e: any) {
      if (isComplianceRequiredError(e)) {
        closeWithdrawModal();
        alertComplianceRequired();
      } else {
        setWithdrawProgressError(sanitizeError(e?.message || 'Withdrawal failed'));
      }
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
    setWithdrawShowProgress(false);
    setWithdrawProgressStep(0);
    setWithdrawProgressError(null);
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
  const totalUsd = useMemo(
    () => sumUsdtFamilyAvailable(npSummary?.balances, npSummary?.cashWalletUsd),
    [npSummary]
  );
  const reservedUsd = useMemo(() => {
    let r = 0;
    for (const b of npSummary?.balances || []) {
      if (b.asset.toLowerCase().includes('usdt') || b.asset === 'usdt') {
        r += Number(b.reserved ?? 0) || 0;
      }
    }
    return r;
  }, [npSummary]);

  const openTransferChooser = () => setTransferModalOpen(true);

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

        {!gasBannerDismissed ? (
          <Card style={styles.gasCard}>
            <View style={styles.gasHeader}>
              <Text style={styles.gasTitle}>Network fee reserve</Text>
              <Pressable onPress={() => void dismissGasBanner()} hitSlop={12} accessibilityLabel='Dismiss'>
                <Ionicons name='close' size={20} color={palette.textSecondary} />
              </Pressable>
            </View>
            <Text style={styles.gasText}>
              Leave at least 5% of your wallet balance for blockchain gas fees. If you withdraw everything at once, you may not be
              able to deposit again until you add funds back to cover fees.
            </Text>
            {!totpEnabled ? (
              <Text style={styles.gasText}>Enable two-factor authentication in Settings for stronger withdrawal protection.</Text>
            ) : null}
          </Card>
        ) : null}

        {walletLoading ? (
          <BalanceSkeleton />
        ) : (
          <Card style={styles.heroCard}>
            <Text style={styles.heroCaption}>Total balance</Text>
            <Text style={styles.totalBalance}>
              {totalUsd > 0 ? `$${totalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '$0.00'}
            </Text>
            <Text style={styles.totalSub}>USD · USDT</Text>
            {reservedUsd > 0 ? (
              <Text style={styles.assetSub}>Reserved for pending payouts: {Math.floor(reservedUsd)}</Text>
            ) : null}
            {totalUsd <= 0 ? (
              <Text style={styles.item}>No balance yet. Deposit crypto to get started.</Text>
            ) : null}
            <View style={styles.actionRow}>
              <Pressable
                style={styles.actionItem}
                onPress={openWithdrawModal}
                disabled={!complianceComplete}
                accessibilityLabel='Withdraw'
              >
                <View style={[styles.actionCircle, !complianceComplete && styles.actionCircleDisabled]}>
                  <Ionicons name='arrow-up' size={22} color={palette.textPrimary} />
                </View>
                <Text style={styles.actionLabel}>Withdraw</Text>
              </Pressable>
              <Pressable style={styles.actionItem} onPress={() => setDepositModalOpen(true)} accessibilityLabel='Deposit'>
                <View style={[styles.actionCircle, styles.actionCirclePrimary]}>
                  <Ionicons name='arrow-down' size={22} color='#fff' />
                </View>
                <Text style={styles.actionLabel}>Deposit</Text>
              </Pressable>
              <Pressable style={styles.actionItem} onPress={openTransferChooser} accessibilityLabel='Transfer'>
                <View style={styles.actionCircle}>
                  <Ionicons name='swap-horizontal' size={22} color={palette.textPrimary} />
                </View>
                <Text style={styles.actionLabel}>Transfer</Text>
              </Pressable>
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
        title={withdrawShowProgress ? 'Withdrawing' : 'Withdraw'}
        avoidKeyboard={false}
        onClose={closeWithdrawModal}
        footer={
          withdrawShowProgress ? (
            withdrawProgressError ? (
              <PrimaryButton
                label='Back to form'
                onPress={() => {
                  setWithdrawShowProgress(false);
                  setWithdrawProgressStep(0);
                  setWithdrawProgressError(null);
                }}
                style={{ marginTop: 12 }}
              />
            ) : (
              <View style={{ height: 0 }} />
            )
          ) : undefined
        }
      >
        {withdrawShowProgress ? (
          <>
            <Text style={styles.hint}>Please wait while we process your withdrawal.</Text>
            <WithdrawalProgressSteps
              activeIndex={withdrawProgressStep}
              clientIp={clientIp}
              errorMessage={withdrawProgressError}
            />
          </>
        ) : (
          <>
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
              {withdrawModalMax > 0 ? Math.floor(withdrawModalMax) : '—'} {withdrawModalCurrencyLabel}. Emptying the wallet
              can block future deposits.
            </Text>
            <Pressable onPress={() => navigateToSupport(navigation, { category: 'withdraw' })} style={styles.supportLinkWrap}>
              <Text style={styles.supportLinkText}>
                Having trouble withdrawing? <Text style={styles.supportLinkAccent}>Get help in Support</Text>
              </Text>
            </Pressable>
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
              label='Submit withdrawal'
              onPress={() => void onWithdraw()}
              disabled={!withdrawReady || withdrawSubmitting}
            />
          </>
        )}
      </FormModal>

      <FormModal visible={transferModalOpen} title='Transfer' onClose={() => setTransferModalOpen(false)}>
        <Text style={styles.hint}>Move funds between products or send to another member.</Text>
        <Pressable
          style={styles.transferOption}
          onPress={() => {
            setTransferModalOpen(false);
            navigateToSendById(navigation);
          }}
        >
          <Ionicons name='person-outline' size={22} color={palette.primary} />
          <View style={styles.transferOptionText}>
            <Text style={styles.transferOptionTitle}>Send to member</Text>
            <Text style={styles.transferOptionSub}>Transfer ID · trading USD balance</Text>
          </View>
          <Ionicons name='chevron-forward' size={20} color={palette.textSecondary} />
        </Pressable>
        <Pressable
          style={styles.transferOption}
          onPress={() => {
            setTransferModalOpen(false);
            navigateToAirfarmingTrade(navigation);
          }}
        >
          <Ionicons name='leaf-outline' size={22} color={palette.primary} />
          <View style={styles.transferOptionText}>
            <Text style={styles.transferOptionTitle}>Airfarmers</Text>
            <Text style={styles.transferOptionSub}>Move cash to or from airfarming</Text>
          </View>
          <Ionicons name='chevron-forward' size={20} color={palette.textSecondary} />
        </Pressable>
        <Pressable
          style={styles.transferOption}
          onPress={() => {
            setTransferModalOpen(false);
            navigateToVipFarmersTrade(navigation);
          }}
        >
          <Ionicons name='diamond-outline' size={22} color={palette.primary} />
          <View style={styles.transferOptionText}>
            <Text style={styles.transferOptionTitle}>Live VIP Farmers</Text>
            <Text style={styles.transferOptionSub}>Invest from your cash wallet</Text>
          </View>
          <Ionicons name='chevron-forward' size={20} color={palette.textSecondary} />
        </Pressable>
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
  heroCard: { paddingTop: 18, paddingBottom: 20 },
  heroCaption: { color: palette.textSecondary, marginBottom: 8, fontSize: 14 },
  totalBalance: { color: palette.textPrimary, fontSize: 34, fontWeight: '700', letterSpacing: -0.5 },
  totalSub: { color: palette.textSecondary, fontSize: 13, marginBottom: 4 },
  assetSub: { color: palette.textSecondary, fontSize: 12, marginBottom: 8 },
  actionRow: { flexDirection: 'row', justifyContent: 'space-around', marginTop: 20, paddingHorizontal: 4 },
  actionItem: { alignItems: 'center', minWidth: 72 },
  actionCircle: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  actionCirclePrimary: { backgroundColor: palette.primary, borderColor: palette.primary },
  actionCircleDisabled: { opacity: 0.45 },
  actionLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '600' },
  transferOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: 12,
  },
  transferOptionText: { flex: 1 },
  transferOptionTitle: { color: palette.textPrimary, fontSize: 15, fontWeight: '600' },
  transferOptionSub: { color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  gasHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  mono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12, marginBottom: 8 },
  complianceBanner: { marginBottom: 12, borderColor: '#f59e0b' },
  complianceBannerText: { color: palette.textPrimary, fontSize: 13, lineHeight: 18 },
  gasCard: { marginBottom: 12, borderColor: palette.primary, borderLeftWidth: 3 },
  gasTitle: { color: palette.primary, fontWeight: '700', marginBottom: 6, fontSize: 14 },
  gasText: { color: palette.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: 6 },
  gasTextModal: { color: '#fbbf24', fontSize: 12, lineHeight: 17, marginBottom: 10 },
  supportLinkWrap: { marginBottom: 8 },
  supportLinkText: { color: palette.textSecondary, fontSize: 11, lineHeight: 16 },
  supportLinkAccent: { color: palette.primary, fontWeight: '600' },
  ipSlot: { minHeight: 52, marginBottom: 10, justifyContent: 'center' },
  ipText: { color: palette.textSecondary, fontSize: 11, lineHeight: 16 },
});
