import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { palette } from '../theme/colors';

export type AirfarmingDropPhase = 'waiting' | 'preparing' | 'processing' | 'rewarding' | 'idle';

const STEPS = [
  { key: 'waiting', label: 'Waiting for drop' },
  { key: 'processing', label: 'Processing' },
  { key: 'rewarding', label: 'Rewarding' },
] as const;

type StepStatus = 'pending' | 'active' | 'done';

function activeStepIndex(phase: AirfarmingDropPhase): number {
  if (phase === 'rewarding') return 2;
  if (phase === 'preparing' || phase === 'processing') return 1;
  if (phase === 'waiting') return 0;
  return 0;
}

function stepStatus(index: number, phase: AirfarmingDropPhase): StepStatus {
  const active = activeStepIndex(phase);
  if (phase === 'rewarding' && index <= 2) {
    if (index < 2) return 'done';
    return 'done';
  }
  if (index < active) return 'done';
  if (index === active) return 'active';
  return 'pending';
}

type AirfarmingDropProgressProps = {
  dropPhase: AirfarmingDropPhase;
};

export function AirfarmingDropProgress({ dropPhase }: AirfarmingDropProgressProps) {
  if (dropPhase === 'idle') return null;

  const showSpinner =
    dropPhase === 'preparing' || dropPhase === 'processing' || dropPhase === 'rewarding';

  return (
    <View style={styles.wrap}>
      {STEPS.map((step, index) => {
        const status = stepStatus(index, dropPhase);
        const isProcessingStep = step.key === 'processing';
        const spinner =
          status === 'active' &&
          showSpinner &&
          (dropPhase === 'preparing' || dropPhase === 'processing' || dropPhase === 'rewarding') &&
          (isProcessingStep || (dropPhase === 'rewarding' && step.key === 'rewarding'));

        return (
          <View key={step.key} style={styles.row}>
            <View style={styles.rail}>
              {index > 0 ? (
                <View
                  style={[styles.connector, status === 'pending' ? styles.connectorPending : styles.connectorDone]}
                />
              ) : null}
              <View
                style={[
                  styles.bubble,
                  status === 'active' && styles.bubbleActive,
                  status === 'done' && styles.bubbleDone,
                ]}
              >
                {status === 'done' ? (
                  <Ionicons name='checkmark' size={16} color='#fff' />
                ) : spinner ? (
                  <ActivityIndicator size='small' color='#fff' />
                ) : (
                  <Text style={styles.bubbleNumber}>{index + 1}</Text>
                )}
              </View>
            </View>
            <View style={styles.copy}>
              <Text style={[styles.label, status === 'active' && styles.labelActive, status === 'done' && styles.labelDone]}>
                {step.label}
              </Text>
              {isProcessingStep && dropPhase === 'preparing' && status === 'active' ? (
                <Text style={styles.sub}>Adjusting balance for this drop…</Text>
              ) : null}
              {step.key === 'rewarding' && dropPhase === 'rewarding' && status === 'done' ? (
                <Text style={styles.sub}>Drop settled</Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 12, marginBottom: 4 },
  row: { flexDirection: 'row', minHeight: 48 },
  rail: { width: 36, alignItems: 'center' },
  connector: {
    position: 'absolute',
    top: 0,
    left: 17,
    width: 2,
    height: 14,
    backgroundColor: palette.primary,
  },
  connectorPending: { backgroundColor: palette.border },
  connectorDone: { backgroundColor: palette.primary },
  bubble: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: palette.border,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleActive: { borderColor: palette.primary, backgroundColor: palette.primary },
  bubbleDone: { borderColor: palette.primary, backgroundColor: palette.primary },
  bubbleNumber: { color: palette.textSecondary, fontSize: 12, fontWeight: '700' },
  copy: { flex: 1, paddingTop: 2, paddingBottom: 8 },
  label: { color: palette.textSecondary, fontSize: 14, fontWeight: '600' },
  labelActive: { color: palette.textPrimary },
  labelDone: { color: palette.primary },
  sub: { color: palette.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 16 },
});
