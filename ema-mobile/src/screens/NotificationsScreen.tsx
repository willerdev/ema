import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { notificationService } from '../services/notificationService';
import type { AppNotification } from '../types';
import { palette } from '../theme/colors';

function formatTime(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function audienceLabel(n: AppNotification) {
  return n.audience === 'broadcast' || !n.userId ? 'Everyone' : 'Personal';
}

export function NotificationsScreen() {
  const [items, setItems] = useState<AppNotification[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await notificationService.fetchInbox();
      const merged = await notificationService.mergeAndSave(res.notifications || []);
      setItems(merged);
    } catch (e: any) {
      const msg = String(e?.message || 'Failed to load notifications');
      setError(msg);
      const saved = await notificationService.loadSaved();
      setItems(saved);
    }
  }, []);

  usePolling(refresh, 60000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const onClearSaved = () => {
    Alert.alert('Clear saved', 'Remove locally saved notifications? New messages will still load from the server.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Clear',
        style: 'destructive',
        onPress: async () => {
          await notificationService.clearSaved();
          setItems([]);
        },
      },
    ]);
  };

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={{ padding: 16, paddingBottom: 32 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.sub}>
        Messages without a valid user ID are sent to everyone. Messages with your user ID are personal only. All received
        notifications are saved on this device.
      </Text>

      {error ? (
        <Card>
          <Text style={styles.warn}>{error}</Text>
          <Text style={styles.meta}>Showing saved copies when available.</Text>
        </Card>
      ) : null}

      {!items.length ? (
        <Card>
          <Text style={styles.meta}>No notifications yet.</Text>
        </Card>
      ) : null}

      {items.map((n) => (
        <Card key={n.id} style={styles.noticeCard}>
          <View style={styles.row}>
            <Text style={styles.title}>{n.title}</Text>
            <Text style={[styles.badge, n.audience === 'broadcast' ? styles.badgeAll : styles.badgeUser]}>
              {audienceLabel(n)}
            </Text>
          </View>
          <Text style={styles.body}>{n.body}</Text>
          <Text style={styles.time}>{formatTime(n.createdAt)}</Text>
        </Card>
      ))}

      {items.length > 0 ? (
        <PrimaryButton label='Clear saved on device' onPress={onClearSaved} variant='danger' style={{ marginTop: 8 }} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  sub: { color: palette.textSecondary, lineHeight: 20, marginBottom: 14, fontSize: 13 },
  meta: { color: palette.textSecondary },
  warn: { color: '#fbbf24', marginBottom: 6 },
  noticeCard: { marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 8 },
  title: { color: palette.textPrimary, fontSize: 17, fontWeight: '700', flex: 1 },
  body: { color: palette.textPrimary, lineHeight: 20, marginBottom: 8 },
  time: { color: palette.textSecondary, fontSize: 12 },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    overflow: 'hidden',
  },
  badgeAll: { backgroundColor: '#1e3a5f', color: '#93c5fd' },
  badgeUser: { backgroundColor: '#3f2e12', color: '#fcd34d' },
});
