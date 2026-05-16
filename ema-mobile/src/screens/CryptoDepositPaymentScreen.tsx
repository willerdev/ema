import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import QRCode from 'react-native-qrcode-svg';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { useToast } from '../hooks/useToast';
import { nowpaymentsService } from '../services/nowpaymentsService';
import type { NowpaymentsDepositStatus, RootStackParamList } from '../types';
import { palette } from '../theme/colors';
import { formatNetworkLabel } from '../utils/userFacingError';
import {
  DEPOSIT_PHASE_LABELS,
  DepositPaymentPhase,
  mapDepositPaymentPhase,
} from '../utils/depositPaymentStatus';

type Route = RouteProp<RootStackParamList, 'CryptoDepositPayment'>;
type Nav = NativeStackNavigationProp<RootStackParamList, 'CryptoDepositPayment'>;

const PHASES: DepositPaymentPhase[] = ['waiting', 'processing', 'processed'];

function PhaseStep({ phase, current }: { phase: DepositPaymentPhase; current: DepositPaymentPhase }) {
  const order = PHASES.indexOf(phase);
  const cur = PHASES.indexOf(current === 'failed' ? 'waiting' : current);
  const done = order < cur || (current === 'processed' && phase === 'processed');
  const active = phase === current || (current === 'processed' && phase === 'processed');
  return (
    <View style={styles.step}>
      <View style={[styles.stepDot, done && styles.stepDotDone, active && styles.stepDotActive]}>
        {done ? <Ionicons name='checkmark' size={14} color='#111827' /> : null}
      </View>
      <Text style={[styles.stepLabel, active && styles.stepLabelActive]}>{DEPOSIT_PHASE_LABELS[phase]}</Text>
    </View>
  );
}

export function CryptoDepositPaymentScreen() {
  const route = useRoute<Route>();
  const navigation = useNavigation<Nav>();
  const { showToast } = useToast();
  const initial = route.params.deposit;

  const [status, setStatus] = useState<NowpaymentsDepositStatus | null>(null);
  const creditedToastShown = useRef(false);

  const phase = mapDepositPaymentPhase(
    status?.status || initial.status,
    status?.ledgerCredited
  );

  const poll = useCallback(async () => {
    try {
      const next = await nowpaymentsService.getDeposit(initial.id);
      setStatus(next);
      if (next.ledgerCredited && !creditedToastShown.current) {
        creditedToastShown.current = true;
        showToast('Deposit credited to your wallet');
      }
    } catch {
      // keep last status
    }
  }, [initial.id, showToast]);

  useEffect(() => {
    void poll();
    if (phase === 'processed' || phase === 'failed') return;
    const t = setInterval(() => void poll(), 5000);
    return () => clearInterval(t);
  }, [phase, poll]);

  const payAddress = status?.payAddress ?? initial.payAddress;
  const payAmount = status?.payAmount ?? initial.payAmount;
  const payCurrency = status?.payCurrency ?? initial.payCurrency;
  const rawStatus = status?.status ?? initial.status;

  const onCopy = async () => {
    if (!payAddress) return;
    try {
      await Clipboard.setStringAsync(payAddress);
      showToast('Address copied');
    } catch {
      Alert.alert('Copy failed', 'Could not copy address.');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card>
        <Text style={styles.caption}>Pay exactly</Text>
        <Text style={styles.amount}>
          {payAmount || '—'} {formatNetworkLabel(payCurrency)}
        </Text>
        <Text style={styles.usdHint}>≈ ${initial.priceAmount} USD</Text>
      </Card>

      <Card style={styles.statusCard}>
        <Text style={styles.sectionTitle}>Payment status</Text>
        <View style={styles.stepsRow}>
          {PHASES.map((p) => (
            <PhaseStep key={p} phase={p} current={phase} />
          ))}
        </View>
        <Text style={styles.statusDetail}>
          {phase === 'failed'
            ? `Payment ${rawStatus}. Contact support if funds were sent.`
            : phase === 'processed'
              ? 'Your deposit has been credited to your wallet.'
              : phase === 'processing'
                ? 'Payment detected on-chain. Confirming and crediting your wallet…'
                : 'Send crypto to the address below. Status updates automatically.'}
        </Text>
        <Pressable onPress={() => void poll()} style={styles.refreshRow}>
          <Ionicons name='refresh' size={16} color={palette.primary} />
          <Text style={styles.refreshText}>Refresh now</Text>
        </Pressable>
      </Card>

      {payAddress ? (
        <Card>
          <Text style={styles.fieldLabel}>Deposit address</Text>
          <Text style={styles.mono} selectable>
            {payAddress}
          </Text>
          <View style={styles.qrWrap}>
            <QRCode value={payAddress} size={160} color='#111827' backgroundColor='white' />
          </View>
          <PrimaryButton label='Copy address' onPress={() => void onCopy()} />
        </Card>
      ) : (
        <Card>
          <Text style={styles.hint}>Generating deposit address…</Text>
        </Card>
      )}

      <PrimaryButton
        label={phase === 'processed' ? 'Done' : 'Back to wallet'}
        onPress={() => navigation.goBack()}
        style={{ marginTop: 8 }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { padding: 16, paddingBottom: 32 },
  caption: { color: palette.textSecondary, fontSize: 13, marginBottom: 4 },
  amount: { color: palette.textPrimary, fontSize: 22, fontWeight: '800' },
  usdHint: { color: palette.textSecondary, fontSize: 12, marginTop: 6 },
  statusCard: { marginTop: 12 },
  sectionTitle: { color: palette.textPrimary, fontSize: 16, fontWeight: '700', marginBottom: 14 },
  stepsRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  step: { flex: 1, alignItems: 'center' },
  stepDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  stepDotActive: { borderColor: palette.primary },
  stepDotDone: { backgroundColor: palette.primary, borderColor: palette.primary },
  stepLabel: { color: palette.textSecondary, fontSize: 11, fontWeight: '600', textAlign: 'center' },
  stepLabelActive: { color: palette.textPrimary },
  statusDetail: { color: palette.textSecondary, fontSize: 13, lineHeight: 19 },
  refreshRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
  refreshText: { color: palette.primary, fontSize: 13, fontWeight: '600' },
  fieldLabel: { color: palette.textSecondary, fontSize: 12, marginBottom: 8, fontWeight: '600' },
  mono: { color: palette.textPrimary, fontFamily: 'Menlo', fontSize: 12, marginBottom: 12, lineHeight: 18 },
  qrWrap: { alignItems: 'center', marginVertical: 12 },
  hint: { color: palette.textSecondary, fontSize: 13 },
});
