import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AppState,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import {
  airfarmingService,
  formatDropCountdown,
  type AirfarmingStatus,
} from '../services/airfarmingService';
import { palette } from '../theme/colors';

const POLL_MS = 45_000;

function formatUsd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

export function AirfarmingTradeScreen() {
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<AirfarmingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [activateAmount, setActivateAmount] = useState('');
  const [returnAmount, setReturnAmount] = useState('');
  const [fabMenuOpen, setFabMenuOpen] = useState(false);
  const [activateModalOpen, setActivateModalOpen] = useState(false);
  const [returnModalOpen, setReturnModalOpen] = useState(false);
  const [autoFundSaving, setAutoFundSaving] = useState(false);
  const [countdownSec, setCountdownSec] = useState(0);
  const pulse = useSharedValue(1);
  const urgentPulse = useSharedValue(1);
  const dueAtRef = useRef<string | null>(null);

  const fabBottom = Math.max(insets.bottom, 12) + 16;
  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 56 : 0;

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(withTiming(1.04, { duration: 900 }), withTiming(1, { duration: 900 })),
      -1,
      true
    );
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const urgentRingStyle = useAnimatedStyle(() => ({
    transform: [{ scale: urgentPulse.value }],
    opacity: countdownSec <= 120 ? 1 : 0.85,
  }));

  useEffect(() => {
    if (countdownSec > 0 && countdownSec <= 120) {
      urgentPulse.value = withRepeat(
        withSequence(withTiming(1.08, { duration: 400 }), withTiming(1, { duration: 400 })),
        -1,
        true
      );
    } else {
      urgentPulse.value = 1;
    }
  }, [countdownSec, urgentPulse]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await airfarmingService.getStatus();
      setStatus(s);
      if (s.nextDrop?.dueAt) {
        dueAtRef.current = s.nextDrop.dueAt;
        setCountdownSec(s.nextDrop.secondsRemaining);
      } else {
        dueAtRef.current = null;
        setCountdownSec(0);
      }
    } catch (e: any) {
      setError(e?.message || 'Failed to load airfarming');
      setStatus(null);
    }
  }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }, [load]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void load();
    });
    return () => sub.remove();
  }, [load]);

  useEffect(() => {
    const tick = setInterval(() => {
      if (dueAtRef.current) {
        const rem = Math.max(0, Math.floor((new Date(dueAtRef.current).getTime() - Date.now()) / 1000));
        setCountdownSec(rem);
        if (rem === 0) void load();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [load]);

  const closeFabMenu = () => setFabMenuOpen(false);

  const openActivate = () => {
    closeFabMenu();
    setActivateModalOpen(true);
  };

  const openReturn = () => {
    closeFabMenu();
    setReturnModalOpen(true);
  };

  const onActivate = async () => {
    try {
      const n = Number(activateAmount);
      if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
      await airfarmingService.activate(n);
      setActivateAmount('');
      setActivateModalOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Airfarming', e?.message || 'Activate failed');
    }
  };

  const onReturnToCash = async () => {
    try {
      const n = Number(returnAmount);
      if (!n || n <= 0) return Alert.alert('Amount', 'Enter a valid amount');
      await airfarmingService.returnToCash(n);
      setReturnAmount('');
      setReturnModalOpen(false);
      await load();
    } catch (e: any) {
      Alert.alert('Airfarming', e?.message || 'Return to cash failed');
    }
  };

  const onToggleAutoFund = async (enabled: boolean) => {
    if (autoFundSaving) return;
    setAutoFundSaving(true);
    try {
      const autoFundEnabled = await airfarmingService.updateAutoFund(enabled);
      setStatus((prev) => (prev ? { ...prev, autoFundEnabled } : prev));
      await load();
    } catch (e: any) {
      const statusCode = Number(e?.status);
      const message =
        statusCode === 404
          ? 'This feature is still updating on the server. Try again in a few minutes.'
          : statusCode === 503
            ? 'Airfarming is being updated. Try again shortly.'
            : e?.message || 'Could not update auto-fund setting';
      Alert.alert('Auto-fund', message);
    } finally {
      setAutoFundSaving(false);
    }
  };

  const nextDrop = status?.nextDrop;
  const nearDrop = countdownSec > 0 && countdownSec <= 120;

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: fabBottom + 72 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <Text style={styles.title}>Airfarming</Text>
        <Text style={styles.disclaimer}>
          Funds in airfarming are separate from your cash wallet. At each drop, keep your balance within the required
          range to earn the shown percentage as profit (credited to airfarming). Not financial advice.
        </Text>

        {status?.platformHighlight ? (
          <Card>
            <Text style={styles.section}>Platform highlight</Text>
            <Text style={styles.meta}>
              Reported +{status.platformHighlight.percent.toFixed(2)}% on{' '}
              {(() => {
                const [y, m, d] = status.platformHighlight.date.split('-').map(Number);
                if (!y || !m || !d) return status.platformHighlight.date;
                return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
                  day: 'numeric',
                  month: 'short',
                  year: 'numeric',
                  timeZone: 'UTC',
                });
              })()}
            </Text>
          </Card>
        ) : null}

        {error ? (
          <Card>
            <Text style={styles.error}>{error}</Text>
            <PrimaryButton label='Retry' onPress={() => void load()} />
          </Card>
        ) : null}

        {status ? (
          <>
            <View style={styles.grid}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Cash wallet</Text>
                <Text style={styles.statValue}>${Math.floor(status.cashWallet).toLocaleString()}</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Airfarming</Text>
                <Text style={styles.statValue}>${Math.floor(status.airfarmingBalance).toLocaleString()}</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Paid drops</Text>
                <Text style={styles.statValue}>{status.dropsPaid ?? 0}</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Missed</Text>
                <Text style={styles.statValue}>{status.dropsMissed ?? 0}</Text>
              </Card>
            </View>

            <Card>
              <View style={styles.settingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.section}>Auto-fund drops</Text>
                  <Text style={styles.meta}>
                    When enabled, Ema can move only the missing amount into airfarming at drop time, using cash first
                    or available USDT crypto if cash cannot cover it.
                  </Text>
                </View>
                <Switch
                  value={Boolean(status.autoFundEnabled)}
                  onValueChange={(v) => void onToggleAutoFund(v)}
                  disabled={autoFundSaving}
                  trackColor={{ false: palette.border, true: palette.primary }}
                  thumbColor={status.autoFundEnabled ? '#0B1220' : palette.textSecondary}
                />
              </View>
              <Text style={styles.autoFundNote}>
                Auto-fund only runs if your current airfarming balance is below the required minimum and your wallet has
                enough cash/USDT to reach it. It does not reduce balances above the max range.
              </Text>
            </Card>

            <Animated.View style={[styles.heroRing, nearDrop ? urgentRingStyle : ringStyle]}>
              <Card style={nearDrop ? { ...styles.heroCard, ...styles.heroCardUrgent } : styles.heroCard}>
                <Text style={styles.heroLabel}>Next drop</Text>
                {nextDrop ? (
                  <>
                    <Text style={styles.countdown}>{formatDropCountdown(countdownSec)}</Text>
                    <Text style={styles.meta}>until eligibility check</Text>
                    <Text style={styles.heroBig}>+{nextDrop.percent.toFixed(0)}%</Text>
                    <Text style={styles.rangeLine}>
                      Required balance: {formatUsd(nextDrop.minBalance)} – {formatUsd(nextDrop.maxBalance)}
                    </Text>
                    <View
                      style={[
                        styles.eligibilityPill,
                        nextDrop.eligibleNow ? styles.eligibleYes : styles.eligibleNo,
                      ]}
                    >
                      <Text style={styles.eligibilityText}>
                        {nextDrop.eligibleNow
                          ? `Eligible now · est. +$${nextDrop.projectedProfit.toFixed(2)}`
                          : 'Not in range — adjust balance before drop'}
                      </Text>
                    </View>
                    <Text style={[styles.meta, { marginTop: 8 }]}>
                      Drops every 2–5 hours (UTC week). Profit only if balance is inside the range at drop time.
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.emptyDropTitle}>No active drop scheduled yet</Text>
                    <Text style={styles.meta}>
                      Pull to refresh or try again shortly. If this stays empty, the server is still finishing the
                      Airfarming update.
                    </Text>
                    <PrimaryButton label='Refresh schedule' onPress={() => void load()} style={{ marginTop: 12 }} />
                  </>
                )}
              </Card>
            </Animated.View>

            <Card>
              <Text style={styles.section}>Week summary</Text>
              <Text style={styles.meta}>
                Week starts {status.weekStart} (UTC). Drops are scheduled every 2–5 hours while the backend has an
                active current-week schedule.
              </Text>
            </Card>

            <Card>
              <Text style={styles.section}>Drop history</Text>
              {!status.history.length && <Text style={styles.meta}>No drops yet this week.</Text>}
              {status.history.map((h) => (
                <View key={h.id || String(h.createdAt)} style={styles.historyRow}>
                  <Text style={styles.row}>
                    {h.source === 'platform' ? 'Platform · ' : ''}
                    {h.status === 'paid'
                      ? `Paid +$${(h.profitAmount ?? 0).toFixed(2)}`
                      : h.status === 'missed'
                        ? 'Missed'
                        : ''}{' '}
                    · {h.percent.toFixed(0)}%
                    {h.minBalance != null && h.maxBalance != null
                      ? ` · ${formatUsd(h.minBalance)}–${formatUsd(h.maxBalance)}`
                      : ''}
                  </Text>
                  <Text style={styles.meta}>
                    {h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}
                    {h.eligibleBalance != null ? ` · balance $${h.eligibleBalance.toFixed(2)}` : ''}
                    {(h.autoFundedCash ?? 0) > 0 || (h.autoFundedCrypto ?? 0) > 0
                      ? ` · auto-funded $${((h.autoFundedCash ?? 0) + (h.autoFundedCrypto ?? 0)).toFixed(2)}`
                      : ''}
                  </Text>
                </View>
              ))}
            </Card>
          </>
        ) : !error ? (
          <Card>
            <Text style={styles.meta}>Loading…</Text>
          </Card>
        ) : null}
      </ScrollView>

      {status ? (
        <Pressable
          style={[styles.fab, { bottom: fabBottom, right: 16 }]}
          onPress={() => setFabMenuOpen(true)}
          accessibilityRole='button'
          accessibilityLabel='Open airfarming actions menu'
        >
          <Ionicons name='menu' size={28} color='#0B1220' />
        </Pressable>
      ) : null}

      <Modal visible={fabMenuOpen} transparent animationType='fade' onRequestClose={closeFabMenu}>
        <View style={styles.modalRoot}>
          <Pressable
            style={styles.modalBackdrop}
            onPress={() => {
              Keyboard.dismiss();
              closeFabMenu();
            }}
          />
          <View style={[styles.fabMenuCard, { bottom: fabBottom + 64, right: 16 }]} pointerEvents='box-none'>
            <Card style={styles.fabMenuInner}>
              <Text style={styles.fabMenuTitle}>Airfarming</Text>
              <Pressable style={styles.fabMenuItem} onPress={openActivate}>
                <Ionicons name='arrow-down-circle-outline' size={22} color={palette.primary} />
                <Text style={styles.fabMenuLabel}>Activate</Text>
                <Text style={styles.fabMenuHint}>Cash → airfarming</Text>
              </Pressable>
              <Pressable style={styles.fabMenuItem} onPress={openReturn}>
                <Ionicons name='arrow-up-circle-outline' size={22} color={palette.primary} />
                <Text style={styles.fabMenuLabel}>Return to cash</Text>
                <Text style={styles.fabMenuHint}>Airfarming → wallet</Text>
              </Pressable>
            </Card>
          </View>
        </View>
      </Modal>

      <Modal
        visible={activateModalOpen}
        transparent
        animationType='slide'
        onRequestClose={() => {
          setActivateModalOpen(false);
          setActivateAmount('');
        }}
      >
        <KeyboardAvoidingView
          style={styles.keyboardFlex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={keyboardOffset}
        >
          <View style={styles.formModalRoot}>
            <Pressable
              style={styles.formModalBackdrop}
              onPress={() => {
                Keyboard.dismiss();
                setActivateModalOpen(false);
                setActivateAmount('');
              }}
            />
            <View pointerEvents='box-none' style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}>
              <View style={[styles.formSheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
                <Text style={styles.formTitle}>Activate</Text>
                <Text style={styles.formSubtitle}>Move amount from your cash wallet into airfarming.</Text>
                <TextInput
                  style={styles.input}
                  value={activateAmount}
                  onChangeText={setActivateAmount}
                  placeholder='Amount (USD)'
                  placeholderTextColor={palette.textSecondary}
                  keyboardType='decimal-pad'
                />
                <View style={styles.buttonRow}>
                  <PrimaryButton label='Confirm' onPress={() => void onActivate()} style={{ flex: 1 }} />
                  <View style={{ width: 8 }} />
                  <PrimaryButton
                    label='Cancel'
                    onPress={() => {
                      setActivateModalOpen(false);
                      setActivateAmount('');
                    }}
                    variant='danger'
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={returnModalOpen}
        transparent
        animationType='slide'
        onRequestClose={() => {
          setReturnModalOpen(false);
          setReturnAmount('');
        }}
      >
        <KeyboardAvoidingView
          style={styles.keyboardFlex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={keyboardOffset}
        >
          <View style={styles.formModalRoot}>
            <Pressable
              style={styles.formModalBackdrop}
              onPress={() => {
                Keyboard.dismiss();
                setReturnModalOpen(false);
                setReturnAmount('');
              }}
            />
            <View pointerEvents='box-none' style={[StyleSheet.absoluteFillObject, { justifyContent: 'flex-end' }]}>
              <View style={[styles.formSheet, { paddingBottom: Math.max(insets.bottom, 16) + 16 }]}>
                <Text style={styles.formTitle}>Return to cash</Text>
                <Text style={styles.formSubtitle}>Move funds from airfarming back to your internal cash balance.</Text>
                <TextInput
                  style={styles.input}
                  value={returnAmount}
                  onChangeText={setReturnAmount}
                  placeholder='Amount (USD)'
                  placeholderTextColor={palette.textSecondary}
                  keyboardType='decimal-pad'
                />
                <View style={styles.buttonRow}>
                  <PrimaryButton label='Confirm' onPress={() => void onReturnToCash()} style={{ flex: 1 }} />
                  <View style={{ width: 8 }} />
                  <PrimaryButton
                    label='Cancel'
                    onPress={() => {
                      setReturnModalOpen(false);
                      setReturnAmount('');
                    }}
                    variant='danger'
                    style={{ flex: 1 }}
                  />
                </View>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  container: { flex: 1 },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  disclaimer: { color: palette.textSecondary, marginBottom: 14, lineHeight: 20 },
  heroRing: { marginBottom: 12 },
  heroCard: { alignItems: 'center' },
  heroCardUrgent: { borderColor: palette.primary, borderWidth: 1 },
  heroLabel: { color: palette.textSecondary, marginBottom: 4, fontWeight: '700', textTransform: 'uppercase', fontSize: 11 },
  countdown: { color: palette.textPrimary, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  heroBig: { color: palette.primary, fontSize: 36, fontWeight: '800', marginTop: 8 },
  rangeLine: { color: palette.textPrimary, fontSize: 15, fontWeight: '600', marginTop: 10, textAlign: 'center' },
  eligibilityPill: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  eligibleYes: { backgroundColor: 'rgba(0,200,5,0.15)' },
  eligibleNo: { backgroundColor: 'rgba(245,158,11,0.15)' },
  eligibilityText: { color: palette.textPrimary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  emptyDropTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  section: { color: palette.textSecondary, marginBottom: 8, fontWeight: '700' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  statCard: { width: '48%', marginBottom: 0, padding: 14 },
  statLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  statValue: { color: palette.textPrimary, fontSize: 22, fontWeight: '800' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  autoFundNote: { color: palette.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 8 },
  balanceLine: { marginBottom: 6 },
  balanceValue: { color: palette.textPrimary, fontWeight: '700', fontSize: 18 },
  buttonRow: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  input: {
    backgroundColor: palette.surfaceElevated,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 10,
    color: palette.textPrimary,
    padding: 12,
    marginBottom: 10,
  },
  row: { color: palette.textPrimary, marginBottom: 2, fontWeight: '600' },
  historyRow: { marginBottom: 10 },
  error: { color: palette.danger, marginBottom: 8 },
  fab: {
    position: 'absolute',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    zIndex: 10,
  },
  modalRoot: { flex: 1 },
  modalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  fabMenuCard: { position: 'absolute', zIndex: 2, minWidth: 220 },
  fabMenuInner: { marginBottom: 0, paddingVertical: 8 },
  fabMenuTitle: {
    color: palette.textSecondary,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
  },
  fabMenuItem: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: palette.border,
  },
  fabMenuLabel: { color: palette.textPrimary, fontSize: 16, fontWeight: '700', marginTop: 4 },
  fabMenuHint: { color: palette.textSecondary, fontSize: 12, marginTop: 2 },
  keyboardFlex: { flex: 1 },
  formModalRoot: { flex: 1, justifyContent: 'flex-end' },
  formModalBackdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.45)' },
  formSheet: {
    backgroundColor: palette.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 20,
    borderTopWidth: 1,
    borderColor: palette.border,
  },
  formTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '800', marginBottom: 8 },
  formSubtitle: { color: palette.textSecondary, marginBottom: 14, lineHeight: 20 },
});
