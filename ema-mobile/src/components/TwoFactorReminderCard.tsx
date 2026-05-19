import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import { ExtraStackParamList, RootTabParamList } from '../types';
import { palette } from '../theme/colors';

const DISMISS_KEY_PREFIX = 'ema_2fa_reminder_dismissed_';
const REMIND_LATER_MS = 7 * 24 * 60 * 60 * 1000;

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<RootTabParamList, 'Home'>,
  NativeStackNavigationProp<ExtraStackParamList>
>;

export function TwoFactorReminderCard() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(true);

  const dismissKey = user?.id ? `${DISMISS_KEY_PREFIX}${user.id}` : null;

  const load = useCallback(async () => {
    if (!user?.id) {
      setVisible(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const status = await authService.getTotpStatus();
      if (status.enabled) {
        setVisible(false);
        return;
      }
      const raw = dismissKey ? await AsyncStorage.getItem(dismissKey) : null;
      if (raw) {
        const dismissedAt = Number(raw);
        if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < REMIND_LATER_MS) {
          setVisible(false);
          return;
        }
      }
      setVisible(true);
    } catch {
      setVisible(false);
    } finally {
      setLoading(false);
    }
  }, [user?.id, dismissKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const dismiss = async () => {
    if (dismissKey) await AsyncStorage.setItem(dismissKey, String(Date.now()));
    setVisible(false);
  };

  const openSecurity = () => {
    navigation.navigate('Extra', { screen: 'Settings', params: { openSecurity: true } });
  };

  if (loading || !visible) return null;

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <Ionicons name='shield-checkmark-outline' size={22} color={palette.primary} />
        <Text style={styles.title}>Protect your account</Text>
        <Pressable onPress={() => void dismiss()} hitSlop={12} accessibilityLabel='Dismiss 2FA reminder'>
          <Ionicons name='close' size={22} color={palette.textSecondary} />
        </Pressable>
      </View>
      <Text style={styles.body}>
        Turn on two-factor authentication for stronger sign-in and withdrawal protection.
      </Text>
      <Pressable onPress={openSecurity} style={styles.cta}>
        <Text style={styles.ctaText}>Set up 2FA in Settings</Text>
        <Ionicons name='chevron-forward' size={18} color={palette.primary} />
      </Pressable>
      <Pressable onPress={() => void dismiss()}>
        <Text style={styles.later}>Remind me later</Text>
      </Pressable>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { borderLeftWidth: 3, borderLeftColor: palette.primary, marginBottom: 12 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  title: { flex: 1, color: palette.textPrimary, fontSize: 16, fontWeight: '700' },
  body: { color: palette.textSecondary, lineHeight: 20, marginBottom: 12 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: palette.surfaceElevated,
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  ctaText: { color: palette.primary, fontWeight: '700', fontSize: 15 },
  later: { color: palette.textSecondary, textAlign: 'center', marginTop: 10, fontSize: 13 },
});
