import { useCallback, useState } from 'react';
import {
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { PrimaryButton } from '../components/PrimaryButton';
import { mt5Service } from '../services/mt5Service';
import type { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

const STORAGE_ACTIVE = 'ema_expert_ea_active';
const STORAGE_DERIVED = 'ema_expert_ea_derived';
const STORAGE_FOREX = 'ema_expert_ea_forex';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function ExpertAutoTradingScreen() {
  const navigation = useNavigation<Nav>();
  const [mt5Connected, setMt5Connected] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [eaActive, setEaActive] = useState(false);
  const [derivedMarkets, setDerivedMarkets] = useState(false);
  const [forexMarket, setForexMarket] = useState(false);
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  const loadPrefs = useCallback(async () => {
    const [a, d, f] = await Promise.all([
      AsyncStorage.getItem(STORAGE_ACTIVE),
      AsyncStorage.getItem(STORAGE_DERIVED),
      AsyncStorage.getItem(STORAGE_FOREX),
    ]);
    setEaActive(a === '1');
    setDerivedMarkets(d === '1');
    setForexMarket(f === '1');
    setPrefsLoaded(true);
  }, []);

  const checkMt5 = useCallback(async () => {
    try {
      const list = await mt5Service.listAccounts();
      const rows = list.accounts || [];
      setMt5Connected(rows.length > 0);
    } catch {
      setMt5Connected(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void loadPrefs();
      void checkMt5();
    }, [loadPrefs, checkMt5])
  );

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await checkMt5();
    setRefreshing(false);
  }, [checkMt5]);

  const persist = async (key: string, value: boolean) => {
    await AsyncStorage.setItem(key, value ? '1' : '0');
  };

  const setEaActiveSafe = async (next: boolean) => {
    if (next && !derivedMarkets && !forexMarket) {
      Alert.alert('Markets', 'Choose at least one: Derived markets and/or Forex market.');
      return;
    }
    setEaActive(next);
    await persist(STORAGE_ACTIVE, next);
  };

  const setDerived = async (next: boolean) => {
    setDerivedMarkets(next);
    await persist(STORAGE_DERIVED, next);
    if (eaActive && !next && !forexMarket) {
      setEaActive(false);
      await persist(STORAGE_ACTIVE, false);
    }
  };

  const setForex = async (next: boolean) => {
    setForexMarket(next);
    await persist(STORAGE_FOREX, next);
    if (eaActive && !next && !derivedMarkets) {
      setEaActive(false);
      await persist(STORAGE_ACTIVE, false);
    }
  };

  const goMt5 = () => {
    navigation.navigate('MainTabs', { screen: 'MT5' });
  };

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={palette.primary} />}
    >
      <Text style={styles.title}>Expert auto trading</Text>
      <Text style={styles.sub}>
        When enabled, the expert advisor (EA) simulation targets the markets you select below. You must link an MT5 account
        first so execution context is available.
      </Text>

      {mt5Connected === false ? (
        <Card>
          <Text style={styles.cardTitle}>Connect MT5</Text>
          <Text style={styles.meta}>
            Link your MetaTrader 5 account on the MT5 tab, then return here to activate expert auto trading.
          </Text>
          <PrimaryButton label='Go to MT5' onPress={goMt5} style={{ marginTop: 12 }} />
        </Card>
      ) : null}

      {mt5Connected === true && prefsLoaded ? (
        <>
          <Card>
            <Text style={styles.cardTitle}>Markets</Text>
            <Text style={styles.meta}>Turn on one or both. EA can run on derived markets, forex, or both.</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Derived markets</Text>
              <Switch
                value={derivedMarkets}
                onValueChange={(v) => void setDerived(v)}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor='#f4f4f5'
              />
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Forex market</Text>
              <Switch
                value={forexMarket}
                onValueChange={(v) => void setForex(v)}
                trackColor={{ false: palette.border, true: palette.primary }}
                thumbColor='#f4f4f5'
              />
            </View>
          </Card>

          <Card>
            <View style={styles.row}>
              <View style={{ flex: 1, paddingRight: 12 }}>
                <Text style={styles.cardTitle}>EA active</Text>
                <Text style={styles.meta}>Requires at least one market above.</Text>
              </View>
              <Switch
                value={eaActive}
                onValueChange={(v) => void setEaActiveSafe(v)}
                trackColor={{ false: palette.border, true: palette.success }}
                thumbColor='#f4f4f5'
              />
            </View>
          </Card>

          {eaActive ? (
            <Card style={styles.statusCard}>
              <Text style={styles.statusLine}>
                Running on: {[derivedMarkets && 'Derived markets', forexMarket && 'Forex'].filter(Boolean).join(' · ') || '—'}
              </Text>
            </Card>
          ) : null}
        </>
      ) : null}

      {mt5Connected === true && !prefsLoaded ? (
        <Card>
          <Text style={styles.meta}>Loading preferences…</Text>
        </Card>
      ) : null}

      {mt5Connected === null ? (
        <Card>
          <Text style={styles.meta}>Checking MT5 connection…</Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.background },
  content: { padding: 16, paddingBottom: 32 },
  title: { color: palette.textPrimary, fontSize: 24, fontWeight: '800', marginBottom: 8 },
  sub: { color: palette.textSecondary, lineHeight: 20, marginBottom: 16 },
  cardTitle: { color: palette.textPrimary, fontSize: 18, fontWeight: '700', marginBottom: 6 },
  meta: { color: palette.textSecondary, lineHeight: 20 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
  },
  rowLabel: { color: palette.textPrimary, fontSize: 16, fontWeight: '600', flex: 1 },
  statusCard: { borderLeftWidth: 3, borderLeftColor: palette.success },
  statusLine: { color: palette.textPrimary, fontWeight: '600' },
});
