import { useCallback, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { ActivityListSkeleton } from '../components/Skeleton';
import { WalletActivityList } from '../components/WalletActivityList';
import { usePolling } from '../hooks/usePolling';
import { useTransactionFeed } from '../hooks/useTransactionFeed';
import type { RootStackParamList, TransactionHistoryTab } from '../types';
import { palette } from '../theme/colors';
import {
  filterActivityByAsset,
  filterActivityByMethod,
  filterActivityByTab,
  formatAssetDisplay,
  uniqueAssets,
} from '../utils/walletActivity';

type Nav = NativeStackNavigationProp<RootStackParamList, 'TransactionHistory'>;
type Route = RouteProp<RootStackParamList, 'TransactionHistory'>;

const TABS: { key: TransactionHistoryTab; label: string }[] = [
  { key: 'all', label: 'Transactions' },
  { key: 'deposit', label: 'Deposit' },
  { key: 'withdraw', label: 'Withdraw' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'p2p', label: 'P2P' },
  { key: 'fiat', label: 'Fiat' },
];

const METHOD_OPTIONS = [
  { key: 'all', label: 'All methods' },
  { key: 'onchain', label: 'On-chain' },
  { key: 'internal', label: 'Member transfer' },
  { key: 'mobile', label: 'Mobile money' },
];

export function TransactionHistoryScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const initialTab = route.params?.initialTab ?? 'all';

  const { rows, loading, error, refresh } = useTransactionFeed();
  const [tab, setTab] = useState<TransactionHistoryTab>(initialTab);
  const [assetFilter, setAssetFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [refreshing, setRefreshing] = useState(false);
  const [assetMenuOpen, setAssetMenuOpen] = useState(false);
  const [methodMenuOpen, setMethodMenuOpen] = useState(false);

  usePolling(refresh, 60000, true);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refresh();
    setRefreshing(false);
  }, [refresh]);

  const tabRows = useMemo(() => filterActivityByTab(rows, tab), [rows, tab]);
  const assetOptions = useMemo(() => uniqueAssets(tabRows), [tabRows]);

  const filtered = useMemo(() => {
    let list = filterActivityByAsset(tabRows, assetFilter);
    list = filterActivityByMethod(list, methodFilter);
    return list;
  }, [tabRows, assetFilter, methodFilter]);

  const assetLabel =
    assetFilter === 'all' ? 'All assets' : formatAssetDisplay(assetFilter);
  const methodLabel = METHOD_OPTIONS.find((m) => m.key === methodFilter)?.label ?? 'All methods';

  const openDetail = (row: (typeof rows)[0]) => {
    navigation.navigate('TransactionDetail', { row });
  };

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.tabBar}
        contentContainerStyle={styles.tabContent}
      >
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <Pressable key={t.key} style={styles.tabItem} onPress={() => setTab(t.key)}>
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
              {active ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.filters}>
        <Pressable style={styles.filterBtn} onPress={() => setAssetMenuOpen((v) => !v)}>
          <Text style={styles.filterText}>{assetLabel}</Text>
          <Ionicons name='chevron-down' size={14} color={palette.textSecondary} />
        </Pressable>
        <Pressable style={styles.filterBtn} onPress={() => setMethodMenuOpen((v) => !v)}>
          <Text style={styles.filterText}>{methodLabel}</Text>
          <Ionicons name='chevron-down' size={14} color={palette.textSecondary} />
        </Pressable>
      </View>

      {assetMenuOpen ? (
        <View style={styles.menu}>
          {assetOptions.map((a) => (
            <Pressable
              key={a}
              style={styles.menuItem}
              onPress={() => {
                setAssetFilter(a);
                setAssetMenuOpen(false);
              }}
            >
              <Text style={styles.menuText}>{a === 'all' ? 'All assets' : formatAssetDisplay(a)}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {methodMenuOpen ? (
        <View style={styles.menu}>
          {METHOD_OPTIONS.map((m) => (
            <Pressable
              key={m.key}
              style={styles.menuItem}
              onPress={() => {
                setMethodFilter(m.key);
                setMethodMenuOpen(false);
              }}
            >
              <Text style={styles.menuText}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <ScrollView
        style={styles.list}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
      >
        {loading && !rows.length ? <ActivityListSkeleton rows={8} /> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        {!loading || rows.length ? (
          <WalletActivityList
            rows={filtered}
            variant='compact'
            emptyMessage='No transactions in this category.'
            onPressRow={openDetail}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  tabBar: { maxHeight: 48, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  tabContent: { paddingHorizontal: 8, alignItems: 'flex-end' },
  tabItem: { paddingHorizontal: 14, paddingVertical: 12, marginRight: 4 },
  tabText: { color: palette.textSecondary, fontSize: 15, fontWeight: '600' },
  tabTextActive: { color: palette.textPrimary },
  tabUnderline: {
    position: 'absolute',
    bottom: 0,
    left: 14,
    right: 14,
    height: 2,
    backgroundColor: palette.textPrimary,
    borderRadius: 1,
  },
  filters: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  filterText: { color: palette.textPrimary, fontSize: 14, fontWeight: '600' },
  menu: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: palette.surfaceElevated,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    overflow: 'hidden',
  },
  menuItem: { paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.border },
  menuText: { color: palette.textPrimary, fontSize: 14 },
  list: { flex: 1, paddingHorizontal: 16 },
  error: { color: '#f87171', marginBottom: 12 },
});
