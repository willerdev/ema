import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { airfarmingService, type AirfarmingStatus } from '../services/airfarmingService';
import { palette } from '../theme/colors';

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
  const pulse = useSharedValue(1);

  const fabBottom = Math.max(insets.bottom, 12) + 16;
  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 56 : 0;

  useEffect(() => {
    pulse.value = withRepeat(withSequence(withTiming(1.04, { duration: 900 }), withTiming(1, { duration: 900 })), -1, true);
  }, [pulse]);

  const ringStyle = useAnimatedStyle(() => ({
    transform: [{ scale: pulse.value }],
  }));

  const load = useCallback(async () => {
    setError(null);
    try {
      const s = await airfarmingService.getStatus();
      setStatus(s);
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

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ padding: 16, paddingBottom: fabBottom + 72 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <Text style={styles.title}>Airfarming</Text>
        <Text style={styles.disclaimer}>
          Funds in airfarming are separate from your cash wallet. Move them back to cash here before using wallet withdraw.
          Weekly % events are for engagement; not a bank product; not on-chain; not financial advice.
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
            <Card>
              <Text style={styles.section}>Balances</Text>
              <Text style={styles.balanceLine}>
                <Text style={styles.meta}>Cash wallet: </Text>
                <Text style={styles.balanceValue}>${status.cashWallet.toFixed(2)}</Text>
              </Text>
              <Text style={styles.balanceLine}>
                <Text style={styles.meta}>In airfarming: </Text>
                <Text style={styles.balanceValue}>${status.airfarmingBalance.toFixed(2)}</Text>
              </Text>
              <Text style={[styles.meta, { marginTop: 8 }]}>
                Use the menu button (bottom right) to activate or return funds.
              </Text>
            </Card>

            <Animated.View style={[styles.heroRing, ringStyle]}>
              <Card style={styles.heroCard}>
                <Text style={styles.heroLabel}>This week</Text>
                <Text style={styles.heroBig}>
                  {status.weeklyUsed} / {status.weeklyTarget} events
                </Text>
                <Text style={styles.meta}>Week starts {status.weekStart} (UTC)</Text>
                {status.lastEventAt ? <Text style={styles.meta}>Last event: {new Date(status.lastEventAt).toLocaleString()}</Text> : null}
              </Card>
            </Animated.View>

            <Card>
              <Text style={styles.section}>Schedule (hours from week start)</Text>
              <Text style={styles.meta}>{(status.scheduleHours || []).join(', ') || '—'}</Text>
            </Card>

            <Card>
              <Text style={styles.section}>Recent events</Text>
              {!status.history.length && <Text style={styles.meta}>No events yet this week.</Text>}
              {status.history.map((h) => (
                <Text key={h.id || String(h.createdAt)} style={styles.row}>
                  +{Number(h.percent ?? 0).toFixed(0)}% —{' '}
                  {h.createdAt ? new Date(h.createdAt).toLocaleString() : '—'}
                </Text>
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
  heroLabel: { color: palette.textSecondary, marginBottom: 4 },
  heroBig: { color: palette.primary, fontSize: 28, fontWeight: '800' },
  section: { color: palette.textSecondary, marginBottom: 8, fontWeight: '700' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
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
  row: { color: palette.textPrimary, marginBottom: 6 },
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
  fabMenuTitle: { color: palette.textSecondary, fontSize: 12, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase' },
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
