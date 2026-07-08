import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { VipExitWizard } from '../components/VipExitWizard';
import {
  vipFarmerService,
  type VipAccrual,
  type VipEarningsTotals,
  type VipLockProjection,
  type VipSummary,
} from '../services/vipFarmerService';
import { palette } from '../theme/colors';

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(rate: number) {
  return String(Math.round(rate * 1000) / 10).replace(/\.0$/, '');
}

export function VipFarmersTradeScreen() {
  const [summary, setSummary] = useState<VipSummary | null>(null);
  const [accruals, setAccruals] = useState<VipAccrual[]>([]);
  const [earningsTotals, setEarningsTotals] = useState<VipEarningsTotals | null>(null);
  const [commissionRate, setCommissionRate] = useState(0.03);
  const [amount, setAmount] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [loanAmount, setLoanAmount] = useState('');
  const [repayAmount, setRepayAmount] = useState('');
  const [exitOpen, setExitOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await vipFarmerService.getSummary();
      setSummary(s);
      setCommissionRate(s.commissionRate ?? s.platformFeeRate ?? 0.03);
      try {
        const hist = await vipFarmerService.getAccruals(60);
        setAccruals(hist.accruals || []);
        setEarningsTotals(hist.totals || null);
        setCommissionRate(hist.commissionRate ?? s.commissionRate ?? 0.03);
      } catch {
        setAccruals([]);
        setEarningsTotals(null);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load VIP Farmers');
      setSummary(null);
      setAccruals([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const onInvest = async () => {
    const n = Number(amount);
    if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
    try {
      await vipFarmerService.invest(n);
      setAmount('');
      await load();
      Alert.alert(
        'Invested',
        `38-day calendar lock started. Weekday accruals pay 9% gross; ${fmtPct(commissionRate)}% platform fee on interest — net paid to cash.`
      );
    } catch (e: any) {
      Alert.alert('VIP Farmers', e?.message || 'Invest failed');
    }
  };

  const onAddCapital = async () => {
    const n = Number(addAmount);
    if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
    Alert.alert(
      'Add capital',
      'Adding funds increases principal and restarts the 38-day calendar lock (22 working accrual days).',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add capital',
          onPress: async () => {
            try {
              const r = await vipFarmerService.addCapital(n);
              setAddAmount('');
              await load();
              Alert.alert('Capital added', `Added ${fmtUsd(r.addedUsd)}. New principal ${fmtUsd(r.investment.principalUsd)}.`);
            } catch (e: any) {
              Alert.alert('VIP Farmers', e?.message || 'Add capital failed');
            }
          },
        },
      ]
    );
  };

  const onReinvest = async () => {
    const avail = inv?.availableRevenueUsd ?? 0;
    const exitFee = summary?.exitCommissionRate ?? 0.3;
    const net = avail * (1 - exitFee);
    if (avail <= 0) return Alert.alert('Reinvest', 'No available revenue to reinvest');
    Alert.alert(
      'Reinvest earnings',
      `Reinvest ${fmtUsd(avail)} gross → ${fmtUsd(net)} net to principal (30% commission). Lock restarts.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reinvest',
          onPress: async () => {
            try {
              await vipFarmerService.reinvest();
              await load();
              Alert.alert('Done', `${fmtUsd(net)} added to principal. Lock restarted.`);
            } catch (e: any) {
              Alert.alert('Reinvest', e?.message || 'Failed');
            }
          },
        },
      ]
    );
  };

  const onRequestLoan = async () => {
    const n = Number(loanAmount);
    if (!n || n <= 0) return Alert.alert('Loan', 'Enter a valid amount');
    try {
      await vipFarmerService.requestLoan(n);
      setLoanAmount('');
      await load();
      Alert.alert('Loan requested', 'Pending superadmin approval (up to 2 business days).');
    } catch (e: any) {
      Alert.alert('VIP loan', e?.message || 'Request failed');
    }
  };

  const onRepayLoan = async () => {
    const n = Number(repayAmount);
    if (!n || n <= 0) return Alert.alert('Repay', 'Enter a valid amount');
    try {
      const r = await vipFarmerService.repayLoan(n);
      setRepayAmount('');
      await load();
      Alert.alert('Repayment', `Paid ${fmtUsd(n)}. Outstanding ${fmtUsd(r.loan?.outstandingUsd ?? 0)}.`);
    } catch (e: any) {
      Alert.alert('Repay loan', e?.message || 'Failed');
    }
  };

  const inv = summary?.investment;
  const proj: VipLockProjection | null | undefined = inv?.projection;
  const feePct = fmtPct(summary?.platformFeeRate ?? commissionRate);
  const netPct = fmtPct(1 - (summary?.platformFeeRate ?? commissionRate));
  const exitFeePct = fmtPct(summary?.exitCommissionRate ?? 0.3);
  const grossEarned = proj?.earnedSoFarGrossUsd ?? inv?.totalGrossEarnedUsd ?? earningsTotals?.grossUsd ?? 0;
  const commissionEarned = proj?.earnedSoFarCommissionUsd ?? inv?.totalCommissionUsd ?? earningsTotals?.commissionUsd ?? 0;
  const netEarned = proj?.earnedSoFarNetUsd ?? inv?.totalNetEarnedUsd ?? inv?.totalAccruedUsd ?? earningsTotals?.netUsd ?? 0;
  const availableRevenue = inv?.availableRevenueUsd ?? Math.max(0, netEarned - (inv?.revenueWithdrawnUsd ?? 0));
  const reinvestNet = availableRevenue * (1 - (summary?.exitCommissionRate ?? 0.3));
  const remainingNet = proj?.remainingNetUsd ?? inv?.remainingInterestUsd ?? earningsTotals?.remainingNetUsd ?? 0;
  const fullLockNet = proj?.fullLockNetUsd ?? earningsTotals?.fullLockNetUsd ?? 0;
  const paidToCash = inv?.paidToCashUsd ?? earningsTotals?.paidToCashUsd ?? 0;
  const weekdayCount = proj?.weekdaysElapsed ?? inv?.weekdayCount ?? inv?.daysAccrued ?? earningsTotals?.weekdayCount ?? 0;
  const lockWorking = summary?.lockWorkingDays ?? summary?.lockDays ?? 22;
  const lockCalendar = summary?.lockCalendarDays ?? 38;
  const weekdaysRemaining = proj?.weekdaysRemaining ?? inv?.remainingAccrualDays ?? inv?.daysLeft ?? Math.max(0, lockWorking - weekdayCount);
  const calendarElapsed = inv?.calendarDaysElapsed ?? 0;
  const calendarLeft = inv?.calendarDaysLeft ?? Math.max(0, lockCalendar - calendarElapsed);
  const progressPct = proj?.progressPercent ?? (lockWorking > 0 ? Math.round((weekdayCount / lockWorking) * 1000) / 10 : 0);
  const lockStarted = proj?.startedAtYmd ?? inv?.startedAtYmd ?? inv?.startedAt?.slice(0, 10);
  const lockStartedLabel = lockStarted ? new Date(lockStarted + 'T12:00:00').toLocaleDateString() : '—';
  const dailyNet = proj?.dailyNetUsd ?? inv?.dailyInterestUsd ?? 0;
  const pendingExit = summary?.pendingExitRequest;
  const loan = summary?.loan;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Live VIP Farmers</Text>
      <Text style={styles.sub}>
        {lockCalendar}-day calendar lock · {lockWorking} working days · 9% daily gross on principal paid to cash · Min{' '}
        {fmtUsd(summary?.minInvestUsd ?? 100)}
      </Text>

      <View style={styles.feeNotice}>
        <Text style={styles.feeNoticeTitle}>How earnings work</Text>
        <Text style={styles.feeNoticeBody}>
          Weekdays only (Mon–Fri UTC). Each weekday earns 9% gross on principal. Ema keeps {feePct}% of that daily
          interest; you receive {netPct}% in cash. Reinvest and exit revenue use a separate {exitFeePct}% commission.
        </Text>
      </View>

      {pendingExit ? (
        <Card>
          <Text style={styles.banner}>Pending exit request ({pendingExit.mode}) — awaiting admin approval</Text>
        </Card>
      ) : null}

      {error ? (
        <Card>
          <Text style={styles.err}>{error}</Text>
        </Card>
      ) : null}

      {summary ? (
        <>
          <Card>
            <Text style={styles.label}>Cash wallet</Text>
            <Text style={styles.big}>{fmtUsd(summary.cashWalletUsd)}</Text>
          </Card>

          {inv ? (
            <Card>
              <Text style={styles.label}>Active investment</Text>
              <Text style={styles.big}>{fmtUsd(inv.principalUsd)}</Text>

              <View style={styles.projectionBox}>
                <Text style={styles.projectionTitle}>Lock progress</Text>
                <Text style={styles.projectionSub}>
                  Started {lockStartedLabel} · {calendarElapsed}/{lockCalendar} calendar days · {weekdayCount}/
                  {lockWorking} working days
                </Text>
                {inv.penaltyFree ? (
                  <Text style={styles.penaltyFree}>Penalty-free exit available</Text>
                ) : (
                  <Text style={styles.meta}>Penalty-free after 22 working days or 38 calendar days</Text>
                )}

                <View style={styles.progressTrack}>
                  <View style={[styles.progressFill, { width: `${Math.min(100, progressPct)}%` }]} />
                </View>
                <Text style={styles.progressLabel}>
                  {weekdayCount} of {lockWorking} weekdays · {progressPct}% · {calendarLeft} calendar days left
                </Text>

                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Per weekday (net to cash)</Text>
                  <Text style={styles.earningsVal}>{fmtUsd(dailyNet)}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Total earned (net)</Text>
                  <Text style={styles.earningsVal}>{fmtUsd(netEarned)}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabelStrong}>Available revenue</Text>
                  <Text style={styles.earningsNet}>{fmtUsd(availableRevenue)}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Still to earn (projected)</Text>
                  <Text style={styles.earningsVal}>{fmtUsd(remainingNet)}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Full {lockWorking}-weekday lock (projected net)</Text>
                  <Text style={[styles.earningsVal, styles.earningsNet]}>{fmtUsd(fullLockNet)}</Text>
                </View>
                {paidToCash !== netEarned ? (
                  <Text style={styles.meta}>Paid to cash: {fmtUsd(paidToCash)}</Text>
                ) : null}
              </View>

              {inv.todayIsAccrualDay && !inv.todayAccrued && (inv.todayInterestUsd ?? 0) > 0 ? (
                <Text style={styles.meta}>Today&apos;s net payout pending: {fmtUsd(inv.todayInterestUsd ?? 0)}</Text>
              ) : null}
              {inv.todayIsAccrualDay === false ? (
                <Text style={styles.meta}>No accrual on weekends — next payout on the next weekday.</Text>
              ) : null}
              <Text style={styles.meta}>Matures {new Date(inv.maturesAt).toLocaleDateString()}</Text>

              <TextInput
                style={[styles.input, { marginTop: 10 }]}
                value={addAmount}
                onChangeText={setAddAmount}
                placeholder={`Add capital — min ${fmtUsd(summary.minInvestUsd)}`}
                placeholderTextColor={palette.textSecondary}
                keyboardType='numeric'
              />
              <PrimaryButton label='Add capital' onPress={() => void onAddCapital()} style={{ marginTop: 8 }} />

              {!pendingExit && availableRevenue > 0 ? (
                <PrimaryButton
                  label={`Reinvest earnings (${fmtUsd(reinvestNet)} net)`}
                  onPress={() => void onReinvest()}
                  style={{ marginTop: 8 }}
                />
              ) : null}

              {!pendingExit ? (
                <PrimaryButton
                  label='Withdraw / end investment'
                  onPress={() => setExitOpen(true)}
                  variant='danger'
                  style={{ marginTop: 8 }}
                />
              ) : null}
            </Card>
          ) : (
            <Card>
              <Text style={styles.label}>Invest from cash</Text>
              <TextInput
                style={styles.input}
                value={amount}
                onChangeText={setAmount}
                placeholder='Amount USD'
                placeholderTextColor={palette.textSecondary}
                keyboardType='numeric'
              />
              <Text style={styles.disclaimer}>
                38-day calendar lock, up to 22 weekday accruals. Daily interest paid to cash after {feePct}% platform
                fee.
              </Text>
              <PrimaryButton label='Start VIP lock' onPress={() => void onInvest()} style={{ marginTop: 8 }} />
            </Card>
          )}

          {inv && loan ? (
            <Card>
              <Text style={styles.label}>VIP loan</Text>
              {loan.blocksWithdrawals ? (
                <Text style={styles.banner}>Withdrawals blocked while loan is pending or active</Text>
              ) : null}
              {loan.loan ? (
                <>
                  <Text style={styles.meta}>
                    Status: {loan.loan.status} · Owed {fmtUsd(loan.loan.outstandingUsd)} · Repaid{' '}
                    {fmtUsd(loan.loan.repaidUsd)}
                  </Text>
                  {loan.loan.status === 'active' ? (
                    <>
                      <TextInput
                        style={styles.input}
                        value={repayAmount}
                        onChangeText={setRepayAmount}
                        placeholder='Repay amount'
                        placeholderTextColor={palette.textSecondary}
                        keyboardType='numeric'
                      />
                      <PrimaryButton label='Repay loan' onPress={() => void onRepayLoan()} style={{ marginTop: 8 }} />
                    </>
                  ) : null}
                </>
              ) : loan.eligible ? (
                <>
                  <Text style={styles.meta}>
                    Max loan {fmtUsd(loan.maxLoanUsd)} (last 30 days earnings). 30% commission on disbursement.
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={loanAmount}
                    onChangeText={setLoanAmount}
                    placeholder={`Min ${fmtUsd(loan.minLoanUsd)}`}
                    placeholderTextColor={palette.textSecondary}
                    keyboardType='numeric'
                  />
                  <PrimaryButton label='Request VIP loan' onPress={() => void onRequestLoan()} style={{ marginTop: 8 }} />
                </>
              ) : (
                <Text style={styles.meta}>
                  Not eligible — need active investment, {loan.lifetimeAccrualDays}/22 lifetime accrual days, min{' '}
                  {fmtUsd(loan.minLoanUsd)} last-month earnings.
                </Text>
              )}
            </Card>
          ) : null}

          <Card>
            <Text style={styles.label}>Interest history</Text>
            {earningsTotals ? (
              <View style={[styles.earningsBox, { marginBottom: 12 }]}>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Weekdays paid</Text>
                  <Text style={styles.earningsVal}>{earningsTotals.weekdayCount}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Gross</Text>
                  <Text style={styles.earningsVal}>{fmtUsd(grossEarned)}</Text>
                </View>
                <View style={styles.earningsRow}>
                  <Text style={styles.earningsLabel}>Platform fee ({feePct}%)</Text>
                  <Text style={[styles.earningsVal, styles.commissionVal]}>-{fmtUsd(commissionEarned)}</Text>
                </View>
                <View style={[styles.earningsRow, styles.earningsRowTotal]}>
                  <Text style={styles.earningsLabelStrong}>Net earned</Text>
                  <Text style={styles.earningsNet}>{fmtUsd(earningsTotals.netUsd)}</Text>
                </View>
              </View>
            ) : null}
            {accruals.length === 0 ? (
              <Text style={[styles.meta, { marginTop: 8 }]}>No interest payouts yet.</Text>
            ) : (
              accruals.map((a) => (
                <View key={a.id} style={styles.accrualRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accrualDate}>{a.accrualDate}</Text>
                    <Text style={styles.meta}>
                      Gross {fmtUsd(a.grossUsd)} · fee {fmtUsd(a.commissionUsd)}
                    </Text>
                  </View>
                  <Text style={styles.accrualNet}>+{fmtUsd(a.netUsd)}</Text>
                </View>
              ))
            )}
          </Card>
        </>
      ) : !error ? (
        <Card>
          <Text style={styles.meta}>Loading…</Text>
        </Card>
      ) : null}

      {inv ? (
        <VipExitWizard
          visible={exitOpen}
          investment={inv}
          availableRevenue={availableRevenue}
          exitCommissionRate={summary?.exitCommissionRate ?? 0.3}
          onClose={() => setExitOpen(false)}
          onComplete={() => void load()}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 12, lineHeight: 18 },
  feeNotice: {
    marginBottom: 14,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 39, 0.55)',
    backgroundColor: 'rgba(201, 162, 39, 0.12)',
  },
  feeNoticeTitle: { color: palette.primary, fontWeight: '800', fontSize: 14, marginBottom: 6 },
  feeNoticeBody: { color: palette.textPrimary, fontSize: 13, lineHeight: 19 },
  banner: { color: '#fbbf24', fontWeight: '700', fontSize: 13 },
  penaltyFree: { color: palette.success, fontWeight: '700', marginBottom: 8 },
  projectionBox: {
    marginTop: 12,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(201, 162, 39, 0.45)',
    backgroundColor: 'rgba(201, 162, 39, 0.08)',
  },
  projectionTitle: { color: palette.primary, fontSize: 16, fontWeight: '800', marginBottom: 4 },
  projectionSub: { color: palette.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 8 },
  progressTrack: {
    height: 8,
    borderRadius: 999,
    backgroundColor: palette.surfaceElevated,
    overflow: 'hidden',
    marginBottom: 6,
  },
  progressFill: { height: '100%', borderRadius: 999, backgroundColor: palette.primary },
  progressLabel: { color: palette.textSecondary, fontSize: 12, marginBottom: 10 },
  earningsBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
  },
  earningsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  earningsRowTotal: { marginTop: 6, paddingTop: 8, borderTopWidth: 1, borderTopColor: palette.border },
  earningsLabel: { color: palette.textSecondary, fontSize: 13 },
  earningsLabelStrong: { color: palette.textPrimary, fontSize: 14, fontWeight: '700' },
  earningsVal: { color: palette.textPrimary, fontSize: 14, fontWeight: '600' },
  commissionVal: { color: '#fbbf24' },
  earningsNet: { color: palette.success, fontSize: 16, fontWeight: '800' },
  label: { color: palette.textSecondary, marginBottom: 6 },
  big: { color: palette.primary, fontSize: 28, fontWeight: '800' },
  meta: { color: palette.textSecondary, marginTop: 4, fontSize: 13 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 12,
    marginBottom: 8,
  },
  disclaimer: { color: palette.textSecondary, fontSize: 12, lineHeight: 17 },
  accrualRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: 8,
  },
  accrualDate: { color: palette.textPrimary, fontWeight: '700', fontSize: 14 },
  accrualNet: { color: palette.success, fontWeight: '800', fontSize: 15 },
  err: { color: '#fbbf24' },
});
