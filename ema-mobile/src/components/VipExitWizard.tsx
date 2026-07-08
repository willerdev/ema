import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { PrimaryButton } from './PrimaryButton';
import { vipFarmerService, type VipExitQuote, type VipInvestment } from '../services/vipFarmerService';
import { palette } from '../theme/colors';

function fmtUsd(n: number) {
  return '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type Props = {
  visible: boolean;
  investment: VipInvestment;
  availableRevenue: number;
  exitCommissionRate: number;
  onClose: () => void;
  onComplete: () => void;
};

const REVENUE_PERCENTS = [50, 60, 70, 80, 90, 100];

export function VipExitWizard({ visible, investment, availableRevenue, exitCommissionRate, onClose, onComplete }: Props) {
  const [step, setStep] = useState(1);
  const [mode, setMode] = useState<'full_stop' | 'partial_continue'>('full_stop');
  const [revenuePercent, setRevenuePercent] = useState(100);
  const [destination, setDestination] = useState<'platform' | 'direct_wallet'>('platform');
  const [walletAddress, setWalletAddress] = useState('');
  const [quote, setQuote] = useState<VipExitQuote | null>(null);
  const [loading, setLoading] = useState(false);

  const reset = useCallback(() => {
    setStep(1);
    setMode('full_stop');
    setRevenuePercent(100);
    setDestination('platform');
    setWalletAddress('');
    setQuote(null);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const loadQuote = async () => {
    setLoading(true);
    try {
      const q = await vipFarmerService.previewExit({ mode, revenuePercent, destination });
      setQuote(q);
      setStep(4);
    } catch (e: any) {
      Alert.alert('Exit preview', e?.message || 'Failed to load quote');
    } finally {
      setLoading(false);
    }
  };

  const onReinvestContinue = async () => {
    setLoading(true);
    try {
      const net = availableRevenue * (1 - exitCommissionRate);
      Alert.alert(
        'Reinvest earnings',
        `Reinvest ${fmtUsd(availableRevenue)} gross (${fmtUsd(net)} net to principal after 30% commission)? Lock restarts for 38 calendar days.`,
        [
          { text: 'Cancel', style: 'cancel', onPress: () => setLoading(false) },
          {
            text: 'Reinvest',
            onPress: async () => {
              try {
                await vipFarmerService.reinvest();
                onComplete();
                onClose();
                Alert.alert('Done', 'Earnings reinvested. Lock restarted.');
              } catch (e: any) {
                Alert.alert('Reinvest', e?.message || 'Failed');
              } finally {
                setLoading(false);
              }
            },
          },
        ]
      );
    } catch {
      setLoading(false);
    }
  };

  const onConfirmExit = async () => {
    setLoading(true);
    try {
      await vipFarmerService.requestExit({
        mode,
        revenuePercent,
        destination,
        walletAddress: destination === 'direct_wallet' ? walletAddress.trim() : undefined,
      });
      onComplete();
      onClose();
      Alert.alert(
        'Exit requested',
        destination === 'direct_wallet'
          ? 'Your request is pending superadmin approval. USDT will be sent manually to your TRC20 address.'
          : 'Your request is pending superadmin approval. Funds will credit your cash wallet when approved.'
      );
    } catch (e: any) {
      Alert.alert('Exit request', e?.message || 'Failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType='slide' onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Withdraw / end investment</Text>
          <Text style={styles.sub}>Step {step} of 5</Text>

          <ScrollView style={{ maxHeight: 420 }}>
            {step === 1 ? (
              <View>
                <Text style={styles.label}>Choose an option</Text>
                <PrimaryButton
                  label={`Reinvest & continue (${fmtUsd(availableRevenue * (1 - exitCommissionRate))} net)`}
                  onPress={() => void onReinvestContinue()}
                  style={{ marginBottom: 8 }}
                />
                <Pressable style={styles.chip} onPress={() => { setMode('full_stop'); setStep(2); }}>
                  <Text style={styles.chipText}>Full stop — end investment + take revenue</Text>
                </Pressable>
                <Pressable style={styles.chip} onPress={() => { setMode('partial_continue'); setStep(2); }}>
                  <Text style={styles.chipText}>Partial — take revenue, keep investing</Text>
                </Pressable>
              </View>
            ) : null}

            {step === 2 ? (
              <View>
                <Text style={styles.label}>Revenue to take ({fmtUsd(availableRevenue)} available)</Text>
                <View style={styles.chipRow}>
                  {REVENUE_PERCENTS.map((p) => (
                    <Pressable
                      key={p}
                      style={[styles.pctChip, revenuePercent === p && styles.pctChipActive]}
                      onPress={() => setRevenuePercent(p)}
                    >
                      <Text style={[styles.pctChipText, revenuePercent === p && styles.pctChipTextActive]}>{p}%</Text>
                    </Pressable>
                  ))}
                </View>
                <PrimaryButton label='Next' onPress={() => setStep(3)} style={{ marginTop: 12 }} />
              </View>
            ) : null}

            {step === 3 ? (
              <View>
                <Text style={styles.label}>Destination</Text>
                <Pressable
                  style={[styles.chip, destination === 'platform' && styles.chipActive]}
                  onPress={() => setDestination('platform')}
                >
                  <Text style={styles.chipText}>Platform cash wallet (on admin approve)</Text>
                </Pressable>
                <Pressable
                  style={[styles.chip, destination === 'direct_wallet' && styles.chipActive]}
                  onPress={() => setDestination('direct_wallet')}
                >
                  <Text style={styles.chipText}>Direct TRC20 wallet (manual USDT send)</Text>
                </Pressable>
                {destination === 'direct_wallet' ? (
                  <TextInput
                    style={styles.input}
                    value={walletAddress}
                    onChangeText={setWalletAddress}
                    placeholder='TRC20 address'
                    placeholderTextColor={palette.textSecondary}
                    autoCapitalize='none'
                  />
                ) : null}
                <PrimaryButton label='Review breakdown' onPress={() => void loadQuote()} style={{ marginTop: 12 }} />
              </View>
            ) : null}

            {step === 4 && quote ? (
              <View>
                <Text style={styles.label}>Breakdown</Text>
                <Row label='Revenue selected' value={fmtUsd(quote.revenueSelectedUsd)} />
                <Row label='Penalty' value={fmtUsd(quote.penaltyUsd)} />
                <Row label='Gas fees' value={fmtUsd(quote.gasFeesUsd)} />
                <Row label='Commission (30%)' value={fmtUsd(quote.commissionUsd)} />
                <Row label='Gas reward (30%)' value={`+${fmtUsd(quote.gasRewardUsd)}`} />
                {quote.investmentExtraCreditUsd > 0 ? (
                  <Row label='Extra credit' value={`+${fmtUsd(quote.investmentExtraCreditUsd)}`} />
                ) : null}
                {quote.principalReturnUsd > 0 ? (
                  <Row label='Principal return' value={fmtUsd(quote.principalReturnUsd)} />
                ) : null}
                <Row label='Net total' value={fmtUsd(quote.netTotalUsd)} strong />
                <Text style={styles.meta}>
                  {quote.penaltyFree ? 'Penalty-free exit' : 'Early exit — penalty may apply'}
                  {' · '}
                  {investment.calendarDaysElapsed ?? 0}/38 calendar · {quote.workingDays}/22 working days
                </Text>
                <PrimaryButton label='Confirm request' onPress={() => setStep(5)} style={{ marginTop: 12 }} />
              </View>
            ) : null}

            {step === 5 ? (
              <View>
                <Text style={styles.label}>Submit for approval?</Text>
                <Text style={styles.meta}>
                  A superadmin will review your exit. {mode === 'full_stop' ? 'Your investment will end when approved.' : 'Your investment stays active.'}
                </Text>
                <PrimaryButton
                  label={loading ? 'Submitting…' : 'Submit exit request'}
                  onPress={() => void onConfirmExit()}
                  style={{ marginTop: 12 }}
                />
              </View>
            ) : null}
          </ScrollView>

          <Pressable onPress={onClose} style={{ marginTop: 12 }}>
            <Text style={styles.cancel}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={[styles.rowVal, strong && { color: palette.success, fontWeight: '800' }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: palette.border,
  },
  title: { color: palette.textPrimary, fontSize: 20, fontWeight: '800' },
  sub: { color: palette.textSecondary, marginBottom: 12 },
  label: { color: palette.textPrimary, fontWeight: '700', marginBottom: 10 },
  chip: {
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    marginBottom: 8,
    backgroundColor: palette.surfaceElevated,
  },
  chipActive: { borderColor: palette.primary },
  chipText: { color: palette.textPrimary },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pctChip: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: palette.border,
  },
  pctChipActive: { borderColor: palette.primary, backgroundColor: 'rgba(201,162,39,0.15)' },
  pctChipText: { color: palette.textSecondary, fontWeight: '600' },
  pctChipTextActive: { color: palette.primary },
  input: {
    marginTop: 10,
    backgroundColor: palette.surfaceElevated,
    borderWidth: 1,
    borderColor: palette.border,
    color: palette.textPrimary,
    borderRadius: 12,
    padding: 12,
  },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  rowLabel: { color: palette.textSecondary },
  rowVal: { color: palette.textPrimary, fontWeight: '600' },
  meta: { color: palette.textSecondary, fontSize: 12, lineHeight: 18, marginTop: 8 },
  cancel: { color: palette.textSecondary, textAlign: 'center', padding: 8 },
});
