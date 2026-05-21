import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { announcementService, AppAnnouncement } from '../services/announcementService';
import { palette } from '../theme/colors';

const dismissKey = (id: string) => `ema_announcement_dismissed_${id}`;

export function AnnouncementBanner() {
  const [announcement, setAnnouncement] = useState<AppAnnouncement | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await announcementService.getActive();
      const row = data.announcement;
      if (!row?.id) {
        setAnnouncement(null);
        return;
      }
      const dismissed = await AsyncStorage.getItem(dismissKey(row.id));
      if (dismissed === '1') {
        setAnnouncement(null);
        return;
      }
      setAnnouncement(row);
    } catch {
      setAnnouncement(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = () => {
    if (!announcement) return;
    void AsyncStorage.setItem(dismissKey(announcement.id), '1');
    setAnnouncement(null);
  };

  if (!announcement) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleRow}>
          <Ionicons name='megaphone-outline' size={20} color={palette.primary} />
          <Text style={styles.title}>{announcement.title}</Text>
        </View>
        <Pressable onPress={dismiss} hitSlop={12} accessibilityLabel='Dismiss announcement'>
          <Ionicons name='close-circle' size={22} color={palette.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.body}>{announcement.body}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: 12, borderColor: palette.primary, backgroundColor: '#141c2b' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 },
  titleRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { flex: 1, color: palette.primary, fontSize: 15, fontWeight: '700' },
  body: { color: palette.textPrimary, fontSize: 14, lineHeight: 20, marginTop: 10 },
});
