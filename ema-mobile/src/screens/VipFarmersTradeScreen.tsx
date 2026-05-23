import { useCallback, useEffect, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { vipFarmerService, type VipSummary } from '../services/vipFarmerService';
import { palette } from '../theme/colors';

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function VipFarmersTradeScreen() {
  const [summary, setSummary] = useState<VipSummary | null>(null);
  const [amount, setAmount] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setSummary(await vipFarmerService.getSummary());
    } catch (e: any) {
      setError(e?.message || 'Failed to load VIP Farmers');
      setSummary(null);
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
        30-day lock · {(summary?.dailyRate ?? 0.09) * 100}% daily on principal paid to cash · Min{' '}
        {fmtUsd(summary?.minInvestUsd ?? 100)}
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
              <Text style={styles.meta}>
                Days {inv.daysAccrued}/{inv.lockDays} · {inv.daysLeft} day{inv.daysLeft === 1 ? '' : 's'} left
              </Text>
              <Text style={styles.meta}>Matures {new Date(inv.maturesAt).toLocaleString()}</Text>
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
                Funds are locked for 30 UTC days. No withdrawal before maturity except early exit with penalty.
              </Text>
              <PrimaryButton label='Start VIP lock' onPress={() => void onInvest()} style={{ marginTop: 8 }} />
            </Card>
          )}
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
  err: { color: '#fbbf24' },
});
