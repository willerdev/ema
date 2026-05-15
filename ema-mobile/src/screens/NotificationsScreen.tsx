import { useCallback, useState } from 'react';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { usePolling } from '../hooks/usePolling';
import { notificationService } from '../services/notificationService';
import type { AppNotification } from '../types';
import { palette } from '../theme/colors';
import { sanitizeUserFacingError } from '../utils/userFacingError';

function formatTime(iso: string) {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleString();
}

function audienceLabel(n: AppNotification) {
  return n.audience === 'broadcast' || !n.userId ? 'Announcement' : 'For you';
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
      setError(sanitizeUserFacingError(e?.message || 'Failed to load notifications'));
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
    Alert.alert('Clear inbox', 'Remove saved messages from this device? New updates will appear when you refresh.', [
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
      <Card style={styles.infoCard}>
        <View style={styles.infoHeader}>
          <Ionicons name='notifications' size={22} color={palette.primary} />
          <Text style={styles.infoTitle}>Inbox</Text>
        </View>
        <Text style={styles.sub}>
          Platform announcements and personal alerts appear here. Messages are saved on this device so you can read them
          again anytime.
        </Text>
      </Card>

      {error ? (
        <Card style={styles.errorCard}>
          <Text style={styles.warn}>{error}</Text>
          <Text style={styles.meta}>Showing previously saved messages when available.</Text>
        </Card>
      ) : null}

      {!items.length && !error ? (
        <Card>
          <Text style={styles.emptyTitle}>No messages yet</Text>
          <Text style={styles.meta}>Pull down to refresh when new updates are sent.</Text>
        </Card>
      ) : null}

      {items.map((n) => {
        const isBroadcast = n.audience === 'broadcast' || !n.userId;
        return (
          <Card
            key={n.id}
            style={isBroadcast ? styles.noticeCardBroadcast : styles.noticeCardPersonal}
          >
            <View style={styles.row}>
              <View style={styles.iconWrap}>
                <Ionicons
                  name={isBroadcast ? 'megaphone-outline' : 'person-circle-outline'}
                  size={20}
                  color={palette.primary}
                />
              </View>
              <View style={{ flex: 1 }}>
                <View style={styles.titleRow}>
                  <Text style={styles.title}>{n.title}</Text>
                  <Text style={[styles.badge, isBroadcast ? styles.badgeAll : styles.badgeUser]}>{audienceLabel(n)}</Text>
                </View>
                <Text style={styles.body}>{n.body}</Text>
                <Text style={styles.time}>{formatTime(n.createdAt)}</Text>
              </View>
            </View>
          </Card>
        );
      })}

      {items.length > 0 ? (
        <PrimaryButton label='Clear saved on device' onPress={onClearSaved} variant='danger' style={{ marginTop: 8 }} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  infoCard: { borderColor: palette.primary, marginBottom: 12 },
  infoHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  infoTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  sub: { color: palette.textSecondary, lineHeight: 20, fontSize: 13 },
  meta: { color: palette.textSecondary, fontSize: 13 },
  warn: { color: '#fbbf24', marginBottom: 6, fontSize: 14 },
  errorCard: { borderColor: '#b45309', marginBottom: 10 },
  emptyTitle: { color: palette.textPrimary, fontWeight: '700', marginBottom: 6 },
  noticeCardBroadcast: {
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: palette.primary,
    backgroundColor: palette.surface,
  },
  noticeCardPersonal: {
    marginBottom: 10,
    borderLeftWidth: 3,
    borderLeftColor: palette.success,
    backgroundColor: palette.surface,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, marginBottom: 6 },
  title: { color: palette.textPrimary, fontSize: 16, fontWeight: '700', flex: 1 },
  body: { color: palette.textSecondary, lineHeight: 20, marginBottom: 8, fontSize: 14 },
  time: { color: palette.textSecondary, fontSize: 11 },
  badge: {
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    overflow: 'hidden',
  },
  badgeAll: { backgroundColor: 'rgba(244, 197, 66, 0.2)', color: palette.primary },
  badgeUser: { backgroundColor: 'rgba(0, 200, 5, 0.15)', color: palette.success },
});
