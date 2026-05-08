import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming } from 'react-native-reanimated';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { airfarmingService, type AirfarmingStatus } from '../services/airfarmingService';
import { palette } from '../theme/colors';

export function AirfarmingTradeScreen() {
  const [status, setStatus] = useState<AirfarmingStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pulse = useSharedValue(1);

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

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Airfarming</Text>
      <Text style={styles.disclaimer}>
        In-app yield events for engagement. Not a bank product; not on-chain yield; not financial advice.
      </Text>

      {error ? (
        <Card>
          <Text style={styles.error}>{error}</Text>
          <PrimaryButton label='Retry' onPress={() => void load()} />
        </Card>
      ) : null}

      {status ? (
        <>
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
              <Text key={h.id} style={styles.row}>
                +{h.percent}% — {new Date(h.createdAt).toLocaleString()}
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
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  disclaimer: { color: palette.textSecondary, marginBottom: 14, lineHeight: 20 },
  heroRing: { marginBottom: 12 },
  heroCard: { alignItems: 'center' },
  heroLabel: { color: palette.textSecondary, marginBottom: 4 },
  heroBig: { color: palette.primary, fontSize: 28, fontWeight: '800' },
  section: { color: palette.textSecondary, marginBottom: 6, fontWeight: '700' },
  meta: { color: palette.textSecondary, marginBottom: 4 },
  row: { color: palette.textPrimary, marginBottom: 6 },
  error: { color: palette.danger, marginBottom: 8 },
});
