import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { AirfarmingDropProgress, type AirfarmingDropPhase } from '../components/AirfarmingDropProgress';
import { Card } from '../components/Card';
import { CollapsibleNotice } from '../components/CollapsibleNotice';
import { UpcomingDropsList } from '../components/UpcomingDropsList';
import { PrimaryButton } from '../components/PrimaryButton';
import { useAuth } from '../context/AuthContext';
import {
  airfarmingService,
  formatDropCountdown,
  type AirfarmingStatus,
} from '../services/airfarmingService';
import { palette } from '../theme/colors';

const DEFAULT_POLL_SEC = 45;

function formatUsd(n: number): string {
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  return `$${n.toFixed(2)}`;
}

export function AirfarmingTradeScreen() {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const noticeDismissPrefix = user?.id ? `ema_airfarming_notice_${user.id}_` : 'ema_airfarming_notice_';
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
  const [showOpportunityCircle, setShowOpportunityCircle] = useState(false);
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [selectedDotDrop, setSelectedDotDrop] = useState<AirfarmingStatus['nextDrop'] | null>(null);
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

  const pollIntervalSec = status?.pollIntervalSec ?? DEFAULT_POLL_SEC;

  useEffect(() => {
    const id = setInterval(() => void load(), pollIntervalSec * 1000);
    return () => clearInterval(id);
  }, [load, pollIntervalSec]);

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

  const upcomingDrops =
    status?.upcomingDrops?.length ? status.upcomingDrops : status?.nextDrop ? [status.nextDrop] : [];
  const nextDrop = upcomingDrops[0] ?? status?.nextDrop ?? null;
  const trust = status?.withdrawalTrustScore;
  const nearDrop = countdownSec > 0 && countdownSec <= 120;
  const displayDropPhase: AirfarmingDropPhase =
    status?.lastSettledDrop?.dropPhase === 'rewarding'
      ? 'rewarding'
      : (nextDrop?.dropPhase ?? 'idle');
  const showRangeInfo = () => {
    Alert.alert(
      'How the required range works',
      'Each drop uses a fixed balance window shown in your upcoming drops list.\n\nEligibility is based on your airfarming balance recorded 24 hours before the drop — not on funds you add right before the drop opens.\n\nAuto-fund may still move excess balance back to cash when you are above the maximum. It cannot use late deposits to qualify if your 24-hour snapshot was outside the range.\n\nRanges are engineered from approximately $100 up to $2,000,000 to keep payouts fair across account sizes.'
    );
  };

  const showTrustScoreInfo = () => {
    Alert.alert(
      'Withdrawal trust score',
      'Your score (0–100%) reflects withdrawal activity across crypto payouts and cash wallet withdrawals.\n\nFewer withdrawals and no rejected or illegal withdrawals keep the score high. Heavy or frequent withdrawals lower it.\n\nThis score multiplies your potential airfarming drop payout. Rejected, failed, or flagged withdrawals have the largest negative impact.'
    );
  };

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: fabBottom + 72 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <Text style={styles.title}>Airfarming</Text>
        <Text style={styles.subtitle}>Earn on scheduled drops when your balance is in range.</Text>

        {error ? (
          <Card>
            <Text style={styles.error}>{error}</Text>
            <PrimaryButton label='Retry' onPress={() => void load()} />
          </Card>
        ) : null}

        {status ? (
          <>
            <View style={styles.gridTwo}>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Cash wallet</Text>
                <Text style={styles.statValue}>${Math.floor(status.cashWallet).toLocaleString()}</Text>
              </Card>
              <Card style={styles.statCard}>
                <Text style={styles.statLabel}>Airfarming</Text>
                <Text style={styles.statValue}>${Math.floor(status.airfarmingBalance).toLocaleString()}</Text>
              </Card>
            </View>

            <Animated.View style={[styles.heroRing, nearDrop ? urgentRingStyle : ringStyle]}>
              <Card style={nearDrop ? { ...styles.heroCard, ...styles.heroCardUrgent } : styles.heroCard}>
                <View style={styles.heroTopRow}>
                  <Text style={styles.heroLabel}>Next drop</Text>
                  {nextDrop ? (
                    <Pressable onPress={showRangeInfo} hitSlop={10} accessibilityLabel='How drops work'>
                      <Ionicons name='information-circle-outline' size={22} color={palette.textSecondary} />
                    </Pressable>
                  ) : null}
                </View>
                {nextDrop ? (
                  <>
                    <Text style={styles.countdown}>{formatDropCountdown(countdownSec)}</Text>
                    <Text style={styles.rangeLine}>
                      Required: {formatUsd(nextDrop.minBalance)} – {formatUsd(nextDrop.maxBalance)}
                      {nextDrop.percent != null ? ` · +${nextDrop.percent.toFixed(0)}%` : ''}
                    </Text>
                    {displayDropPhase !== 'idle' ? (
                      <AirfarmingDropProgress dropPhase={displayDropPhase} />
                    ) : null}
                    {status.lastSettledDrop?.status === 'paid' && displayDropPhase === 'rewarding' ? (
                      <Text style={styles.meta}>
                        Last drop paid +${(status.lastSettledDrop.profitAmount ?? 0).toFixed(2)}
                      </Text>
                    ) : null}
                    {status.lastSettledDrop?.status === 'missed' && displayDropPhase === 'rewarding' ? (
                      <Text style={styles.meta}>Last drop missed — outside required range</Text>
                    ) : null}
                  </>
                ) : (
                  <>
                    <Text style={styles.emptyDropTitle}>No drop scheduled</Text>
                    <PrimaryButton label='Refresh' onPress={() => void load()} style={{ marginTop: 12 }} />
                  </>
                )}
              </Card>
            </Animated.View>

            <Card>
              <Text style={styles.section}>Upcoming drops</Text>
              <UpcomingDropsList drops={upcomingDrops} />
            </Card>

            <Pressable
              style={styles.detailsToggle}
              onPress={() => setDetailsExpanded((v) => !v)}
              accessibilityRole='button'
            >
              <Text style={styles.detailsToggleText}>Details</Text>
              <Text style={styles.meta}>
                Paid {status.dropsPaid ?? 0} · Missed {status.dropsMissed ?? 0}
              </Text>
              <Ionicons
                name={detailsExpanded ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={palette.textSecondary}
              />
            </Pressable>

            {detailsExpanded ? (
              <>
                <CollapsibleNotice
                  noticeId='auto_fund'
                  title='Auto-fund drops'
                  storageKeyPrefix={noticeDismissPrefix}
                >
                  <View style={styles.settingRow}>
                    <Text style={[styles.meta, { flex: 1, marginBottom: 0 }]}>
                      Adjusts balance ~5 min before each drop (top-up or trim).
                    </Text>
                    <Switch
                      value={Boolean(status.autoFundEnabled)}
                      onValueChange={(v) => void onToggleAutoFund(v)}
                      disabled={autoFundSaving}
                      trackColor={{ false: palette.border, true: palette.primary }}
                      thumbColor={status.autoFundEnabled ? '#0B1220' : palette.textSecondary}
                    />
                  </View>
                </CollapsibleNotice>

                {status.platformHighlight ? (
                  <CollapsibleNotice
                    noticeId='platform_highlight'
                    title='Platform highlight'
                    storageKeyPrefix={noticeDismissPrefix}
                  >
                    <Text style={styles.meta}>
                      Reported +{status.platformHighlight.percent.toFixed(2)}% on{' '}
                      {status.platformHighlight.date}
                    </Text>
                  </CollapsibleNotice>
                ) : null}

                {trust ? (
                  <CollapsibleNotice
                    noticeId='trust_score'
                    title='Withdrawal trust score'
                    dismissible
                    storageKeyPrefix={noticeDismissPrefix}
                  >
                    <Pressable onPress={showTrustScoreInfo} hitSlop={10} style={{ marginBottom: 8 }}>
                      <Text style={styles.meta}>Tap for how this affects drop payouts</Text>
                    </Pressable>
                    <View style={styles.trustScoreRow}>
                      <Text style={styles.trustScoreValue}>{trust.score}%</Text>
                      <Text style={styles.trustBand}>{trust.label}</Text>
                    </View>
                    <Text style={styles.meta}>{trust.message}</Text>
                  </CollapsibleNotice>
                ) : null}

                {status.eligibilityNotice ? (
                  <CollapsibleNotice
                    noticeId='eligibility'
                    title='Eligibility notice'
                    dismissible
                    storageKeyPrefix={noticeDismissPrefix}
                  >
                    <Text style={styles.meta}>{status.eligibilityNotice}</Text>
                  </CollapsibleNotice>
                ) : null}

                <CollapsibleNotice
                  noticeId='disclaimer'
                  title='Important information'
                  dismissible
                  storageKeyPrefix={noticeDismissPrefix}
                >
                  <Text style={styles.meta}>
                    Funds in airfarming are separate from your cash wallet. Eligibility uses your balance recorded 24
                    hours before each drop. Auto-fund may adjust live balance before settlement but cannot change a late
                    snapshot. Not financial advice.
                  </Text>
                </CollapsibleNotice>

                <CollapsibleNotice noticeId='week' title='Week summary' storageKeyPrefix={noticeDismissPrefix}>
                  <Text style={styles.meta}>Week {status.weekStart} (UTC). Drops every 2–5 hours.</Text>
                </CollapsibleNotice>

                <CollapsibleNotice noticeId='history' title='Drop history' storageKeyPrefix={noticeDismissPrefix}>
                  {!status.history.length && <Text style={styles.meta}>No drops yet this week.</Text>}
                  {status.history.map((h) => (
                    <View key={h.id || String(h.createdAt)} style={styles.historyRow}>
                      <Text style={styles.row}>
                        {h.status === 'paid'
                          ? `Paid +$${(h.profitAmount ?? 0).toFixed(2)}`
                          : h.status === 'missed'
                            ? 'Missed'
                            : ''}{' '}
                        · {h.percent.toFixed(0)}%
                      </Text>
                    </View>
                  ))}
                </CollapsibleNotice>

                <CollapsibleNotice noticeId='opportunity' title='Opportunity circle' storageKeyPrefix={noticeDismissPrefix}>
                  <Pressable style={styles.toggleCircleBtn} onPress={() => setShowOpportunityCircle((v) => !v)}>
                    <Text style={styles.toggleCircleLabel}>
                      {showOpportunityCircle ? 'Hide circle' : 'Show circle'}
                    </Text>
                  </Pressable>
                  {showOpportunityCircle ? (
                    <View style={styles.dotWrap}>
                      <Animated.View style={[styles.dotRing, ringStyle]} />
                      <View style={styles.dotRingInner}>
                        {upcomingDrops.slice(0, 12).map((d, i) => {
                          const angle =
                            (i / Math.max(1, Math.min(12, upcomingDrops.length))) * Math.PI * 2 - Math.PI / 2;
                          const radius = 74;
                          const x = 88 + Math.cos(angle) * radius;
                          const y = 88 + Math.sin(angle) * radius;
                          return (
                            <Pressable
                              key={d.previewKey}
                              onPress={() => setSelectedDotDrop(d)}
                              style={[
                                styles.dot,
                                {
                                  left: x,
                                  top: y,
                                  backgroundColor: d.eligibleNow === true ? '#3b82f6' : '#ef4444',
                                  transform: [{ translateX: -6 }, { translateY: -6 }],
                                },
                              ]}
                            />
                          );
                        })}
                      </View>
                    </View>
                  ) : null}
                </CollapsibleNotice>
              </>
            ) : null}
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
        visible={Boolean(selectedDotDrop)}
        transparent
        animationType='fade'
        onRequestClose={() => setSelectedDotDrop(null)}
      >
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setSelectedDotDrop(null)} />
          <View style={styles.dotModalCardWrap} pointerEvents='box-none'>
            <Card style={styles.dotModalCard}>
              <Text style={styles.dotTitle}>
                {selectedDotDrop ? `Drop #${selectedDotDrop.dropIndex + 1}` : 'Drop details'}
              </Text>
              {selectedDotDrop ? (
                <>
                  <Text style={styles.dotRow}>
                    Time: {new Date(selectedDotDrop.dueAt).toLocaleString(undefined, { timeZone: 'UTC' })}
                  </Text>
                  <Text style={styles.dotRow}>
                    Required amount: {formatUsd(selectedDotDrop.minBalance)} – {formatUsd(selectedDotDrop.maxBalance)}
                  </Text>
                  <View style={styles.dotStatusRow}>
                    {selectedDotDrop.eligibleNow == null ? (
                      <>
                        <ActivityIndicator size='small' color={palette.primary} />
                        <Text style={styles.dotHint}>Checking availability</Text>
                      </>
                    ) : selectedDotDrop.eligibleNow ? (
                      <>
                        <Ionicons name='checkmark-circle' size={16} color={palette.primary} />
                        <Text style={styles.dotHint}>Amount available</Text>
                      </>
                    ) : (
                      <>
                        <Ionicons name='close-circle' size={16} color='#ef4444' />
                        <Text style={styles.dotHint}>Amount not available</Text>
                      </>
                    )}
                  </View>
                </>
              ) : null}
              <PrimaryButton label='Close' onPress={() => setSelectedDotDrop(null)} style={{ marginTop: 12 }} />
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
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 4 },
  subtitle: { color: palette.textSecondary, marginBottom: 12, lineHeight: 18, fontSize: 14 },
  disclaimer: { color: palette.textSecondary, marginBottom: 14, lineHeight: 20 },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
    paddingVertical: 8,
  },
  detailsToggleText: { color: palette.textPrimary, fontWeight: '700', fontSize: 15, flex: 1 },
  heroTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 4,
  },
  heroRing: { marginBottom: 12 },
  heroCard: { alignItems: 'center' },
  heroCardUrgent: { borderColor: palette.primary, borderWidth: 1 },
  heroLabel: { color: palette.textSecondary, marginBottom: 4, fontWeight: '700', textTransform: 'uppercase', fontSize: 11 },
  countdown: { color: palette.textPrimary, fontSize: 32, fontWeight: '800', fontVariant: ['tabular-nums'] },
  percentRow: {
    marginTop: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  heroBig: { color: palette.primary, fontSize: 36, fontWeight: '800' },
  rangeRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  rangeLine: { color: palette.textPrimary, fontSize: 15, fontWeight: '600', textAlign: 'center' },
  eligibilityPill: { marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },
  eligibleYes: { backgroundColor: 'rgba(0,200,5,0.15)' },
  eligibleNo: { backgroundColor: 'rgba(245,158,11,0.15)' },
  eligibilityText: { color: palette.textPrimary, fontSize: 12, fontWeight: '600', textAlign: 'center' },
  emptyDropTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '800', marginBottom: 8, textAlign: 'center' },
  section: { color: palette.textSecondary, marginBottom: 8, fontWeight: '700' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 },
  gridTwo: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  statCard: { flex: 1, marginBottom: 0, padding: 14 },
  statLabel: { color: palette.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8 },
  statValue: { color: palette.textPrimary, fontSize: 22, fontWeight: '800' },
  settingRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  autoFundNote: { color: palette.textSecondary, fontSize: 11, lineHeight: 16, marginTop: 8 },
  dotWrap: { alignItems: 'center', justifyContent: 'center', marginTop: 8, marginBottom: 12 },
  toggleCircleBtn: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
    marginBottom: 8,
  },
  toggleCircleLabel: { color: palette.primary, fontSize: 12, fontWeight: '700' },
  dotRing: {
    width: 176,
    height: 176,
    borderRadius: 88,
    borderWidth: 2,
    borderColor: palette.primary,
    opacity: 0.55,
  },
  dotRingInner: {
    position: 'absolute',
    width: 176,
    height: 176,
    borderRadius: 88,
  },
  dot: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: palette.surface,
  },
  dotTitle: { color: palette.textPrimary, fontSize: 16, fontWeight: '800', marginBottom: 6 },
  dotRow: { color: palette.textPrimary, fontSize: 13, fontWeight: '600', marginBottom: 4 },
  dotHint: { color: palette.textSecondary, fontSize: 12, lineHeight: 16 },
  dotStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 },
  dotModalCardWrap: { position: 'absolute', left: 16, right: 16, top: '32%' },
  dotModalCard: { marginBottom: 0 },
  noticeCard: { borderColor: palette.primary, borderLeftWidth: 3, marginBottom: 12 },
  trustHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginBottom: 8 },
  trustCardWarn: { borderColor: '#f59e0b', borderLeftWidth: 3 },
  trustScoreRow: { flexDirection: 'row', alignItems: 'baseline', gap: 10, marginBottom: 10 },
  trustScoreValue: { fontSize: 32, fontWeight: '800' },
  trustExcellent: { color: palette.primary },
  trustFair: { color: '#fbbf24' },
  trustPoor: { color: '#f87171' },
  trustBand: { color: palette.textSecondary, fontSize: 15, fontWeight: '700' },
  trustBarTrack: {
    height: 8,
    borderRadius: 4,
    backgroundColor: palette.surfaceElevated,
    overflow: 'hidden',
    marginBottom: 10,
  },
  trustBarFill: { height: '100%', borderRadius: 4 },
  trustBarExcellent: { backgroundColor: palette.primary },
  trustBarFair: { backgroundColor: '#fbbf24' },
  trustBarPoor: { backgroundColor: '#f87171' },
  trustIllegal: { color: '#fbbf24', fontSize: 12, lineHeight: 17, marginTop: 6 },
  trustAdjust: { color: palette.textPrimary, fontSize: 12, lineHeight: 17, marginTop: 6, fontWeight: '600' },
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
