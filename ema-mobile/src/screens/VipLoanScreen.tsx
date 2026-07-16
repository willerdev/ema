import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  normalizeVipLoanStatus,
  vipFarmerService,
  type VipLoanStatus,
} from '../services/vipFarmerService';
import { whitelistWalletService } from '../services/whitelistWalletService';
import type { WhitelistedWallet } from '../types';
import { formatNetworkLabel } from '../utils/userFacingError';
import { navigateToVipFarmersTrade } from '../utils/navigationHelpers';
import { palette } from '../theme/colors';
import type { RootStackParamList } from '../types';

type Nav = NativeStackNavigationProp<RootStackParamList, 'VipLoan'>;
type Route = RouteProp<RootStackParamList, 'VipLoan'>;

function fmtUsd(n: unknown) {
  const value = Number(n);
  const safe = Number.isFinite(value) ? value : 0;
  return '$' + safe.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(rate: unknown) {
  const value = Number(rate);
  const safe = Number.isFinite(value) ? value : 0;
  return String(Math.round(safe * 1000) / 10).replace(/\.0$/, '');
}

function RequirementRow({ met, label }: { met: boolean; label: string }) {
  return (
    <View style={styles.reqRow}>
      <Text style={[styles.reqIcon, met ? styles.reqMet : styles.reqMiss]}>{met ? '✓' : '○'}</Text>
      <Text style={styles.meta}>{label}</Text>
    </View>
  );
}

export function VipLoanScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const initialStatus = useMemo(
    () => normalizeVipLoanStatus(route.params?.initialStatus),
    [route.params?.initialStatus]
  );

  const [status, setStatus] = useState<VipLoanStatus | null>(initialStatus);
  const [wallets, setWallets] = useState<WhitelistedWallet[]>([]);
  const [amount, setAmount] = useState('');
  const [destination, setDestination] = useState<'platform' | 'direct_wallet'>('platform');
  const [selectedWalletId, setSelectedWalletId] = useState<string | null>(null);
  const [repayAmount, setRepayAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [loanStatus, wl] = await Promise.all([
        vipFarmerService.getLoanStatus(),
        whitelistWalletService.list().catch(() => ({ wallets: [], maxWallets: 3 })),
      ]);
      setStatus(loanStatus);
      const list = wl.wallets || [];
      setWallets(list);
      const usdt = list.filter((w) => w.currency === 'usdttrc20');
      setSelectedWalletId((prev) => prev || usdt[0]?.id || null);
      setAmount((prev) =>
        prev ? prev : loanStatus.maxLoanUsd > 0 ? String(loanStatus.maxLoanUsd) : ''
      );
    } catch (e: any) {
      setError(e?.message || 'Failed to load loan status');
      if (!initialStatus) setStatus(null);
    }
  }, [initialStatus]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const usdtWallets = useMemo(
    () => wallets.filter((w) => w.currency === 'usdttrc20'),
    [wallets]
  );
  const selectedWallet = usdtWallets.find((w) => w.id === selectedWalletId) || null;

  const loanNum = Number(amount);
  const commissionUsd = useMemo(() => {
    if (!status || !Number.isFinite(loanNum) || loanNum <= 0) return 0;
    return Math.round(loanNum * status.commissionRate * 100) / 100;
  }, [loanNum, status]);
  const disbursedUsd = useMemo(() => {
    if (!Number.isFinite(loanNum) || loanNum <= 0) return 0;
    return Math.round((loanNum - commissionUsd) * 100) / 100;
  }, [loanNum, commissionUsd]);

  const canSubmit =
    status?.eligible &&
    Number.isFinite(loanNum) &&
    loanNum >= (status?.minLoanUsd || 10) &&
    loanNum <= (status?.maxLoanUsd || 0) &&
    (destination === 'platform' || Boolean(selectedWallet?.address)) &&
    !submitting;

  const onRequest = async () => {
    if (!status || !canSubmit) return;
    setSubmitting(true);
    try {
      await vipFarmerService.requestLoan({
        amount: loanNum,
        destination,
        walletAddress: destination === 'direct_wallet' ? selectedWallet?.address : undefined,
      });
      Alert.alert(
        'Loan requested',
        `Your request was submitted. Funds are typically sent within ${status.disburseWithinBusinessDays} business days after approval.`
      );
      await load();
    } catch (e: any) {
      Alert.alert('VIP loan', e?.message || 'Request failed');
    } finally {
      setSubmitting(false);
    }
  };

  const onRepay = async () => {
    const n = Number(repayAmount);
    if (!Number.isFinite(n) || n <= 0) return Alert.alert('Amount', 'Enter a valid repayment amount');
    try {
      const r = await vipFarmerService.repayLoan(n);
      setRepayAmount('');
      await load();
      Alert.alert('Repayment', `Paid ${fmtUsd(n)}. Outstanding ${fmtUsd(r.loan?.outstandingUsd ?? 0)}.`);
    } catch (e: any) {
      Alert.alert('Repay loan', e?.message || 'Failed');
    }
  };

  const openLoan = status?.loan;
  const minPrincipal = status?.minPrincipalUsd ?? 2500;
  const minAccrualDays = 22;
  const hasActiveInvestment = (status?.principalUsd ?? 0) > 0;
  const meetsPrincipal = (status?.principalUsd ?? 0) >= minPrincipal;
  const meetsAccrualDays = (status?.lifetimeAccrualDays ?? 0) >= minAccrualDays;
  const hasProjectedAccrual = (status?.monthlyAccrualUsd ?? 0) >= (status?.minLoanUsd ?? 10);
  const showLoading = !status && !error;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>VIP Farmers loan</Text>
      <Text style={styles.sub}>
        For investors with {fmtUsd(minPrincipal)}+ principal. Loan size is based on projected accrual this month.
      </Text>

      {error ? (
        <Card style={styles.errCard}>
          <Text style={styles.err}>{error}</Text>
        </Card>
      ) : null}

      {showLoading ? (
        <Card>
          <Text style={styles.meta}>Loading…</Text>
        </Card>
      ) : null}

      {status ? (
        <>
          <Card>
            <Text style={styles.label}>Your VIP principal</Text>
            <Text style={styles.bigVal}>{fmtUsd(status.principalUsd)}</Text>
            <Text style={styles.meta}>
              Projected this month: {fmtUsd(status.monthlyAccrualUsd)} net accrual
              {status.isEstablished ? ' · established (1+ month)' : ' · new investor tier'}
            </Text>
          </Card>

          {openLoan ? (
            <Card style={{ marginTop: 12 }}>
              <Text style={styles.label}>Current loan</Text>
              <Text style={styles.meta}>
                Status: {openLoan.status} · Requested {fmtUsd(openLoan.amountUsd)} · You receive{' '}
                {fmtUsd(openLoan.disbursedUsd)}
              </Text>
              {openLoan.payoutDestination === 'direct_wallet' && openLoan.walletAddress ? (
                <Text style={styles.mono}>Payout wallet: {openLoan.walletAddress}</Text>
              ) : (
                <Text style={styles.meta}>Payout: platform cash wallet</Text>
              )}
              {openLoan.status === 'pending' ? (
                <Text style={styles.note}>
                  Pending admin approval. Expect disbursement within {openLoan.disburseWithinBusinessDays || 3} business
                  days.
                </Text>
              ) : null}
              {openLoan.status === 'active' ? (
                <>
                  <Text style={styles.meta}>
                    Outstanding {fmtUsd(openLoan.outstandingUsd)} · Repaid {fmtUsd(openLoan.repaidUsd)}
                  </Text>
                  <TextInput
                    style={styles.input}
                    keyboardType='decimal-pad'
                    value={repayAmount}
                    onChangeText={setRepayAmount}
                    placeholder='Repayment amount'
                    placeholderTextColor={palette.textSecondary}
                  />
                  <PrimaryButton label='Repay loan' onPress={() => void onRepay()} style={{ marginTop: 8 }} />
                </>
              ) : null}
            </Card>
          ) : status.eligible ? (
            <Card style={{ marginTop: 12 }}>
              <Text style={styles.label}>Loan quote</Text>
              <View style={styles.row}>
                <Text style={styles.meta}>Max loan</Text>
                <Text style={styles.val}>{fmtUsd(status.maxLoanUsd)}</Text>
              </View>
              <View style={styles.row}>
                <Text style={styles.meta}>Commission</Text>
                <Text style={styles.val}>{fmtPct(status.commissionRate)}%</Text>
              </View>
              {!status.isEstablished ? (
                <Text style={styles.note}>
                  New VIP investors: max loan is 50% of this month's projected accrual, then {fmtPct(status.commissionRate)}%
                  commission.
                </Text>
              ) : (
                <Text style={styles.note}>
                  Established investors: max loan equals this month's projected accrual minus {fmtPct(status.commissionRate)}%
                  commission on disbursement.
                </Text>
              )}

              <Text style={[styles.label, { marginTop: 14 }]}>Loan amount (USD)</Text>
              <TextInput
                style={styles.input}
                keyboardType='decimal-pad'
                value={amount}
                onChangeText={setAmount}
                placeholder={`Up to ${fmtUsd(status.maxLoanUsd)}`}
                placeholderTextColor={palette.textSecondary}
              />
              {Number.isFinite(loanNum) && loanNum > 0 ? (
                <Text style={styles.meta}>
                  You receive {fmtUsd(disbursedUsd)} after {fmtUsd(commissionUsd)} commission
                </Text>
              ) : null}

              <Text style={[styles.label, { marginTop: 14 }]}>Receive funds in</Text>
              <View style={styles.choiceRow}>
                <Pressable
                  style={[styles.choice, destination === 'platform' && styles.choiceOn]}
                  onPress={() => setDestination('platform')}
                >
                  <Text style={styles.choiceText}>Cash wallet</Text>
                </Pressable>
                <Pressable
                  style={[styles.choice, destination === 'direct_wallet' && styles.choiceOn]}
                  onPress={() => setDestination('direct_wallet')}
                >
                  <Text style={styles.choiceText}>Whitelisted TRC20</Text>
                </Pressable>
              </View>

              {destination === 'direct_wallet' ? (
                usdtWallets.length ? (
                  <>
                    <Text style={[styles.label, { marginTop: 10 }]}>Payout wallet</Text>
                    {usdtWallets.map((w) => (
                      <Pressable
                        key={w.id}
                        style={[styles.walletRow, selectedWalletId === w.id && styles.walletRowOn]}
                        onPress={() => setSelectedWalletId(w.id)}
                      >
                        <Text style={styles.walletLabel}>
                          {w.label || formatNetworkLabel(w.currency)} · {formatNetworkLabel(w.currency)}
                        </Text>
                        <Text style={styles.mono}>{w.address}</Text>
                      </Pressable>
                    ))}
                  </>
                ) : (
                  <Text style={styles.note}>
                    Add a USDT (TRC20) wallet in Settings → Whitelisted wallets before requesting a crypto payout.
                  </Text>
                )
              ) : null}

              <Text style={styles.note}>
                After you accept, funds are sent within {status.disburseWithinBusinessDays} business days once approved.
              </Text>

              <PrimaryButton
                label={submitting ? 'Submitting…' : 'Request loan'}
                onPress={() => void onRequest()}
                disabled={!canSubmit}
                style={{ marginTop: 12 }}
              />
            </Card>
          ) : (
            <Card style={{ marginTop: 12 }}>
              <Text style={styles.label}>Loan requirements</Text>
              <Text style={styles.meta}>
                {status.ineligibilityReason || 'Complete the items below to apply for a VIP loan.'}
              </Text>

              <View style={styles.reqList}>
                <RequirementRow met={hasActiveInvestment} label='Active VIP Farmers investment' />
                <RequirementRow
                  met={meetsPrincipal}
                  label={`Minimum principal ${fmtUsd(minPrincipal)} (yours: ${fmtUsd(status.principalUsd)})`}
                />
                <RequirementRow
                  met={!openLoan}
                  label='No pending or active VIP loan'
                />
                <RequirementRow
                  met={hasProjectedAccrual}
                  label={`Projected monthly accrual supports at least ${fmtUsd(status.minLoanUsd)} loan`}
                />
                <RequirementRow
                  met={meetsAccrualDays || status.isEstablished}
                  label={`Established tier: ${minAccrualDays}+ weekday accrual days (yours: ${status.lifetimeAccrualDays})`}
                />
              </View>

              <Text style={styles.note}>
                New investors (under {minAccrualDays} accrual days) may qualify for up to 50% of projected monthly accrual
                with a {fmtPct(0.1)}% commission. Established investors may borrow up to full projected accrual with a{' '}
                {fmtPct(0.3)}% commission.
              </Text>

              <PrimaryButton
                label='Back to VIP Farmers'
                onPress={() => navigateToVipFarmersTrade(navigation)}
                style={{ marginTop: 12 }}
              />
            </Card>
          )}
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { padding: 16, paddingBottom: 32, flexGrow: 1 },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 12, lineHeight: 18 },
  errCard: { marginBottom: 12, borderColor: '#b45309' },
  err: { color: '#fbbf24' },
  label: { color: palette.textPrimary, fontWeight: '700', marginBottom: 6 },
  bigVal: { color: palette.primary, fontSize: 28, fontWeight: '800' },
  meta: { color: palette.textSecondary, fontSize: 13, lineHeight: 18, flex: 1 },
  val: { color: palette.textPrimary, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 12,
    marginTop: 4,
  },
  note: { color: palette.textSecondary, fontSize: 12, lineHeight: 17, marginTop: 10 },
  mono: { color: palette.textSecondary, fontSize: 11, marginTop: 4 },
  choiceRow: { flexDirection: 'row', gap: 8, marginTop: 6 },
  choice: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
  },
  choiceOn: { borderColor: palette.primary, backgroundColor: 'rgba(201, 162, 39, 0.12)' },
  choiceText: { color: palette.textPrimary, fontWeight: '600', fontSize: 13 },
  walletRow: {
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: palette.border,
    marginTop: 8,
  },
  walletRowOn: { borderColor: palette.primary },
  walletLabel: { color: palette.textPrimary, fontWeight: '600', fontSize: 13 },
  reqList: { marginTop: 12, gap: 8 },
  reqRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  reqIcon: { width: 18, fontWeight: '800', fontSize: 14, marginTop: 1 },
  reqMet: { color: palette.success },
  reqMiss: { color: palette.textSecondary },
});
