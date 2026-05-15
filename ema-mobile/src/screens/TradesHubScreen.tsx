import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Card } from '../components/Card';
import { palette } from '../theme/colors';
export function TradesHubScreen() {
  const navigation = useNavigation();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Trading</Text>
      <Text style={styles.sub}>Choose a trading mode. Returns shown are illustrative ranges for the product experience.</Text>

      <Pressable onPress={() => (navigation as any).navigate('AlpacaTrade')}>
        <Card style={styles.hubCard}>
          <Text style={styles.cardTitle}>Trade on forex market</Text>
          <Text style={styles.cardMeta}>Stocks & crypto via your linked broker (Alpaca)</Text>
          <Text style={styles.roi}>Illustrative ROI range: -1% to +100%</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => (navigation as any).navigate('AirfarmingTrade')}>
        <Card style={styles.hubCard}>
          <Text style={styles.cardTitle}>Trade Airfarming</Text>
          <Text style={styles.cardMeta}>Server-tracked yield events (2–4 per week)</Text>
          <Text style={styles.roi}>Event range: 20% to 85%</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => (navigation as any).navigate('ContractsTrade')}>
        <Card style={styles.hubCard}>
          <Text style={styles.cardTitle}>Trade Contracts</Text>
          <Text style={styles.cardMeta}>Dedicated contract balance — accrues daily while funded</Text>
          <Text style={styles.roi}>Daily accrual: 2%</Text>
        </Card>
      </Pressable>

      <Pressable onPress={() => (navigation as any).navigate('ExpertAutoTrading')}>
        <Card style={styles.hubCard}>
          <Text style={styles.cardTitle}>Expert Account Manager</Text>
          <Text style={styles.cardMeta}>Managed MT5 trading — set risk limits and enable the expert</Text>
          <Text style={styles.roi}>Connect MT5, configure risk, then activate</Text>
        </Card>
      </Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 26, fontWeight: '800', marginBottom: 6 },
  sub: { color: palette.textSecondary, marginBottom: 16, lineHeight: 20 },
  hubCard: { marginBottom: 12 },
  cardTitle: { color: palette.textPrimary, fontSize: 20, fontWeight: '700', marginBottom: 6 },
  cardMeta: { color: palette.textSecondary, marginBottom: 8 },
  roi: { color: palette.primary, fontWeight: '700' },
});
