import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Card } from '../components/Card';
import { LIVE_TRADING_MIN_DEPOSIT, type LiveTradingBotType } from '../services/liveTradingService';
import { RootStackParamList } from '../types';
import { palette } from '../theme/colors';

type Nav = NativeStackNavigationProp<RootStackParamList, 'LiveTradingCreateBot'>;

const BOTS: { id: LiveTradingBotType; title: string; desc: string }[] = [
  { id: 'synthetix_ea', title: 'Synthetix program', desc: 'Higher minimum · broader market access' },
  { id: 'quantix_ea', title: 'Quantix program', desc: 'Lower minimum · focused execution' },
];

export function LiveTradingCreateBotScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <ScrollView style={styles.container} contentContainerStyle={{ padding: 16 }}>
      <Text style={styles.title}>Choose program</Text>
      <Text style={styles.sub}>Min. deposit depends on the program you select.</Text>
      {BOTS.map((b) => (
        <Card key={b.id} style={{ marginBottom: 10 }}>
          <Pressable onPress={() => navigation.navigate('LiveTradingCreateSetup', { botType: b.id })}>
            <Text style={styles.cardTitle}>{b.title}</Text>
            <Text style={styles.meta}>{b.desc}</Text>
            <Text style={styles.min}>Min. deposit ${LIVE_TRADING_MIN_DEPOSIT[b.id].toLocaleString()}</Text>
          </Pressable>
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  title: { color: palette.textPrimary, fontSize: 22, fontWeight: '800', marginBottom: 4 },
  sub: { color: palette.textSecondary, marginBottom: 14 },
  cardTitle: { color: palette.textPrimary, fontSize: 17, fontWeight: '700' },
  meta: { color: palette.textSecondary, marginTop: 4, fontSize: 13 },
  min: { color: palette.primary, marginTop: 8, fontWeight: '700' },
});
