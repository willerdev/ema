import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '../components/Card';
import { MenuListSkeleton } from '../components/Skeleton';
import { ExtraStackParamList } from '../types';
import { palette } from '../theme/colors';
import { navigateToTransactionHistory } from '../utils/navigationHelpers';

type Nav = NativeStackNavigationProp<ExtraStackParamList, 'ExtraHub'>;

function ExtraMenuRow({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={22} color={palette.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{title}</Text>
        <Text style={styles.rowSubtitle}>{subtitle}</Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

export function ExtraHubScreen() {
  const navigation = useNavigation<Nav>();
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    await new Promise((r) => setTimeout(r, 280));
    setLoading(false);
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load();
    }, [load])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    setLoading(true);
    await load();
    setRefreshing(false);
  }, [load]);

  const openHistory = () => {
    const root = navigation.getParent()?.getParent();
    if (root) {
      navigateToTransactionHistory(root);
    } else {
      navigateToTransactionHistory(navigation);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        <Text style={styles.title}>Extra</Text>
        <Text style={styles.sub}>Peer trading and account settings</Text>

        {loading ? (
          <MenuListSkeleton rows={5} />
        ) : (
          <Card style={styles.menuCard}>
            <ExtraMenuRow
              title='Asset history'
              subtitle='Deposits, withdrawals, transfers, and more'
              icon='time-outline'
              onPress={openHistory}
            />
            <ExtraMenuRow
              title='Send by ID'
              subtitle='Transfer trading USD to another member'
              icon='arrow-forward-circle-outline'
              onPress={() => navigation.navigate('SendById')}
            />
            <ExtraMenuRow
              title='P2P'
              subtitle='USDT rates in your local currency'
              icon='swap-horizontal-outline'
              onPress={() => navigation.navigate('P2P')}
            />
            <ExtraMenuRow
              title='Mobile money'
              subtitle='Deposit or withdraw with your phone number'
              icon='phone-portrait-outline'
              onPress={() => navigation.navigate('LocalMoney')}
            />
            <ExtraMenuRow
              title='MT5'
              subtitle='Connect account and monitor live broker activity'
              icon='analytics-outline'
              onPress={() => navigation.navigate('MT5')}
            />
            <ExtraMenuRow
              title='Settings'
              subtitle='Profile, security, compliance, and more'
              icon='settings-outline'
              onPress={() => navigation.navigate('Settings')}
            />
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.background },
  scroll: { flex: 1, backgroundColor: palette.background },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 24 },
  title: { color: palette.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: 6 },
  sub: { color: palette.textSecondary, marginBottom: 16, lineHeight: 20 },
  menuCard: { paddingVertical: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: palette.border,
    gap: 12,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: palette.surfaceElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  rowSubtitle: { color: palette.textSecondary, fontSize: 13, marginTop: 2 },
  chevron: { color: palette.textSecondary, fontSize: 22 },
});
