import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { palette } from '../theme/colors';

type CollapsibleNoticeProps = {
  noticeId: string;
  title: string;
  children: ReactNode;
  /** When true, user can dismiss permanently (stored per noticeId). */
  dismissible?: boolean;
  storageKeyPrefix?: string;
  defaultExpanded?: boolean;
  style?: object;
};

const DEFAULT_PREFIX = 'ema_notice_dismissed_';

export function CollapsibleNotice({
  noticeId,
  title,
  children,
  dismissible = false,
  storageKeyPrefix = DEFAULT_PREFIX,
  defaultExpanded = false,
  style,
}: CollapsibleNoticeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [dismissed, setDismissed] = useState(false);
  const dismissKey = `${storageKeyPrefix}${noticeId}`;

  useEffect(() => {
    if (!dismissible) return;
    void AsyncStorage.getItem(dismissKey).then((v) => setDismissed(v === '1'));
  }, [dismissKey, dismissible]);

  const onDismiss = async () => {
    await AsyncStorage.setItem(dismissKey, '1');
    setDismissed(true);
  };

  if (dismissible && dismissed) return null;

  return (
    <Card style={style}>
      <Pressable
        style={styles.header}
        onPress={() => setExpanded((v) => !v)}
        accessibilityRole='button'
        accessibilityLabel={`${title}, ${expanded ? 'collapse' : 'expand'}`}
      >
        <Text style={styles.title}>{title}</Text>
        <View style={styles.headerActions}>
          {dismissible ? (
            <Pressable onPress={() => void onDismiss()} hitSlop={10} accessibilityLabel='Dismiss'>
              <Ionicons name='close' size={20} color={palette.textSecondary} />
            </Pressable>
          ) : null}
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={palette.textSecondary}
            style={dismissible ? { marginLeft: 8 } : undefined}
          />
        </View>
      </Pressable>
      {expanded ? <View style={styles.body}>{children}</View> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center' },
  title: { color: palette.textPrimary, fontWeight: '700', fontSize: 15, flex: 1 },
  body: { marginTop: 10 },
});
