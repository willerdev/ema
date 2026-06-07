import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { vipFarmerService, type VipAccrual, type VipSummary } from '../services/vipFarmerService';
import { palette } from '../theme/colors';

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function VipFarmersTradeScreen() {
  const [summary, setSummary] = useState<VipSummary | null>(null);
  const [accruals, setAccruals] = useState<VipAccrual[]>([]);
  const [commissionRate, setCommissionRate] = useState(0);
  const [amount, setAmount] = useState('');
  const [addAmount, setAddAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await vipFarmerService.getSummary();
      setSummary(s);
      setCommissionRate(s.commissionRate ?? 0);
      try {
        const hist = await vipFarmerService.getAccruals(60);
        setAccruals(hist.accruals || []);
        setCommissionRate(hist.commissionRate ?? s.commissionRate ?? 0);
      } catch {
        setAccruals([]);
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
      Alert.alert('Invested', 'Your VIP Farmers lock has started.');
    } catch (e: any) {
      Alert.alert('VIP Farmers', e?.message || 'Invest failed');
    }
  };

  const onWithdraw = async () => {
    Alert.alert('Withdraw principal', 'Return locked principal to cash wallet?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Withdraw',
        onPress: async () => {
          try {
            const r = await vipFarmerService.withdraw();
            await load();
            Alert.alert('Done', `Returned ${fmtUsd(r.principalReturned)} to cash.`);
          } catch (e: any) {
            Alert.alert('VIP Farmers', e?.message || 'Withdraw failed');
          }
        },
      },
    ]);
  };

  const onAddCapital = async () => {
    const n = Number(addAmount);
    if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
    Alert.alert(
      'Add capital',
      'Adding funds increases your principal and restarts the 30-weekday accrual lock from today.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Add capital',
          onPress: async () => {
            try {
              const r = await vipFarmerService.addCapital(n);
              setAddAmount('');
              await load();
              Alert.alert(
                'Capital added',
                `Added ${fmtUsd(r.addedUsd)}. New principal ${fmtUsd(r.investment.principalUsd)}. Lock restarted.`
              );
            } catch (e: any) {
              Alert.alert('VIP Farmers', e?.message || 'Add capital failed');
            }
          },
        },
      ]
    );
  };

  const onEarlyWithdraw = async () => {
    const pct = Math.round((summary?.earlyPenaltyRate ?? 0.3) * 100);
    Alert.alert(
      'Early exit',
      `30-day lock applies. Early exit forfeits ${pct}% of your locked principal. Daily payouts already received stay in cash.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Exit early',
          style: 'destructive',
          onPress: async () => {
            try {
              const r = await vipFarmerService.earlyWithdraw();
              await load();
              Alert.alert(
                'Early exit',
                `Penalty ${fmtUsd(r.penalty)}. Credited ${fmtUsd(r.payout)} to cash.`
              );
            } catch (e: any) {
              Alert.alert('VIP Farmers', e?.message || 'Early withdraw failed');
            }
          },
        },
      ]
    );
  };

  const inv = summary?.investment;

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Live VIP Farmers</Text>
      <Text style={styles.sub}>
        {summary?.lockDays ?? 30} weekday accruals (Mon–Fri) · {(summary?.dailyRate ?? 0.09) * 100}% daily on principal
        paid to cash · Min {fmtUsd(summary?.minInvestUsd ?? 100)}
      </Text>

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
              <Text style={styles.meta}>Earned so far: {fmtUsd(inv.totalAccruedUsd)}</Text>
              <Text style={styles.highlight}>
                Daily interest: {fmtUsd(inv.dailyInterestUsd ?? inv.principalUsd * (inv.dailyRate ?? 0.09))}
              </Text>
              <Text style={styles.highlight}>
                Remaining interest: {fmtUsd(inv.remainingInterestUsd ?? 0)} ({inv.remainingAccrualDays ?? inv.daysLeft}{' '}
                weekday{inv.remainingAccrualDays === 1 || inv.daysLeft === 1 ? '' : 's'} left)
              </Text>
              {inv.todayIsAccrualDay && !inv.todayAccrued && (inv.todayInterestUsd ?? 0) > 0 ? (
                <Text style={styles.meta}>Today&apos;s payout pending: {fmtUsd(inv.todayInterestUsd ?? 0)}</Text>
              ) : null}
              {inv.todayIsAccrualDay === false ? (
                <Text style={styles.meta}>No accrual on weekends — next payout on the next weekday.</Text>
              ) : null}
              <Text style={styles.meta}>
                Weekdays accrued {inv.daysAccrued}/{inv.lockDays}
              </Text>
              <Text style={styles.meta}>Est. maturity {new Date(inv.maturesAt).toLocaleString()}</Text>
              {!inv.matured ? (
                <>
                  <Text style={[styles.disclaimer, { marginTop: 10 }]}>
                    Add capital from cash to grow principal. This restarts the 30-day lock from today.
                  </Text>
                  <TextInput
                    style={[styles.input, { marginTop: 8 }]}
                    value={addAmount}
                    onChangeText={setAddAmount}
                    placeholder={`Min ${fmtUsd(summary.minInvestUsd)}`}
                    placeholderTextColor={palette.textSecondary}
                    keyboardType='numeric'
                  />
                  <PrimaryButton label='Add capital' onPress={() => void onAddCapital()} style={{ marginTop: 8 }} />
                </>
              ) : null}
              {inv.matured ? (
                <PrimaryButton label='Withdraw principal' onPress={() => void onWithdraw()} style={{ marginTop: 12 }} />
              ) : (
                <PrimaryButton
                  label='Early exit (30% penalty)'
                  onPress={() => void onEarlyWithdraw()}
                  variant='danger'
                  style={{ marginTop: 12 }}
                />
              )}
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
                Principal is locked for 30 weekday accruals (Mon–Fri). Early exit has a penalty.
              </Text>
              <PrimaryButton label='Start VIP lock' onPress={() => void onInvest()} style={{ marginTop: 8 }} />
            </Card>
          )}

          <Card>
            <Text style={styles.label}>Interest history</Text>
            <Text style={styles.disclaimer}>Weekday payouts (Mon–Fri UTC) credited to your cash wallet.</Text>
            {accruals.length === 0 ? (
              <Text style={[styles.meta, { marginTop: 8 }]}>No interest payouts yet.</Text>
            ) : (
              accruals.map((a) => (
                <View key={a.id} style={styles.accrualRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.accrualDate}>{a.accrualDate}</Text>
                    {commissionRate > 0 ? (
                      <Text style={styles.meta}>
                        Gross {fmtUsd(a.grossUsd)} · Fee {fmtUsd(a.commissionUsd)}
                      </Text>
                    ) : null}
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 12, lineHeight: 18 },
  label: { color: palette.textSecondary, marginBottom: 6 },
  big: { color: palette.primary, fontSize: 28, fontWeight: '800' },
  meta: { color: palette.textSecondary, marginTop: 4, fontSize: 13 },
  highlight: { color: palette.textPrimary, marginTop: 6, fontSize: 14, fontWeight: '700' },
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
