import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { FormModal } from '../components/FormModal';
import { PrimaryButton } from '../components/PrimaryButton';
import { TRADE_HUB_HIDDEN_STORAGE_KEY, TRADE_HUB_ITEMS, TRADE_HUB_DEFAULT_HIDDEN, TradeHubItem, TradeHubItemId } from '../content/tradeHubItems';
import { airfarmingService } from '../services/airfarmingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const AIRFARMING_OPPORTUNITY_POLL_MS = 45_000;

async function loadHiddenIds(): Promise<TradeHubItemId[]> {
  try {
    const raw = await AsyncStorage.getItem(TRADE_HUB_HIDDEN_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TradeHubItemId[]) : TRADE_HUB_DEFAULT_HIDDEN;
    }
    const legacy = await AsyncStorage.getItem('ema_trade_hub_hidden_v1');
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed as TradeHubItemId[];
      }
    }
    return TRADE_HUB_DEFAULT_HIDDEN;
  } catch {
    return TRADE_HUB_DEFAULT_HIDDEN;
  }
}

async function saveHiddenIds(ids: TradeHubItemId[]) {
  await AsyncStorage.setItem(TRADE_HUB_HIDDEN_STORAGE_KEY, JSON.stringify(ids));
}

export function TradesHubScreen() {
  const navigation = useNavigation<Nav>();
  const [hiddenIds, setHiddenIds] = useState<TradeHubItemId[]>([]);
  const [hiddenModalOpen, setHiddenModalOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [airfarmingEligible, setAirfarmingEligible] = useState<boolean | null>(null);
  const [checkingAirfarming, setCheckingAirfarming] = useState(false);

  useEffect(() => {
    void loadHiddenIds().then((ids) => {
      setHiddenIds(ids);
      setReady(true);
    });
  }, []);

  const loadAirfarmingOpportunity = useCallback(async () => {
    setCheckingAirfarming(true);
    try {
      const status = await airfarmingService.getStatus();
      const eligible =
        status.nextDrop?.eligibleNow === true ||
        Boolean(status.upcomingDrops?.some((drop) => drop.eligibleNow === true));
      setAirfarmingEligible(eligible);
    } catch {
      setAirfarmingEligible(false);
    } finally {
      setCheckingAirfarming(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadAirfarmingOpportunity();
    }, [loadAirfarmingOpportunity])
  );

  useEffect(() => {
    const id = setInterval(() => {
      void loadAirfarmingOpportunity();
    }, AIRFARMING_OPPORTUNITY_POLL_MS);
    return () => clearInterval(id);
  }, [loadAirfarmingOpportunity]);

  const visibleItems = useMemo(
    () => TRADE_HUB_ITEMS.filter((item) => !hiddenIds.includes(item.id)),
    [hiddenIds]
  );
  const hiddenItems = useMemo(
    () => TRADE_HUB_ITEMS.filter((item) => hiddenIds.includes(item.id)),
    [hiddenIds]
  );

  const hideItem = useCallback(async (id: TradeHubItemId) => {
    const next = Array.from(new Set([...hiddenIds, id]));
    setHiddenIds(next);
    await saveHiddenIds(next);
  }, [hiddenIds]);

  const restoreItem = useCallback(async (id: TradeHubItemId) => {
    const next = hiddenIds.filter((x) => x !== id);
    setHiddenIds(next);
    await saveHiddenIds(next);
    if (next.length === 0) setHiddenModalOpen(false);
  }, [hiddenIds]);

  const restoreAll = useCallback(async () => {
    setHiddenIds([]);
    await saveHiddenIds([]);
    setHiddenModalOpen(false);
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <Pressable
          onPress={() => setHiddenModalOpen(true)}
          style={styles.headerBtn}
          hitSlop={12}
          accessibilityLabel='View hidden trading options'
        >
          <Ionicons name='eye-off-outline' size={24} color={palette.primary} />
          {hiddenIds.length > 0 ? (
            <View style={styles.headerBadge}>
              <Text style={styles.headerBadgeText}>{hiddenIds.length}</Text>
            </View>
          ) : null}
        </Pressable>
      ),
    });
  }, [navigation, hiddenIds.length]);

  const confirmHide = (item: TradeHubItem) => {
    Alert.alert('Hide option', `Hide "${item.title}" from your trading list? You can restore it from the eye icon.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Hide', onPress: () => void hideItem(item.id) },
    ]);
  };

  const renderCard = (item: TradeHubItem, showHide: boolean) => (
    <Card key={item.id} style={styles.hubCard}>
      <View style={styles.cardTopRow}>
        <Pressable
          style={{ flex: 1 }}
          onPress={() => {
            const parent = navigation.getParent();
            if (parent) parent.navigate(item.route);
            else navigation.navigate(item.route);
          }}
        >
          <Text style={styles.cardTitle}>{item.title}</Text>
          <Text style={styles.cardMeta}>{item.meta}</Text>
          <Text style={styles.roi}>{item.roi}</Text>
          {item.id === 'airfarming' ? (
            <View style={styles.opportunityRow}>
              {airfarmingEligible === null ? (
                <>
                  <ActivityIndicator size='small' color={palette.primary} />
                  <Text style={styles.opportunityText}>Checking live opportunities</Text>
                </>
              ) : airfarmingEligible ? (
                <>
                  {checkingAirfarming ? <ActivityIndicator size='small' color={palette.primary} /> : null}
                  <Ionicons name='checkmark-done-circle' size={14} color={palette.primary} />
                  <Text style={styles.opportunityText}>Opportunity eligible now</Text>
                </>
              ) : null}
            </View>
          ) : null}
        </Pressable>
        {showHide ? (
          <Pressable style={styles.hideBtn} onPress={() => confirmHide(item)} hitSlop={8}>
            <Ionicons name='eye-off-outline' size={18} color={palette.textSecondary} />
            <Text style={styles.hideBtnText}>Hide</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );

  return (
    <>
      <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
        <Text style={styles.title}>Trading</Text>
        <Text style={styles.sub}>
          Choose a trading mode. Tap Hide to remove an option from this list — use the eye icon above to restore.
        </Text>

        {!ready ? <Text style={styles.sub}>Loading…</Text> : null}

        {visibleItems.map((item) => renderCard(item, true))}

        {ready && visibleItems.length === 0 ? (
          <Card>
            <Text style={styles.cardMeta}>All trading options are hidden. Tap the eye icon to restore them.</Text>
            <PrimaryButton label='Show hidden options' onPress={() => setHiddenModalOpen(true)} style={{ marginTop: 12 }} />
          </Card>
        ) : null}
      </ScrollView>

      <FormModal
        visible={hiddenModalOpen}
        title='Hidden trading options'
        onClose={() => setHiddenModalOpen(false)}
        footer={
          <View style={{ gap: 8, marginTop: 12 }}>
            {hiddenItems.length > 1 ? (
              <PrimaryButton label='Restore all' onPress={() => void restoreAll()} />
            ) : null}
            <PrimaryButton label='Close' onPress={() => setHiddenModalOpen(false)} />
          </View>
        }
      >
        {hiddenItems.length === 0 ? (
          <Text style={styles.cardMeta}>Nothing hidden right now.</Text>
        ) : (
          hiddenItems.map((item) => (
            <View key={item.id} style={styles.hiddenRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{item.title}</Text>
                <Text style={styles.cardMeta}>{item.meta}</Text>
              </View>
              <PrimaryButton compact label='Restore' onPress={() => void restoreItem(item.id)} />
            </View>
          ))
        )}
      </FormModal>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: 6 },
  sub: { color: palette.textSecondary, marginBottom: 16, lineHeight: 20 },
  hubCard: { marginBottom: 12 },
  cardTopRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  cardTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 6 },
  cardMeta: { color: palette.textSecondary, marginBottom: 8 },
  roi: { color: palette.primary, fontWeight: '700' },
  opportunityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8, minHeight: 18 },
  opportunityText: { color: palette.primary, fontSize: 12, fontWeight: '700' },
  hideBtn: { alignItems: 'center', paddingTop: 4, paddingLeft: 8 },
  hideBtnText: { color: palette.textSecondary, fontSize: 11, marginTop: 2 },
  hiddenRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
  },
  headerBtn: { marginRight: 14, padding: 4, position: 'relative' },
  headerBadge: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: palette.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  headerBadgeText: { color: palette.background, fontSize: 10, fontWeight: '800' },
});
