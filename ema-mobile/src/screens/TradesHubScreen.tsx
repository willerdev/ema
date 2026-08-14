import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { TRADE_HUB_ITEMS, TradeHubItem } from '../content/tradeHubItems';
import { airfarmingService } from '../services/airfarmingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList>;
const AIRFARMING_OPPORTUNITY_POLL_MS = 45_000;

export function TradesHubScreen() {
  const navigation = useNavigation<Nav>();
  const [airfarmingEligible, setAirfarmingEligible] = useState<boolean | null>(null);
  const [checkingAirfarming, setCheckingAirfarming] = useState(false);

  const loadAirfarmingOpportunity = useCallback(async () => {
    setCheckingAirfarming(true);
    try {
      const status = await airfarmingService.getStatus();
      const eligible =
        !status.dropsPaused &&
        (status.nextDrop?.eligibleNow === true ||
          Boolean(status.upcomingDrops?.some((drop) => drop.eligibleNow === true)));
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

  const openProduct = (item: TradeHubItem) => {
    const parent = navigation.getParent();
    if (parent) parent.navigate(item.route);
    else navigation.navigate(item.route);
  };

  const renderCard = (item: TradeHubItem) => (
    <Card key={item.id} style={styles.hubCard}>
      <Pressable onPress={() => openProduct(item)}>
        <View style={styles.cardHeader}>
          <Ionicons
            name={item.id === 'airfarming' ? 'leaf-outline' : 'diamond-outline'}
            size={28}
            color={palette.primary}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>{item.title}</Text>
            <Text style={styles.cardMeta}>{item.meta}</Text>
          </View>
          <Ionicons name='chevron-forward' size={22} color={palette.textSecondary} />
        </View>
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
                <Text style={styles.opportunityText}>Drop eligible now</Text>
              </>
            ) : (
              <Text style={styles.opportunityMuted}>No live drop right now — check back soon</Text>
            )}
          </View>
        ) : null}
      </Pressable>
    </Card>
  );

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16, paddingBottom: 32 }}>
      <Text style={styles.title}>Products</Text>
      <Text style={styles.sub}>
        Deposit from Wallet, then join Airfarmers drops or lock capital in VIP Farmers.
      </Text>
      {TRADE_HUB_ITEMS.map(renderCard)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: 6 },
  sub: { color: palette.textSecondary, marginBottom: 16, lineHeight: 20 },
  hubCard: { marginBottom: 12 },
  cardHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 8 },
  cardTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 4 },
  cardMeta: { color: palette.textSecondary, lineHeight: 18 },
  roi: { color: palette.primary, fontWeight: '700', marginTop: 4 },
  opportunityRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, minHeight: 18 },
  opportunityText: { color: palette.primary, fontSize: 12, fontWeight: '700' },
  opportunityMuted: { color: palette.textSecondary, fontSize: 12, marginTop: 10 },
});
